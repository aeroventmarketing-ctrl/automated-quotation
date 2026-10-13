/**
 * Receipt Generation — the model behind the BIR receipts workbook.
 *
 * The owner: *"add a Receipt Generation tab. Receipt generation tab will enable
 * the Accounting role to print receipts, pattern of receipt printing is uploaded
 * in github with filename BIR Receipts template.xlsx … Make the uploaded file
 * consistent, do not change the row height and the column width."*
 *
 * The template (templates/bir-receipts-template.xlsx) is Accounting's own: an
 * **Input** sheet they fill, and three print sheets that pull from it and print
 * onto the pre-printed BIR booklets — **SI** (Sales Invoice), **DR** (Delivery
 * Receipt) and **CR** (Collection Receipt). Because the print sheets land on
 * pre-printed forms, their layout is the product: this module only decides WHAT
 * goes into the Input cells; `excel/bir-receipts-xlsx.ts` writes it without
 * touching a single row height or column width.
 *
 * The figures here mirror the template's own Input formulas exactly, so the page
 * preview and the printed receipt can't disagree:
 *   Total Sales      K10 = Σ qty × unit price          (B11 = K10)
 *   Less VAT         B13 = Total × r/100 ÷ (1 + r/100)
 *   Less EWT         B15 = (Total − Less VAT) × e/100
 *   Net Collectible  B16 = Total − Less EWT            (B7 = B16, CR's amount)
 *
 * The template's own notes set the line limits: the Sales Invoice takes "up to 7
 * lines only — in excess of 7 lines use client's PO#"; the Delivery Receipt "up
 * to 16 lines only — in excess of 16 lines use separate Delivery Receipt".
 *
 * Pure: no I/O.
 */
// Its own rounding, not quote.ts's: this module runs in the browser form too,
// and quote.ts imports the database client.
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const SI_MAX_LINES = 7;
export const DR_MAX_LINES = 16;
export const NOTHING_FOLLOWS = "**** Nothing follows ****";

export interface ReceiptLine {
  qty: number | null;
  unit: string;
  description: string;
  /** VAT-inclusive peso price per unit, as the client is billed. */
  unitPrice: number | null;
}

export interface ReceiptInput {
  /** As printed — "October 13, 2026". */
  date: string;
  companyName: string;
  tin: string;
  address: string;
  businessStyle: string;
  /** "In partial/full payment of" — e.g. "PO No. 11014". */
  paymentOf: string;
  /** Blank → written out from the net collectible amount. */
  amountWords1: string;
  amountWords2: string;
  vatRatePct: number;
  ewtRatePct: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  lines: ReceiptLine[];
}

export interface ReceiptTotals {
  totalSales: number;
  lessVat: number;
  lessEwt: number;
  netCollectible: number;
  /** Total Sales − Less VAT: the "VATable Sales" box on the invoice. */
  vatableSales: number;
}

const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
export const lineAmount = (l: ReceiptLine) => num(l.qty) * num(l.unitPrice);
/** A line with something on it — a blank row in the editor isn't a line. */
export const isFilledLine = (l: ReceiptLine) => !!l.description.trim() || num(l.qty) !== 0 || num(l.unitPrice) !== 0;

/** The template's formulas, in the template's order (see the header). */
export function receiptTotals(input: Pick<ReceiptInput, "lines" | "vatRatePct" | "ewtRatePct">): ReceiptTotals {
  const totalSales = input.lines.reduce((a, l) => a + lineAmount(l), 0);
  const r = num(input.vatRatePct) / 100;
  const lessVat = (totalSales * r) / (1 + r);
  const lessEwt = (totalSales - lessVat) * (num(input.ewtRatePct) / 100);
  return {
    totalSales: round2(totalSales),
    lessVat: round2(lessVat),
    lessEwt: round2(lessEwt),
    netCollectible: round2(totalSales - lessEwt),
    vatableSales: round2(totalSales - lessVat),
  };
}

// --- Amount in words --------------------------------------------------------

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion"];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  const rest = n % 100;
  if (rest >= 20) parts.push(rest % 10 ? `${TENS[Math.floor(rest / 10)]} ${ONES[rest % 10]}` : TENS[Math.floor(rest / 10)]);
  else if (rest > 0) parts.push(ONES[rest]);
  return parts.join(" ");
}

