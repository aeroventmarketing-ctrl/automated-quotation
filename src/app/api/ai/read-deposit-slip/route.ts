import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { depositSlipReadSchema } from "@/lib/ai/schemas";
import { AI_DEPOSIT_SLIP_READ_LIMIT } from "@/lib/ai/limits";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import type { SlipValidation } from "@/lib/payment-slip";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  quotationId: z.string(),
  path: z.string(),
});

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const SYSTEM = `You read a proof of payment for a Philippine company to auto-fill a collected payment's DATE and AMOUNT.
The proof is a bank deposit slip, a bank/e-wallet transfer confirmation, or an official receipt.

CRITICAL RULES:
- Only trust the bank's MACHINE-VALIDATION imprint (the teller machine's printed stamp of date, amount and reference) or fully COMPUTER-GENERATED text (a bank-app / online-transfer / e-wallet confirmation, or a computer-printed receipt).
- IGNORE anything HANDWRITTEN. Do NOT read a date or amount that is only handwritten. If the amount and date are only handwritten (no machine validation, not computer-generated), set handwrittenOnly=true and leave date/amount null.
- Amounts are Philippine pesos; ignore the "₱"/"PHP" symbol and thousands separators. Return the date as YYYY-MM-DD.
- Never invent numbers. If you cannot read a machine/computer figure, use null and add a warning.
Return STRICT JSON only.`;

const USER_PROMPT = `From the attached proof of payment, return JSON with this exact shape:
{
  "documentType": string|null,      // e.g. "bank deposit slip", "online transfer", "official receipt"
  "machineValidated": boolean,      // true if a bank teller MACHINE-VALIDATION imprint is present
  "computerGenerated": boolean,     // true if the proof is fully computer-generated (app / e-transfer / printed receipt)
  "handwrittenOnly": boolean,       // true if the date/amount are ONLY handwritten
  "date": string|null,              // YYYY-MM-DD from the machine/computer text (null if only handwritten)
  "amount": number|null,            // peso amount from the machine/computer text (null if only handwritten)
  "reference": string|null,         // reference / transaction / OR number if shown
  "bank": string|null,              // bank / e-wallet name if shown
  "warnings": [ string ]            // e.g. "amount handwritten", "validation faint"
}`;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  // The proof must belong to this order's sale uploads.
  if (!body.path.startsWith(`sales/${body.quotationId}/`)) {
    return NextResponse.json({ error: "That file doesn't belong to this order." }, { status: 400 });
  }

  const quote = await prisma.quotation.findUnique({
    where: { id: body.quotationId },
    select: { id: true, preparedById: true, classification: true },
  });
  if (!quote) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Same audience that may record a payment.
  const roles = await getWorkflowRoles();
  const allowed = isAdmin(user)
    || quote.preparedById === user.id
    || user.role === "ENGINEER"
    || userHasWorkflowRole(roles, user.id, "accounting")
    || userHasWorkflowRole(roles, user.id, "payment_approver");
  if (!allowed) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const cls = ((quote.classification as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;

  // Cap the AI reads per order so figures are verified by hand instead of relying
  // on repeated reads. The count is persisted on the classification.
  const reads = typeof cls.depositSlipReadCount === "number" ? cls.depositSlipReadCount : 0;
  if (reads >= AI_DEPOSIT_SLIP_READ_LIMIT) {
    return NextResponse.json({
      error: `AI read limit reached (${AI_DEPOSIT_SLIP_READ_LIMIT} of ${AI_DEPOSIT_SLIP_READ_LIMIT} used for this order). Check the slip and enter the figures manually.`,
      limitReached: true,
      reads,
      limit: AI_DEPOSIT_SLIP_READ_LIMIT,
    }, { status: 429 });
  }

  // Build the image / document content block.
  const content: ContentBlock[] = [];
  try {
    const { base64, contentType } = await downloadFromStorage(body.path);
    if (IMAGE_TYPES.has(contentType)) {
      let mediaType = contentType;
      let data = base64;
      try {
        const out = await sharp(Buffer.from(base64, "base64"))
          .rotate()
          .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        data = out.toString("base64");
        mediaType = "image/jpeg";
      } catch { /* fall back to the original bytes */ }
      content.push({ type: "image", image: { mediaType, base64: data } });
    } else if (contentType === "application/pdf" || body.path.toLowerCase().endsWith(".pdf")) {
      content.push({ type: "document", document: { base64 } });
    } else {
      return NextResponse.json({ error: "Auto-read supports photos/images (JPG, PNG) and PDFs only." }, { status: 422 });
    }
  } catch {
    return NextResponse.json({ error: "Couldn't open the uploaded file." }, { status: 502 });
  }
  content.push({ type: "text", text: USER_PROMPT });

  try {
    const r = await callClaudeJson({ system: SYSTEM, content, schema: depositSlipReadSchema, maxTokens: 1000 });
    const date = r.date ?? null;
    const amount = r.amount ?? null;
    const validated = Boolean((r.machineValidated || r.computerGenerated) && !r.handwrittenOnly && date != null && amount != null);

    // Stamp the validation on the classification so the save action can enforce
    // it and follow the machine/computer figures.
    const stamp: SlipValidation = {
      path: body.path,
      validated,
      date,
      amount,
      reference: r.reference ?? null,
      bank: r.bank ?? null,
      readByName: user.name,
      readAt: new Date().toISOString(),
    };
    const slipValidations = { ...((cls.slipValidations as Record<string, unknown>) ?? {}), [body.path]: stamp };
    const usedReads = reads + 1;
    await prisma.quotation.update({
      where: { id: body.quotationId },
      data: { classification: { ...cls, slipValidations, depositSlipReadCount: usedReads } as unknown as Prisma.InputJsonValue },
    });

    const warnings = [...(r.warnings ?? [])];
    if (!validated && !warnings.length) {
      warnings.push("No machine validation / computer-generated text found — handwritten figures are not accepted.");
    }
    return NextResponse.json({
      validated,
      date,
      amount,
      reference: r.reference ?? null,
      bank: r.bank ?? null,
      documentType: r.documentType ?? null,
      warnings,
      reads: usedReads,
      limit: AI_DEPOSIT_SLIP_READ_LIMIT,
      remaining: Math.max(0, AI_DEPOSIT_SLIP_READ_LIMIT - usedReads),
    });
  } catch (err) {
    console.error("read-deposit-slip error", err);
    const detail = err instanceof Error ? err.message : String(err);
    let error: string;
    if (/(ANTHROPIC_API_KEY|OPENROUTER_API_KEY) is not set/i.test(detail)) {
      error = "The AI key isn't set on the server. Add it to your hosting environment variables and redeploy — or enter the figures manually.";
    } else if (/model/i.test(detail) && /(not_found|404|does not exist|invalid)/i.test(detail)) {
      error = `The configured AI model isn't valid (${detail}). Set the model env var to a current model and redeploy.`;
    } else if (/credit|insufficient|balance|quota|payment/i.test(detail)) {
      error = `The AI account has no credit / billing isn't set up (${detail}). Top up the provider account, then retry.`;
    } else if (/401|403|authentication|invalid x-api-key|permission/i.test(detail)) {
      error = "The AI key was rejected (authentication error). Check the key is correct and active.";
    } else {
      error = `Could not read the slip: ${detail}. You can enter the figures manually.`;
    }
    return NextResponse.json({ error }, { status: 502 });
  }
}
