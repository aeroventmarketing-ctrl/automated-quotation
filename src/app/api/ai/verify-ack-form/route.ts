import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { ackFormCheckSchema } from "@/lib/ai/schemas";
import { AI_SALE_DOC_READ_LIMIT } from "@/lib/ai/limits";
import { coerceReadCounts, canReadAgain, bumpReadCount, readLimitMessage } from "@/lib/ai/read-allowance";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { saleFromClassification } from "@/lib/sale";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { ACK_DOC_KINDS, ackFormFiles, ackVerdict, type AckCheck, type AckDocKind } from "@/lib/ack-form";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Is the file in an order's Acknowledgement Form slot really an Acknowledgement
 * Form / Acknowledgement Receipt? The AI names what the document is; the verdict
 * is stored per file in `classification.ackFormChecks`. See `lib/ack-form`.
 *
 * Advisory: it never blocks a step — it flags a wrong upload on the Orders list.
 */

const bodySchema = z.object({ quotationId: z.string(), path: z.string() });

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const SYSTEM = `You identify what kind of Philippine business document an image or PDF is. You do NOT read amounts.
Answer with exactly one kind:
- "acknowledgement_form" — titled ACKNOWLEDGEMENT FORM (or Acknowledgment Form): the client acknowledges payment / receipt of goods, often with a signature line.
- "acknowledgement_receipt" — titled ACKNOWLEDGEMENT RECEIPT (or Acknowledgment Receipt): a non-VAT receipt for money received.
- "collection_receipt" — titled COLLECTION RECEIPT.
- "official_receipt" — titled OFFICIAL RECEIPT.
- "sales_invoice" — titled SALES INVOICE / CHARGE INVOICE / CASH INVOICE.
- "delivery_receipt" — titled DELIVERY RECEIPT.
- "delivery_form" — titled DELIVERY FORM.
- "other" — anything else (a check, a deposit slip, a quotation, a photo of goods, a blank page …).
Decide by the PRINTED TITLE of the form first; only when there is no title, by its content. Spelling variants ("Acknowledgment") count.
If the image is too blurry, cropped or dark to tell, give a LOW confidence — never guess.
Return STRICT JSON only.`;

const USER = `Return JSON with this exact shape:
{
  "kind": "acknowledgement_form"|"acknowledgement_receipt"|"collection_receipt"|"official_receipt"|"sales_invoice"|"delivery_receipt"|"delivery_form"|"other",
  "titleSeen": string|null,   // the document's title exactly as printed, null if none
  "confidence": number,       // 0..1 — how sure you are of the kind
  "reason": string|null       // one short sentence, e.g. "Title reads ACKNOWLEDGEMENT RECEIPT, signed by the client"
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

  const roles = await getWorkflowRoles();
  const admin = isAdmin(user);
  const isPaymentApprover = userHasWorkflowRole(roles, user.id, "payment_approver");
  if (!(admin || isPaymentApprover || userHasWorkflowRole(roles, user.id, "accounting"))) {
    return NextResponse.json({ error: "Only Accounting, the Payment Approver or an admin can run this check." }, { status: 403 });
  }

  const quote = await prisma.quotation.findUnique({
    where: { id: body.quotationId },
    select: { id: true, vatMode: true, classification: true },
  });
  if (!quote) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Only a file actually in this order's Acknowledgement Form slots.
  const sale = saleFromClassification(quote.classification);
  const wf = readOrderWorkflow(quote.classification);
  const files = ackFormFiles(quote.vatMode, sale?.docs, wf.deliveryBatches);
  if (!files.some((f) => f.path === body.path)) {
    return NextResponse.json({ error: "That file isn't an Acknowledgement Form upload on this order." }, { status: 400 });
  }

  const cls = ((quote.classification as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const unlimited = admin || isPaymentApprover;
  const counts = coerceReadCounts(cls.ackFormCheckCounts);
  if (!canReadAgain(counts, body.path, AI_SALE_DOC_READ_LIMIT, { unlimited })) {
    return NextResponse.json({ error: readLimitMessage(AI_SALE_DOC_READ_LIMIT, "Acknowledgement Form", "an admin / payment approver"), limitReached: true }, { status: 429 });
  }

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
      return NextResponse.json({ error: "The check supports photos/images (JPG, PNG) and PDFs only." }, { status: 422 });
    }
  } catch {
    return NextResponse.json({ error: "Couldn't open the uploaded file." }, { status: 502 });
  }
  content.push({ type: "text", text: USER });

  try {
    const r = await callClaudeJson({ system: SYSTEM, content, schema: ackFormCheckSchema, maxTokens: 400 });
    const kind = (ACK_DOC_KINDS as readonly string[]).includes(r.kind ?? "") ? (r.kind as AckDocKind) : null;
    const confidence = typeof r.confidence === "number" ? r.confidence : 0;
    const check: AckCheck = {
      verdict: ackVerdict(kind, confidence),
      kind,
      titleSeen: r.titleSeen?.trim() || null,
      confidence,
      reason: r.reason?.trim() || null,
      checkedAt: new Date().toISOString(),
      checkedByName: user.name,
    };
    const nextCounts = bumpReadCount(counts, body.path, { unlimited });
    // One statement that merges just these two keys, so a workflow step saved
    // at the same moment isn't overwritten by a stale copy of the whole blob.
    await prisma.$executeRaw`
      update "Quotation"
      set "classification" = coalesce("classification", '{}'::jsonb)
        || jsonb_build_object(
          'ackFormChecks', coalesce("classification"->'ackFormChecks', '{}'::jsonb) || jsonb_build_object(${body.path}::text, ${JSON.stringify(check)}::jsonb),
          'ackFormCheckCounts', ${JSON.stringify(nextCounts)}::jsonb
        )
      where "id" = ${body.quotationId}
    `;
    return NextResponse.json({ check });
  } catch (err) {
    console.error("verify-ack-form error", err);
    const detail = err instanceof Error ? err.message : String(err);
    const error = /(ANTHROPIC_API_KEY|OPENROUTER_API_KEY) is not set/i.test(detail)
      ? "The AI key isn't set on the server."
      : /credit|insufficient|balance|quota|payment/i.test(detail)
        ? "The AI account has no credit — top it up, then retry."
        : `Could not check the document: ${detail}`;
    return NextResponse.json({ error }, { status: 502 });
  }
}
