import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { receiptReadSchema } from "@/lib/ai/schemas";
import { coercePurchaseOrder, poLineAmount } from "@/lib/purchase-order";
import { coerceReconciliation } from "@/lib/purchase-reconcile";
import { AI_RECEIPT_READ_LIMIT } from "@/lib/ai/limits";
import { Prisma } from "@prisma/client";
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
CONVENIENCE / SERVICE / PROCESSING FEE: when a payment proof shows a base "Amount" PLUS a separate fee line (Convenience Fee / Service Fee / Processing Fee) that add up to a "Total" — common on GCash and other e-wallet bill-payment / buy-load receipts — use the base "Amount" (the payment itself) and IGNORE the fee. Do NOT use the Total, and do not add the fee as an extra item.
BDO CASH TRANSACTION SLIP / CASH DEPOSIT SLIP (machine-validated): use the "Cash Deposit" figure as the amount. DISREGARD "Cash In" (the cash fed into the machine) and "Cash Out"/"Total Cash Out" (the change returned) — "Cash In" minus "Cash Out" equals the "Cash Deposit". Always read the "Cash Deposit" amount, never "Cash In".
UNIONBANK ONLINE PAYMENT (UBPP): a UnionBank online transfer is identifiable by a reference starting with "UBPP" followed by digits (e.g. "UBPP20261590") in the heading. Use the "Amount" field as the amount and DISREGARD the "Service Fee" (e.g. "+ PHP 25.00") — do not add it and do not use any fee-inclusive total. Its date is the creation date in the "Created by <name> on <date>" line at the top (the date of creation IS the payment date); do NOT rely on the "Transaction Date" field when it only says "Immediately".
BIR FORM 2307 (Certificate of Creditable Tax Withheld at Source): identify it by the form number "2307" printed at the UPPER-LEFT of the form. The AMOUNT is the figure in the "Total" row under the "Tax Withheld for the Quarter" column (the creditable tax withheld) — use that as the amount. The form carries no single payment date, so leave "date" null; the payment date is taken from the document's upload date by the system.
SUPPLIER SALES INVOICE (e.g. TOZEN PHILIPPINES, INC. — SAP Business One "SALES INVOICE" format, and similar supplier VAT invoices): the amount PAID is the "Amount Due" in the totals box at the bottom-right — the VAT-inclusive payable (VATable + VAT Amount). Note: any "WTax"/withholding row is shown for reference and is NOT subtracted from "Amount Due" — the "Amount Due" already IS the VAT-inclusive gross (e.g. TOZEN VATable 10,010.71 + VAT 1,201.29 = "Amount Due" 11,212.00, with "WTax 100.11" shown but not deducted → use 11,212.00). Report VAT-INCLUSIVE figures: set "receiptTotal" to the "Amount Due" and "vatMode" to "inclusive". CRITICAL: each PO line's "actualAmount" must be VAT-INCLUSIVE so the line actuals SUM TO the "Amount Due" — do NOT copy the invoice's per-line "Total Amount"/"VATable" column, which is VAT-EXCLUSIVE and will read low by the VAT. Gross each matched line up by VAT: line "actualAmount" = its VATable line amount × ("Amount Due" ÷ the VATable subtotal). For a single-line invoice the line's "actualAmount" simply equals the "Amount Due". Never use the "VAT Amount", "WTax"/EWT, "Discount" or "Zero Rated" rows as the amount on their own. The INVOICE NUMBER is the serial next to "No." at the top-right — it may carry a LETTER PREFIX (e.g. TOZEN's SAP serial "SI000003966" = the letters "SI" + 9 digits); read it EXACTLY, keeping the letters and every leading zero, into "invoiceNumber". The DATE is the "Date" in the Document Reference box (the invoice date) — NOT the "Delivery Date", "Terms", or the "Date Issued" at the very bottom (e.g. TOZEN Date 07/17/2026, not its Delivery Date).
PH SALES-INVOICE BOOKLET — "SALES INVOICE" or "CHARGE SALES INVOICE", handwritten OR pre-printed (a padded form the supplier fills in — e.g. WINGS COMMERCIAL (handwritten), GOLDEN PACIFIC INC., TKL STEEL CORPORATION, ALLOYMASTER INDUSTRIAL SUPPLY, IDEAL CONTROLS INC., INTERNATIONAL SPRING INDUSTRIES, JSL ELECTRIC CORPORATION, TOPPHAND ENTERPRISES, RITE PRODUCTS INCORPORATED, METAL EXPONENTS INC., TAIAN (SUBIC) ELECTRIC INC., and any dealer/hardware/industrial-supply sales-invoice booklet with a "SALES INVOICE"/"CHARGE SALES INVOICE" header, a "Sold to"/"Registered Name" block, and a body table whose columns are QUANTITY | (UNIT/UOM) | ARTICLES/ITEM DESCRIPTION | UNIT PRICE | AMOUNT). Whether the entries are handwritten or typed, the figures on a SUPPLIER sales invoice ARE the official values — READ THEM (unlike bank deposit slips). Rules:
  • INVOICE NUMBER: the pre-printed serial next to "No." / "Invoice No." at the TOP-RIGHT (usually RED — a 4–9 character serial, mostly digits and occasionally with a letter prefix — e.g. "47019", "16443", "954314", "14037", "37966", "100580", "012047", leading-zero "0001877", or a SAP-style "SI000003966"). Read it exactly as printed, KEEPING every leading zero and any letter prefix (drop only the leading label word "No."), into "invoiceNumber".
  • DATE: the "DATE:" near the top — handwritten/typed as M/D/YY or D-M-YY (e.g. "8/12/26" or "4-17-26" = 17 Apr 2026), or written in full (e.g. "May 13, 2026", "12-Aug-26", "June 17, 2026"). Report it in "date" as written. (Ignore the tiny pre-printed "Date Issued" / BIR "Date Issued" at the very bottom of the form — that's the booklet's printing date, not the sale date.) EXCEPTION — POST-DATED-CHECK (PDC) TERMS: if the invoice is on "PDC" / post-dated-check terms and shows a "Payment Due Date", use THAT due date as "date" (that's when the payment lands) — e.g. RITE PRODUCTS "Payment Term: PDC 15 DAYS" / "Payment Due Date 06/12/2026" → use 06/12/2026.
  • LINES: read each body row — QUANTITY, the ARTICLES/ITEM DESCRIPTION text (e.g. "NATIONBOND #18 (1.1)", "SS 0.5mm x 4ft x 8ft (304) (2B)", "VAV 4-inch DIA 24VAC 26-225 cfm Air Volume Range"), UNIT PRICE, and AMOUNT (= quantity × unit price). Match each to a PO line by description/meaning.
  • AMOUNT PAID — use the VAT-INCLUSIVE GROSS TOTAL, i.e. the "Total Sales (VAT Inclusive)" figure (equivalently VATable Sales + VAT Amount, and equal to the sum of the body "AMOUNT" column). Set "receiptTotal" to it and "vatMode" to "inclusive". This is the goods value and it matches the PO/voucher. TWO CRITICAL TRAPS — do NOT use either:
      (a) a middle "AMOUNT DUE" / "Amount Net of VAT" line — on a VAT-inclusive PH invoice that is the amount NET of VAT (VAT-exclusive), lower by the 12% VAT.
      (b) a "Total Amount Due" / "Total Amt. Due" that has had "Less: Withholding Tax" (EWT) SUBTRACTED — the withholding tax is a creditable tax remitted to BIR (the BIR 2307), NOT a reduction in the goods cost, so ALWAYS use the full VAT-inclusive gross. Examples: TKL Steel — Total Sales (VAT Inclusive) 12,840.00, "Less: Withholding Tax 11.64" → "Total Amount Due 12,725.36"; use 12,840.00. JSL Electric — Total Sales (VAT Inc) 16,295.00, "Less: Withholding Tax 145.49" → "Total Amount Due 16,149.51"; use 16,295.00 (NOT 16,149.51). RITE PRODUCTS — "Total Sales (VAT Inclusive) 8,078.02", "Less: Withholding Tax 72.13" → "TOTAL AMOUNT DUE 8,005.89"; use 8,078.02 (NOT 8,005.89). When there is NO withholding line (or it is blank), the "Total Amount Due" equals the VAT-inclusive gross — either reads the same (e.g. TOPPHAND "Total Sales (VAT Inclusive)" = "TOTAL AMOUNT DUE" 48,000.00; TAIAN (Subic) Electric "Total Sales (VAT Inclusive)" = "TOTAL AMOUNT DUE" 35,620.00).
      (c) a HANDWRITTEN "PAID – CASH – ₱… / EWT ₱…" annotation stamped across the invoice body — that is the net-of-withholding CASH actually handed over (VAT-inclusive gross MINUS the buyer's EWT), NOT the goods value. Use the PRINTED VAT-inclusive "Total Amount Due" instead. Example: METAL EXPONENTS — printed "Total Amount Due 68,845.00" (VATable 61,468.75 + VAT 7,376.25) with a handwritten "PAID – CASH – 68,230.00 / EWT 614.69"; use 68,845.00 (NOT 68,230.00 — note 68,845.00 − 614.69 = 68,230.00). A "Less 2% COD Discount" already baked into that 68,845.00 stays reflected; only the EWT is added back.
    Also ignore the "Less: VAT", "VATable Sales", "Zero-rated", "VAT-Exempt" and "VAT Amount" rows on their own. Each matched line's "actualAmount" must sum to the VAT-inclusive gross total (for a single line, it equals it); use the line "AMOUNT" column to split across multiple lines, then scale so the actuals sum to it.
  • Entries can be messy/handwritten — if a digit is genuinely unreadable, use null and add a warning rather than guessing.
COLLECTION / ACKNOWLEDGEMENT RECEIPT (a "COLLECTION RECEIPT" a supplier issues when it RECEIVES payment — e.g. DJC-SERV INCORPORATED — with a "Received from … the sum of … Pesos (P …)" body, a "PAYMENT IN FORM OF" block (Cash / Check / Bank / Check No. / Check Date), and a "TOTAL PAYMENT" figure):
  • INVOICE NUMBER: the pre-printed serial at the TOP-RIGHT (often RED — e.g. "8325") → "invoiceNumber".
  • DATE: the "Date" near the top (e.g. "June 19, 2026").
  • AMOUNT: the "TOTAL PAYMENT" (it equals the amount written in words) is the cash actually paid, which is NET of the buyer's Expanded Withholding Tax (EWT — 1% on goods). The reconciliation amount is the VAT-INCLUSIVE GROSS, so ADD THE 1% EWT BACK: receiptTotal = TOTAL PAYMENT × 1.12 ÷ 1.11 (standard 1% goods EWT; if the payment is for services withheld at 2%, use × 1.12 ÷ 1.10). Worked example (DJC-Serv): 23,785.71 × 1.12 ÷ 1.11 = 24,000.00 → use 24,000.00, and split it across the matched PO/budget lines. Set "vatMode" to "inclusive" and ADD A WARNING that the amount was grossed-up for 1% withholding so a human can confirm.
Return STRICT JSON only.`;

function userPrompt(lines: { description: string; qty: string; poAmount: number }[]): string {
  const list = lines.map((l, i) => `${i + 1}. ${l.description || "(no description)"}${l.qty ? ` — qty ${l.qty}` : ""} — PO amount ₱${l.poAmount.toFixed(2)}`).join("\n");
  return `PO line items (in order):
${list}

From the attached receipt image(s), return JSON with this exact shape:
{
  "supplier": string|null,          // supplier/store name on the receipt
  "invoiceNumber": string|null,     // the sales-invoice / OR serial number (the red pre-printed "No." on a booklet sales invoice) — keep leading zeros and any letter prefix (e.g. "SI000003966")
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

  // Cap the number of AI reads per voucher so Accounting verifies the document
  // by hand instead of relying on repeated AI reads. The count is persisted.
  // Admins are exempt (no limit, and their reads don't consume the shared budget).
  const cur = coerceReconciliation(pr.reconciliation);
  const reads = cur.aiReadCount ?? 0;
  if (!admin && reads >= AI_RECEIPT_READ_LIMIT) {
    return NextResponse.json({
      error: `AI read limit reached (${AI_RECEIPT_READ_LIMIT} of ${AI_RECEIPT_READ_LIMIT} used). Please check the receipt and enter the figures manually.`,
      limitReached: true,
      reads,
      limit: AI_RECEIPT_READ_LIMIT,
    }, { status: 429 });
  }

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

    // A supplier's sales-invoice number should map to exactly one PO / voucher.
    // If the same number is already recorded on a different purchase order, warn —
    // it usually means the wrong receipt was attached, or an invoice is reused.
    const invoiceNumber = (result.invoiceNumber ?? "").trim() || null;
    if (invoiceNumber) {
      try {
        const dupes = await prisma.purchaseRequest.findMany({
          where: { id: { not: body.purchaseRequestId }, reconciliation: { path: ["invoiceNumber"], equals: invoiceNumber } },
          select: { po: true },
          take: 5,
        });
        if (dupes.length) {
          const nums = dupes.map((d) => coercePurchaseOrder(d.po)?.poNumber).filter((n): n is string => !!n);
          warnings.unshift(
            `⚠ Sales invoice No. ${invoiceNumber} is already recorded on ${nums.length ? `PO ${nums.join(", ")}` : "another purchase order"} — a supplier invoice number shouldn't be reused across vouchers. Check you attached the right receipt.`,
          );
        }
      } catch { /* JSON-path filter unsupported / query failed — skip the dup check */ }
    }
    // A read completed — burn one of the allotted tries (admins are exempt).
    const usedReads = admin ? reads : reads + 1;
    await prisma.purchaseRequest.update({
      where: { id: body.purchaseRequestId },
      data: { reconciliation: { ...cur, aiReadCount: usedReads } as unknown as Prisma.InputJsonValue },
    });
    return NextResponse.json({
      supplier: result.supplier,
      invoiceNumber,
      date: result.date,
      vatMode: result.vatMode,
      receiptTotal: result.receiptTotal,
      lines,
      extraItems: result.extraItems ?? [],
      warnings,
      reads: usedReads,
      limit: admin ? null : AI_RECEIPT_READ_LIMIT,
      remaining: admin ? null : Math.max(0, AI_RECEIPT_READ_LIMIT - usedReads),
    });
  } catch (err) {
    console.error("read-receipt error", err);
    const detail = err instanceof Error ? err.message : String(err);
    // Surface the real cause so the admin can fix config (missing key vs bad
    // model id vs auth), instead of a generic message.
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
