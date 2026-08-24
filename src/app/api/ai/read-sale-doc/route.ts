import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { saleDocReadSchema } from "@/lib/ai/schemas";
import { AI_SALE_DOC_READ_LIMIT } from "@/lib/ai/limits";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import {
  isAiReadableSaleDocKey,
  normalizeDocNumber,
  saleDocReadsFromClassification,
  type SaleDocReadStamp,
} from "@/lib/sale";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  quotationId: z.string(),
  path: z.string(),
  docKey: z.string(),
  // Order figures the amount is checked against (advisory verification). The
  // Sales Invoice / Collection Receipt should tally with the order total.
  expectedTotal: z.number().optional(),
});

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const DOC_LABEL: Record<string, string> = {
  sales_invoice: "Sales Invoice",
  or_cr_af: "Collection Receipt",
  delivery_receipt: "Delivery Receipt",
};

const SYSTEM = `You read a Philippine sales closing document to capture its SERIAL NUMBER and its total AMOUNT.
The document is one of: a SALES INVOICE, a COLLECTION RECEIPT (CR) / OFFICIAL RECEIPT (OR) / ACKNOWLEDGEMENT FORM, or a DELIVERY RECEIPT (DR) / Delivery Form.

CRITICAL RULES:
- DOCUMENT NUMBER: read the pre-printed serial number of the form — labelled "No.", "SI No.", "Invoice No.", "CR No.", "OR No.", "DR No." or similar (often printed in red at the top-right). Return the exact digits/letters as printed. This is the document's fingerprint. If you cannot read it clearly, set documentNumber to null (do NOT guess).
- AMOUNT: read the peso TOTAL of the document — the "Total", "Total Amount Due", "Amount" or grand-total figure. If the document shows a VATable Sales + VAT Amount split, the TOTAL is the sum (the gross). A Delivery Receipt often has NO amount — if none is printed, set amount to null. Never invent an amount.
- DATE: the document date (the "Date" near the top). Return YYYY-MM-DD, or null if unsure.
- Read only clearly PRINTED / typed / machine text. IGNORE handwritten annotations for the number and amount unless the whole form is handwritten on a pre-printed booklet — in which case read the handwritten total and the pre-printed serial number.
- ACCURACY OVER COMPLETENESS. If the image is blurry, has glare, is cropped or low-resolution and you are not highly sure of the EXACT digits, set a LOW confidence, leave that field null, and add a warning. NEVER guess.
- Amounts are Philippine pesos; ignore the "₱"/"PHP" symbol and thousands separators.
Return STRICT JSON only.`;

