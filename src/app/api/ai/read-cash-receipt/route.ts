import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { receiptReadSchema } from "@/lib/ai/schemas";
import { coerceLiquidation } from "@/lib/cash-request";
import { AI_RECEIPT_READ_LIMIT } from "@/lib/ai/limits";
import { Prisma } from "@prisma/client";
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
CONVENIENCE / SERVICE / PROCESSING FEE: when a payment proof shows a base "Amount" PLUS a separate fee line (Convenience Fee / Service Fee / Processing Fee) that add up to a "Total" — common on GCash and other e-wallet bill-payment / buy-load receipts — use the base "Amount" (the payment itself) and IGNORE the fee. Do NOT use the Total, and do not add the fee as an extra item.
BDO CASH TRANSACTION SLIP / CASH DEPOSIT SLIP (machine-validated): use the "Cash Deposit" figure as the amount. DISREGARD "Cash In" (the cash fed into the machine) and "Cash Out"/"Total Cash Out" (the change returned) — "Cash In" minus "Cash Out" equals the "Cash Deposit". Always read the "Cash Deposit" amount, never "Cash In".
UNIONBANK ONLINE PAYMENT (UBPP): a UnionBank online transfer is identifiable by a reference starting with "UBPP" followed by digits (e.g. "UBPP20261590") in the heading. Use the "Amount" field as the amount and DISREGARD the "Service Fee" (e.g. "+ PHP 25.00") — do not add it and do not use any fee-inclusive total. Its date is the creation date in the "Created by <name> on <date>" line at the top (the date of creation IS the payment date); do NOT rely on the "Transaction Date" field when it only says "Immediately".
BIR FORM 2307 (Certificate of Creditable Tax Withheld at Source): identify it by the form number "2307" printed at the UPPER-LEFT of the form. The AMOUNT is the figure in the "Total" row under the "Tax Withheld for the Quarter" column (the creditable tax withheld) — use that as the amount. The form carries no single payment date, so leave "date" null; the payment date is taken from the document's upload date by the system.
SUPPLIER SALES INVOICE (e.g. TOZEN PHILIPPINES, INC. — SAP Business One "SALES INVOICE" format, and similar supplier VAT invoices): the amount SPENT is the "Amount Due" in the totals box at the bottom-right — the VAT-inclusive payable (VATable + VAT Amount). Set "receiptTotal" to the "Amount Due". CRITICAL: make the per-line "actualAmount" values VAT-INCLUSIVE so they SUM TO the "Amount Due" — do NOT copy the invoice's per-line "Total Amount"/"VATable" column, which is VAT-EXCLUSIVE and reads low by the VAT. Gross each matched line up by VAT: line "actualAmount" = its VATable line amount × ("Amount Due" ÷ the VATable subtotal). For a single-line invoice the line's "actualAmount" simply equals the "Amount Due". Never use the "VAT Amount", "WTax"/EWT, "Discount" or "Zero Rated" rows as the amount on their own — any "WTax"/withholding row is shown for reference and is NOT deducted from "Amount Due" (e.g. TOZEN VATable 10,010.71 + VAT 1,201.29 = "Amount Due" 11,212.00, "WTax 100.11" not subtracted → use 11,212.00). The INVOICE NUMBER is the serial next to "No." at the top-right — it may carry a LETTER PREFIX (e.g. TOZEN's SAP serial "SI000003966" = "SI" + 9 digits); read it exactly, keeping the letters and every leading zero, into "invoiceNumber". The DATE is the "Date" in the Document Reference box (the invoice date) — NOT the "Delivery Date", "Terms", or the "Date Issued" at the very bottom.
PH SALES-INVOICE BOOKLET — "SALES INVOICE" or "CHARGE SALES INVOICE", handwritten OR pre-printed (a padded form the supplier fills in — e.g. WINGS COMMERCIAL (handwritten), GOLDEN PACIFIC INC., TKL STEEL CORPORATION, ALLOYMASTER INDUSTRIAL SUPPLY, IDEAL CONTROLS INC., INTERNATIONAL SPRING INDUSTRIES, JSL ELECTRIC CORPORATION, TOPPHAND ENTERPRISES, RITE PRODUCTS INCORPORATED, METAL EXPONENTS INC., TAIAN (SUBIC) ELECTRIC INC., and any dealer/hardware/industrial-supply sales-invoice booklet with a "SALES INVOICE"/"CHARGE SALES INVOICE" header, a "Sold to"/"Registered Name" block, and a body table with columns QUANTITY | (UNIT/UOM) | ARTICLES/ITEM DESCRIPTION | UNIT PRICE | AMOUNT). Whether handwritten or typed, the figures on a SUPPLIER sales invoice ARE the official values — READ THEM (unlike bank deposit slips). Rules:
  • INVOICE NUMBER: read the pre-printed serial next to "No." / "Invoice No." at the TOP-RIGHT (usually red — a 4–9 character serial, mostly digits and occasionally with a letter prefix — e.g. "47019", "16443", "954314", "14037", "37966", "100580", "012047", leading-zero "0001877", or a SAP-style "SI000003966"), exactly as printed (keep every leading zero and any letter prefix), into "invoiceNumber".
  • DATE: the "DATE:" near the top — M/D/YY or D-M-YY (e.g. "8/12/26" or "4-17-26" = 17 Apr 2026) or written in full (e.g. "May 13, 2026" / "12-Aug-26" / "June 17, 2026"). Ignore the tiny BIR "Date Issued" at the very bottom (the booklet's printing date). EXCEPTION — PDC (post-dated-check) terms: if the invoice is on "PDC" terms with a "Payment Due Date", use that due date as "date" (e.g. RITE PRODUCTS "PDC 15 DAYS" / "Payment Due Date 06/12/2026" → 06/12/2026).
  • LINES: read each body row — QUANTITY, ARTICLES/ITEM DESCRIPTION (e.g. "NATIONBOND #18 (1.1)", "SS 0.5mm x 4ft x 8ft (304) (2B)"), UNIT PRICE and AMOUNT (= quantity × unit price). Match each to a budget line by description/meaning.
  • AMOUNT SPENT — use the VAT-INCLUSIVE GROSS TOTAL, i.e. the "Total Sales (VAT Inclusive)" figure (equivalently VATable Sales + VAT Amount, = the sum of the body "AMOUNT" column). Set "receiptTotal" to it. TWO TRAPS — do NOT use either: (a) a middle "AMOUNT DUE" / "Amount Net of VAT" line (that is NET of VAT, VAT-exclusive, lower by 12%); (b) a "Total Amount Due" that has "Less: Withholding Tax" (EWT) SUBTRACTED — the withholding is a creditable tax remitted to BIR (2307), not a cost reduction, so ALWAYS use the full VAT-inclusive gross (e.g. TKL Steel: Total Sales (VAT Inclusive) 12,840.00, "Less: Withholding Tax 11.64" → "Total Amount Due 12,725.36" — use 12,840.00; JSL Electric: 16,295.00 not 16,149.51; RITE PRODUCTS: Total Sales (VAT Inclusive) 8,078.02, "Less: Withholding Tax 72.13" → "TOTAL AMOUNT DUE 8,005.89" — use 8,078.02). (c) a HANDWRITTEN "PAID – CASH – ₱… / EWT ₱…" annotation stamped on the invoice — that is the net-of-withholding cash paid (gross MINUS the buyer's EWT), not the goods value; use the printed VAT-inclusive "Total Amount Due" (e.g. METAL EXPONENTS: printed "Total Amount Due 68,845.00" with handwritten "PAID – CASH – 68,230.00 / EWT 614.69" → use 68,845.00, not 68,230.00). When there is no withholding line (or it is blank), the "Total Amount Due" equals the VAT-inclusive gross (e.g. TOPPHAND 48,000.00; TAIAN (Subic) Electric 35,620.00). Each matched line's "actualAmount" must sum to that VAT-inclusive gross.
  • If a digit is genuinely unreadable, use null and add a warning rather than guessing.
COLLECTION / ACKNOWLEDGEMENT RECEIPT (a "COLLECTION RECEIPT" issued when a supplier RECEIVES payment — e.g. DJC-SERV INCORPORATED — with "Received from … the sum of … Pesos (P …)", a "PAYMENT IN FORM OF" block, and a "TOTAL PAYMENT" figure): read the top-right serial (often red) into "invoiceNumber" and the "Date". The "TOTAL PAYMENT" is the cash paid NET of the buyer's 1% EWT (on goods); the reconciliation amount is the VAT-INCLUSIVE GROSS, so add the 1% EWT back: receiptTotal = TOTAL PAYMENT × 1.12 ÷ 1.11 (use × 1.12 ÷ 1.10 for services withheld at 2%). Worked example (DJC-Serv): 23,785.71 × 1.12 ÷ 1.11 = 24,000.00 → use 24,000.00; add a warning that it was grossed-up for 1% withholding.
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
  const admin = isAdmin(user);
  if (!admin && cr.requestedById !== user.id) {
    const ok = userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting");
    if (!ok) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  // Cap the number of AI reads per liquidation so the document is verified by
  // hand instead of relying on repeated AI reads. The count is persisted. Admins
  // are exempt (no limit, and their reads don't consume the shared budget).
  const cur = coerceLiquidation(cr.liquidation);
  const reads = cur.aiReadCount ?? 0;
  if (!admin && reads >= AI_RECEIPT_READ_LIMIT) {
    return NextResponse.json({
      error: `AI read limit reached (${AI_RECEIPT_READ_LIMIT} of ${AI_RECEIPT_READ_LIMIT} used). Please check the receipt and enter the figures manually.`,
      limitReached: true,
      reads,
      limit: AI_RECEIPT_READ_LIMIT,
    }, { status: 429 });
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
    // A read completed — burn one of the allotted tries (admins are exempt).
    const usedReads = admin ? reads : reads + 1;
    await prisma.cashRequest.update({
      where: { id: body.cashRequestId },
      data: { liquidation: { ...cur, aiReadCount: usedReads } as unknown as Prisma.InputJsonValue },
    });
    return NextResponse.json({
      supplier: result.supplier,
      date: result.date,
      receiptTotal: result.receiptTotal,
      lines,
      extraItems: result.extraItems ?? [],
      warnings,
      reads: usedReads,
      limit: admin ? null : AI_RECEIPT_READ_LIMIT,
      remaining: admin ? null : Math.max(0, AI_RECEIPT_READ_LIMIT - usedReads),
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