/**
 * The template's wording: "Six Thousand Nine Hundred Thirty Seven & 50/100" —
 * whole pesos in words, centavos as a fraction, always two digits.
 */
export function amountInWords(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100);
  let pesos = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  if (pesos === 0) return `Zero & ${frac}/100`;
  const groups: string[] = [];
  for (let i = 0; pesos > 0 && i < SCALES.length; i++) {
    const g = pesos % 1000;
    if (g) groups.unshift(`${under1000(g)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
    pesos = Math.floor(pesos / 1000);
  }
  return `${groups.join(" ")} & ${frac}/100`;
}

/**
 * The amount in words over the template's two lines ("limit text to yellow
 * line"). Breaks between words, never inside one.
 */
export function splitWords(text: string, width = 55): [string, string] {
  if (text.length <= width) return [text, ""];
  const cut = text.lastIndexOf(" ", width);
  const at = cut > 0 ? cut : width;
  return [text.slice(0, at).trim(), text.slice(at).trim()];
}

// --- The lines on each form -------------------------------------------------

export interface FormLines {
  /** Exactly what goes on the Sales Invoice's 7 rows (with "Nothing follows" when it fits). */
  si: ReceiptLine[];
  /** Exactly what goes on the Delivery Receipt's 16 rows. */
  dr: ReceiptLine[];
  /** True when the invoice had to summarise ("as per PO") because of > 7 lines. */
  siSummarised: boolean;
}

const marker: ReceiptLine = { qty: null, unit: "", description: NOTHING_FOLLOWS, unitPrice: null };

/**
 * Lay the lines out the way the template's notes say:
 *  - up to 7 → each on the invoice, then "Nothing follows" if a row is left;
 *  - more than 7 → the invoice carries ONE line "As per <PO>" for the total,
 *    and the Delivery Receipt lists them all;
 *  - more than 16 → refused: "use separate Delivery Receipt".
 */
export function formLines(input: Pick<ReceiptInput, "lines" | "paymentOf">): { ok: true; value: FormLines } | { ok: false; error: string } {
  const lines = input.lines.filter(isFilledLine);
  if (lines.length === 0) return { ok: false, error: "Add at least one line." };
  if (lines.length > DR_MAX_LINES) {
    return { ok: false, error: `${lines.length} lines — a Delivery Receipt holds ${DR_MAX_LINES}. Split them over separate receipts.` };
  }
  const withMarker = (ls: ReceiptLine[], max: number) => (ls.length < max ? [...ls, marker] : ls);
  if (lines.length <= SI_MAX_LINES) {
    return { ok: true, value: { si: withMarker(lines, SI_MAX_LINES), dr: withMarker(lines, DR_MAX_LINES), siSummarised: false } };
  }
  const total = round2(lines.reduce((a, l) => a + lineAmount(l), 0));
  const ref = input.paymentOf.trim() || "client's PO";
  const summary: ReceiptLine = { qty: 1, unit: "lot", description: `As per ${ref}`, unitPrice: total };
  return { ok: true, value: { si: withMarker([summary], SI_MAX_LINES), dr: withMarker(lines, DR_MAX_LINES), siSummarised: true } };
}

/** "October 13, 2026" — the template's date wording — for a Manila YYYY-MM-DD. */
export function receiptDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
}

/**
 * Spread what the client actually pays over the quotation's lines, so the
 * receipt's lines add up to the order — a quote's mark-up, discount and VAT
 * presentation live at the header, not on each line. The last line takes the
 * rounding, so the total is exact to the centavo when its qty is 1, and within
 * a centavo per unit otherwise.
 */
export function linesFromQuotation(
  items: { qty: number; lineTotal: number; description: string; unit?: string | null }[],
  payable: number,
): ReceiptLine[] {
  const sum = items.reduce((a, i) => a + i.lineTotal, 0);
  const factor = sum > 0 ? payable / sum : 1;
  let running = 0;
  return items.map((it, idx) => {
    const qty = it.qty > 0 ? it.qty : 1;
    const last = idx === items.length - 1;
    const lineValue = last ? round2(payable - running) : round2(it.lineTotal * factor);
    running = round2(running + lineValue);
    const firstLine = it.description.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
    return { qty, unit: it.unit?.trim() || "Pcs", description: firstLine.slice(0, 90), unitPrice: round2(lineValue / qty) };
  });
}
