/**
 * Fills the AeroVent Purchase Order + BIR 2307 Excel template with an order's PO
 * data. The template (public/templates/po-2307-template.xlsx) preserves the exact
 * letterhead, formatting and print setup (PO = Letter 8.5×11, 2307 = Folio); we
 * only write the data cells. Item rows are expanded as needed without disturbing
 * the merged totals/footer below.
 */
import ExcelJS from "exceljs";
import { poLineAmount, poTotals, type PurchaseOrder } from "@/lib/purchase-order";
import { round2 } from "@/lib/quote";
import { config } from "@/lib/config";

function fullDate(iso: string): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
}

/** Fill the PO sheet and return the whole workbook (PO + 2307) as a Buffer. */
export async function buildPurchaseOrderWorkbook(
  templateBuffer: ArrayBuffer | Buffer,
  po: PurchaseOrder,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer as ArrayBuffer);
  const ws = wb.getWorksheet("Purchase Order");
  if (!ws) throw new Error("Purchase Order template sheet missing");

  const lines = po.lines.filter((l) => (l.description ?? "").trim() !== "");
  const items = lines.length ? lines : [{ description: "", qty: "", unit: "", unitPrice: "" }];
  const totals = poTotals(po);
  const N = items.length;
  const off = N - 1;

  // Remove the item + total-row merges so inserting item rows can't corrupt them.
  for (const m of ["B20:F20", "A21:I21", "A22:I22", "A23:I23"]) {
    try { ws.unMergeCells(m); } catch { /* not merged */ }
  }
  if (off > 0) ws.duplicateRow(20, off, true); // clones row 20's style, shifts the rest down (images shift on write)
  // Re-apply merges at their final positions.
  for (let i = 0; i < N; i++) {
    try { ws.mergeCells(`B${20 + i}:F${20 + i}`); } catch { /* already merged */ }
  }
  for (const r of [20 + N, 21 + N, 22 + N]) {
    try { ws.mergeCells(`A${r}:I${r}`); } catch { /* already merged */ }
  }

  // Supplier block.
  ws.getCell("C13").value = po.supplier.company;
  ws.getCell("C14").value = po.supplier.attention;
  ws.getCell("C15").value = po.supplier.address;
  ws.getCell("C16").value = fullDate(po.date);
  ws.getCell("C17").value = po.poNumber;

  // Item rows.
  items.forEach((l, i) => {
    const r = 20 + i;
    const priceNum = Number(String(l.unitPrice).replace(/,/g, "")) || 0;
    ws.getCell(`A${r}`).value = l.description ? i + 1 : "";
    ws.getCell(`B${r}`).value = l.description;
    ws.getCell(`G${r}`).value = l.description ? (Number(String(l.qty).replace(/,/g, "")) || l.qty || "") : "";
    ws.getCell(`H${r}`).value = l.unit;
    ws.getCell(`I${r}`).value = l.description ? priceNum : "";
    ws.getCell(`J${r}`).value = l.description ? poLineAmount(l) : "";
  });

  // Totals (labels are already in the shifted rows; set the amounts + EWT %).
  ws.getCell(`A${21 + N}`).value = `LESS EWT ${po.ewtPct}%`;
  ws.getCell(`J${20 + N}`).value = totals.total;
  ws.getCell(`J${21 + N}`).value = totals.ewt;
  ws.getCell(`J${22 + N}`).value = totals.net;

  // Remarks. The footer bank details are left blank for now (filled in later).
  ws.getCell(`B${24 + N}`).value = po.remarks;

  ws.pageSetup.printArea = `A1:J${31 + N}`;

  // --- BIR 2307 sheet ---------------------------------------------------------
  // The standard form is left exactly as AeroVent provided it; only the ATC and
  // the amounts on the WI 158 line (Part III) are filled. Payee, Payor, TIN,
  // address and period stay blank (prepared separately in eBIRForms). Income =
  // VAT-exclusive amount; tax = income × 1%. The Tax Withheld total (AI48) is a
  // SUM formula on the form and is left untouched.
  const f = wb.worksheets.find((s) => /2307/i.test(s.name));
  if (f) {
    const income = round2(totals.total / (1 + (config.vatRate || 0.12)));
    const tax = round2(income * 0.01);
    f.getCell("L38").value = "WI 158"; // ATC — top withholding agent, purchase of goods
    // Income Payments go in the month-of-quarter column matching the PO date
    // (1st→O, 2nd→T, 3rd→Y); the other two months are zero.
    const monthCols = ["O", "T", "Y"] as const;
    const d = po.date ? new Date(po.date) : null;
    const mq = d && !Number.isNaN(d.getTime()) ? d.getMonth() % 3 : 1; // 0..2
    monthCols.forEach((col, i) => {
      f.getCell(`${col}38`).value = i === mq ? income : 0;
    });
    f.getCell("AD38").value = income; // Total (Amount of Income Payments)
    f.getCell("AI38").value = tax; // Tax Withheld for the Quarter
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
