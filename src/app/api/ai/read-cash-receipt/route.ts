import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { receiptReadSchema } from "@/lib/ai/schemas";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  cashRequestId: z.string(),
  paths: z.array(z.string()).min(1).max(6),
  lines: z.array(z.object({ description: z.string().default(""), budgetAmount: z.number().default(0) })).default([]),
});

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const SYSTEM = `You read expense receipts / official receipts for a Philippine company to liquidate a cash advance.
You are given the planned budget lines (what the cash was for, with planned peso amounts) and one or more receipt images/PDFs.
Extract what was actually spent and map it to the budget lines. Amounts are Philippine pesos; ignore the "₱"/"PHP" symbol and thousands separators.
Return STRICT JSON only.`;

function userPrompt(lines: { description: string; budgetAmount: number }[]): string {
  const list = lines.map((l, i) => `${i + 1}. ${l.description || "(no description)"} — planned ₱${l.budgetAmount.toFixed(2)}`).join("\n");
  return `Planned budget lines (in order):
${list}

From the attached receipt(s), return JSON with this exact shape:
{
  "supplier": string|null,          // main store/supplier name (or the first one)
  "date": string|null,              // receipt date as printed
  "receiptTotal": number|null,      // TOTAL actually spent across ALL receipts
  "lines": [                        // EXACTLY one entry per budget line above, in the SAME order
    { "actualAmount": number|null,  // actual spent for that budget line (null if not found)
      "matched": boolean,           // true if you confidently found this line on a receipt
      "note": string }              // short note
  ],
  "extraItems": [ { "description": string, "amount": number } ],  // receipt items that match no budget line
  "warnings": [ string ]            // e.g. "receipt blurry", "line 2 not found"
}
Match by item description/meaning, not position. If you cannot read an amount, use null and add a warning. Do not invent numbers.`;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.paths.every((p) => p.startsWith(`cashrequests/${body.cashRequestId}/`))) {
    return NextResponse.json({ error: "Receipts don't belong to this cash request." }, { status: 400 });
  }

  const cr = await prisma.cashRequest.findUnique({ where: { id: body.cashRequestId } });
  if (!cr) return NextResponse.json({ error: "Cash request not found" }, { status: 404 });
  // The requestor, accounting or an admin may read the receipts.
  if (!isAdmin(user) && cr.requestedById !== user.id) {
    const ok = userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting");
    if (!ok) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const budgetLines = body.lines.length ? body.lines : [{ description: cr.purpose, budgetAmount: Number(cr.amount) || 0 }];

  const content: ContentBlock[] = [];
  const skipped: string[] = [];
  for (const path of body.paths) {
    try {
      const { base64, contentType } = await downloadFromStorage(path);
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
      } else if (contentType === "application/pdf" || path.toLowerCase().endsWith(".pdf")) {
        content.push({ type: "document", document: { base64 } });
      } else {
        skipped.push(path.split("/").pop() ?? path);
      }
    } catch {
      skipped.push(path.split("/").pop() ?? path);
    }
  }
  if (content.length === 0) {
    return NextResponse.json({ error: "No readable receipts. Auto-read supports photos/images (JPG, PNG) and PDFs." }, { status: 422 });
  }
  content.push({ type: "text", text: userPrompt(budgetLines) });

  try {
    const result = await callClaudeJson({ system: SYSTEM, content, schema: receiptReadSchema, maxTokens: 2000 });
    const resultLines = result.lines ?? [];
    const lines = budgetLines.map((l, i) => {
      const r = resultLines[i];
      return {
        description: l.description,
        budgetAmount: l.budgetAmount,
        actualAmount: r && typeof r.actualAmount === "number" ? r.actualAmount : null,
        matched: r?.matched ?? false,
        note: r?.note ?? "",
      };
    });
    const warnings = [...(result.warnings ?? [])];
    if (skipped.length) warnings.push(`Couldn't read: ${skipped.join(", ")} (not an image/PDF).`);
    return NextResponse.json({
      supplier: result.supplier,
      date: result.date,
      receiptTotal: result.receiptTotal,
      lines,
      extraItems: result.extraItems ?? [],
      warnings,
    });
  } catch (err) {
    console.error("read-cash-receipt error", err);
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
      error = `Could not read the receipt: ${detail}. You can enter the figures manually.`;
    }
    return NextResponse.json({ error }, { status: 502 });
  }
}
