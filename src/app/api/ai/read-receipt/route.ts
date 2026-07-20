import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { receiptReadSchema } from "@/lib/ai/schemas";
import { coercePurchaseOrder, poLineAmount } from "@/lib/purchase-order";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  purchaseRequestId: z.string(),
  paths: z.array(z.string()).min(1).max(6),
});

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const SYSTEM = `You read purchase receipts / official receipts for a Philippine manufacturer and reconcile them against a Purchase Order (PO).
You are given the PO's line items (with their expected peso amounts) and one or more receipt images.
Extract what was actually paid and map it to the PO lines. Amounts are Philippine pesos; ignore the "₱"/"PHP" symbol and thousands separators.
Return STRICT JSON only.`;

function userPrompt(lines: { description: string; qty: string; poAmount: number }[]): string {
  const list = lines.map((l, i) => `${i + 1}. ${l.description || "(no description)"}${l.qty ? ` — qty ${l.qty}` : ""} — PO amount ₱${l.poAmount.toFixed(2)}`).join("\n");
  return `PO line items (in order):
${list}

From the attached receipt image(s), return JSON with this exact shape:
{
  "supplier": string|null,          // supplier/store name on the receipt
  "date": string|null,              // receipt date as printed
  "vatMode": "inclusive"|"exclusive"|null,  // "inclusive" if the total already includes VAT (most PH ORs say "VAT INCLUSIVE"); "exclusive" if VAT is added on top; null if unclear
  "receiptTotal": number|null,      // the grand total actually paid across all receipts
  "lines": [                        // EXACTLY one entry per PO line above, in the SAME order
    { "actualAmount": number|null,  // actual amount paid for that PO line per the receipt (null if not found)
      "matched": boolean,           // true if you confidently found this line on a receipt
      "note": string }              // short note, e.g. "matched 'GI sheet 24ga'", or "not found on receipt"
  ],
  "extraItems": [ { "description": string, "amount": number } ],  // items on the receipt that don't match any PO line
  "warnings": [ string ]            // e.g. "receipt blurry", "supplier differs from PO", "line 2 not found"
}
Match by item description/meaning, not position. If a single receipt line covers a PO line, use its amount. If you cannot read an amount, use null and add a warning. Do not invent numbers.`;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = isAdmin(user);
  if (!admin) {
    const assignments = await getWorkflowRoles();
    const allowed = (["purchaser", "accounting"] as WorkflowRoleKey[]).some((r) => userHasWorkflowRole(assignments, user.id, r));
    if (!allowed) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  // Only receipts belonging to this PO can be read.
  if (!body.paths.every((p) => p.startsWith(`purchases/${body.purchaseRequestId}/`))) {
    return NextResponse.json({ error: "Receipts don't belong to this purchase order." }, { status: 400 });
  }

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: body.purchaseRequestId } });
  if (!pr) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  const po = coercePurchaseOrder(pr.po);
  const poLines = (po?.lines ?? []).map((l) => ({ description: l.description, qty: l.qty, poAmount: poLineAmount(l) }));
  if (poLines.length === 0) return NextResponse.json({ error: "This PO has no priced lines to reconcile against." }, { status: 400 });

  // Load the receipt files from storage — images and PDFs are both read.
  const content: ContentBlock[] = [];
  const skipped: string[] = [];
  for (const path of body.paths) {
    try {
      const { base64, contentType } = await downloadFromStorage(path);
      if (IMAGE_TYPES.has(contentType)) {
        // Downscale big phone photos (cap the long edge at 1568px, Claude's
        // optimal) to bound the vision token cost and the upload size.
        let mediaType = contentType;
        let data = base64;
        try {
          const out = await sharp(Buffer.from(base64, "base64"))
            .rotate() // honour EXIF orientation
            .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          data = out.toString("base64");
          mediaType = "image/jpeg";
        } catch { /* fall back to the original bytes if resize fails */ }
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
  content.push({ type: "text", text: userPrompt(poLines) });

  try {
    const result = await callClaudeJson({ system: SYSTEM, content, schema: receiptReadSchema, maxTokens: 2000 });
    // Align the AI's per-line results to our PO lines (pad/truncate defensively).
    const resultLines = result.lines ?? [];
    const lines = poLines.map((l, i) => {
      const r = resultLines[i];
      return {
        description: l.description,
        qty: l.qty,
        poAmount: l.poAmount,
        actualAmount: r && typeof r.actualAmount === "number" ? r.actualAmount : null,
        matched: r?.matched ?? false,
        note: r?.note ?? "",
      };
    });
    const warnings = [...(result.warnings ?? [])];
    if (skipped.length) warnings.push(`Couldn't read: ${skipped.join(", ")} (not an image).`);
    return NextResponse.json({
      supplier: result.supplier,
      date: result.date,
      vatMode: result.vatMode,
      receiptTotal: result.receiptTotal,
      lines,
      extraItems: result.extraItems ?? [],
      warnings,
    });
  } catch (err) {
    console.error("read-receipt error", err);
    return NextResponse.json({ error: "Could not read the receipt. Verify ANTHROPIC_API_KEY, or enter the figures manually." }, { status: 502 });
  }
}