const userPrompt = (label: string) => `This document should be a ${label}. From the attached image/PDF, return JSON with this exact shape:
{
  "documentKind": string|null,      // what the document actually is, e.g. "Sales Invoice", "Collection Receipt", "Delivery Receipt"
  "documentNumber": string|null,    // the pre-printed serial number (SI/CR/OR/DR No.), exact digits (null if unsure)
  "date": string|null,              // YYYY-MM-DD document date (null if unsure)
  "amount": number|null,            // peso TOTAL shown on the document (null if none printed / unsure)
  "customer": string|null,          // sold-to / customer name if shown
  "confidence": number,             // 0..1 — how sure you are of the EXACT document number + amount digits
  "warnings": [ string ]            // e.g. "image blurry", "serial number cut off", "no amount printed"
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
  if (!isAiReadableSaleDocKey(body.docKey)) {
    return NextResponse.json({ error: "This document type can't be AI-read." }, { status: 400 });
  }
  // The file must belong to this order's sale uploads.
  if (!body.path.startsWith(`sales/${body.quotationId}/`)) {
    return NextResponse.json({ error: "That file doesn't belong to this order." }, { status: 400 });
  }

  const quote = await prisma.quotation.findUnique({
    where: { id: body.quotationId },
    select: { id: true, preparedById: true, classification: true },
  });
  if (!quote) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Same audience that may record / clear the sale.
  const roles = await getWorkflowRoles();
  const admin = isAdmin(user);
  const isPaymentApprover = userHasWorkflowRole(roles, user.id, "payment_approver");
  const allowed = admin
    || quote.preparedById === user.id
    || user.role === "ENGINEER"
    || userHasWorkflowRole(roles, user.id, "accounting")
    || isPaymentApprover;
  if (!allowed) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const cls = ((quote.classification as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;

  // Cap the AI reads per order so documents are verified by hand instead of
  // relying on repeated reads. An Admin / Payment Approver is the override — no
  // limit, and their reads don't consume the shared budget. Count persists on
  // the classification.
  const unlimited = admin || isPaymentApprover;
  const reads = typeof cls.saleDocReadCount === "number" ? cls.saleDocReadCount : 0;
  if (!unlimited && reads >= AI_SALE_DOC_READ_LIMIT) {
    return NextResponse.json({
      error: `AI read limit reached (${AI_SALE_DOC_READ_LIMIT} of ${AI_SALE_DOC_READ_LIMIT} used for this order). Check the document and record it by hand — or ask an admin / payment approver.`,
      limitReached: true,
      reads,
      limit: AI_SALE_DOC_READ_LIMIT,
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
  content.push({ type: "text", text: userPrompt(DOC_LABEL[body.docKey] ?? "closing document") });

  try {
    const r = await callClaudeJson({ system: SYSTEM, content, schema: saleDocReadSchema, maxTokens: 1000 });
    const documentNumber = r.documentNumber?.trim() || null;
    const amount = r.amount ?? null;
    const date = r.date ?? null;
    const CONFIDENCE_MIN = 0.7;
    const confidence = typeof r.confidence === "number" ? r.confidence : 0;

    // Verify the amount against the order total (advisory). A Delivery Receipt
    // often carries no amount — then there's nothing to check.
    const expected = typeof body.expectedTotal === "number" && body.expectedTotal > 0 ? body.expectedTotal : null;
    const tolerance = expected != null ? Math.max(1, expected * 0.005) : 0;
    const amountMatches = amount != null && expected != null ? Math.abs(amount - expected) <= tolerance : null;

    // Duplicate guard — the same document number must not already be recorded on
    // ANOTHER order's document of the same kind. Scan the other quotes' reads.
    let duplicateOf: string | null = null;
    if (documentNumber) {
      const key = normalizeDocNumber(documentNumber);
      const others = await prisma.quotation.findMany({
        where: { id: { not: body.quotationId } },
        select: { quoteNumber: true, classification: true },
      }).catch(() => []);
      for (const o of others) {
        const otherReads = saleDocReadsFromClassification(o.classification);
        for (const stamp of Object.values(otherReads)) {
          if (stamp.docKey === body.docKey && stamp.documentNumber && normalizeDocNumber(stamp.documentNumber) === key) {
            duplicateOf = o.quoteNumber;
            break;
          }
        }
        if (duplicateOf) break;
      }
    }

    const clear = confidence >= CONFIDENCE_MIN;
    const validated = Boolean(
      documentNumber && clear && !duplicateOf && (amountMatches !== false),
    );

    const stamp: SaleDocReadStamp = {
      path: body.path,
      docKey: body.docKey,
      documentNumber,
      date,
      amount,
      expected,
      amountMatches,
      duplicateOf,
      validated,
      readByName: user.name,
      readAt: new Date().toISOString(),
    };
    const saleDocReads = { ...((cls.saleDocReads as Record<string, unknown>) ?? {}), [body.path]: stamp };
    const usedReads = unlimited ? reads : reads + 1; // override reads don't consume the budget
    await prisma.quotation.update({
      where: { id: body.quotationId },
      data: { classification: { ...cls, saleDocReads, saleDocReadCount: usedReads } as unknown as Prisma.InputJsonValue },
    });

    const warnings = [...(r.warnings ?? [])];
    if (!documentNumber) warnings.push("Couldn't read the document number — check the form and record it by hand.");
    else if (!clear) warnings.push("The image is unclear (blurry / glare), so the read isn't reliable. Upload a clearer copy.");
    if (duplicateOf) warnings.push(`This document number is already recorded on order ${duplicateOf}.`);
    if (amountMatches === false && expected != null && amount != null) {
      warnings.push(`Amount ${amount.toLocaleString()} doesn't match the order total ${expected.toLocaleString()}.`);
    }

    return NextResponse.json({
      validated,
      confidence,
      documentKind: r.documentKind ?? null,
      documentNumber,
      date,
      amount,
      customer: r.customer ?? null,
      expected,
      amountMatches,
      duplicateOf,
      warnings,
      reads: usedReads,
      limit: unlimited ? null : AI_SALE_DOC_READ_LIMIT,
      remaining: unlimited ? null : Math.max(0, AI_SALE_DOC_READ_LIMIT - usedReads),
    });
  } catch (err) {
    console.error("read-sale-doc error", err);
    const detail = err instanceof Error ? err.message : String(err);
    let error: string;
    if (/(ANTHROPIC_API_KEY|OPENROUTER_API_KEY) is not set/i.test(detail)) {
      error = "The AI key isn't set on the server. Add it to your hosting environment variables and redeploy — or record the figures manually.";
    } else if (/model/i.test(detail) && /(not_found|404|does not exist|invalid)/i.test(detail)) {
      error = `The configured AI model isn't valid (${detail}). Set the model env var to a current model and redeploy.`;
    } else if (/credit|insufficient|balance|quota|payment/i.test(detail)) {
      error = `The AI account has no credit / billing isn't set up (${detail}). Top up the provider account, then retry.`;
    } else if (/401|403|authentication|invalid x-api-key|permission/i.test(detail)) {
      error = "The AI key was rejected (authentication error). Check the key is correct and active.";
    } else {
      error = `Could not read the document: ${detail}. You can record the figures manually.`;
    }
    return NextResponse.json({ error }, { status: 502 });
  }
}
