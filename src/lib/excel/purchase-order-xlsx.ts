/**
 * Fills the AeroVent Purchase Order sheet of the PO + BIR 2307 Excel template
 * with an order's PO data. The template (public/templates/po-2307-template.xlsx)
 * preserves the exact letterhead, formatting and print setup (PO = Letter 8.5×11,
 * 2307 = Folio). Only the Purchase Order sheet is filled — the 2307 sheet is left
 * exactly as AeroVent's standard blank form (white input boxes intact) for the
 * team to complete themselves.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { poLineAmount, poTotals, type PurchaseOrder } from "@/lib/purchase-order";
import { round2 } from "@/lib/quote";
import { config } from "@/lib/config";

/** AeroVent's payor details for the BIR 2307 (Part II). */
const PAYOR = {
  tin: "201-616-600",
  branch: "000",
  name: "AEROVENT FANS AND BLOWERS MANUFACTURING",
  address: "7635 NARRA ROAD, BAYAN-BAYANAN, BRGY. SAN VICENTE, SAN PEDRO, LAGUNA",
  zip: "4009",
};

function fullDate(iso: string): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
}

/** The calendar quarter (From/To dates, MM/DD/YYYY) containing a PO date. */
function quarterPeriod(iso: string): { from: string; to: string; monthIndex: number } {
  const d = iso ? new Date(iso) : new Date(NaN);
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const y = safe.getFullYear();
  const q = Math.floor(safe.getMonth() / 3); // 0..3
  const startMonth = q * 3; // 0,3,6,9 (0-indexed)
  const endLast = new Date(y, startMonth + 3, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${pad(startMonth + 1)}/01/${y}`,
    to: `${pad(startMonth + 3)}/${pad(endLast)}/${y}`,
    monthIndex: safe.getMonth() % 3, // 0..2 within the quarter
  };
}

export interface Payee2307 {
  name?: string;
  address?: string;
  tin?: string;
  zip?: string;
}

/** Fill the PO sheet and return the whole workbook (PO + 2307) as a Buffer. */
export async function buildPurchaseOrderWorkbook(
  templateBuffer: ArrayBuffer | Buffer,
  po: PurchaseOrder,
  payee: Payee2307 = {},
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

  // --- BIR 2307 ---------------------------------------------------------------
  // Each field is written to the top-left cell of its input box; the value flows
  // across the box. Cell map derived from the form's box shapes.
  const f = wb.worksheets.find((s) => /2307/i.test(s.name));
  if (f) {
    const period = quarterPeriod(po.date);
    // Part 1 — For the Period.
    f.getCell("J11").value = period.from; // From
    f.getCell("AB11").value = period.to; // To
    // Part I — Payee (from the Supplier's List; falls back to the PO's supplier).
    if (payee.tin) f.getCell("N14").value = payee.tin;
    f.getCell("B17").value = payee.name || po.supplier.company;
    f.getCell("B20").value = payee.address || po.supplier.address;
    if (payee.zip) f.getCell("AK20").value = payee.zip;
    // Part II — Payor (AeroVent).
    f.getCell("N26").value = `${PAYOR.tin}-${PAYOR.branch}`;
    f.getCell("B29").value = PAYOR.name;
    f.getCell("B32").value = PAYOR.address;
    f.getCell("AJ32").value = PAYOR.zip;
    // Part III — ATC + amounts (income = VAT-exclusive; tax = 1%). Amount goes in
    // the month-of-quarter column (1st→O, 2nd→T, 3rd→Y); AI48 total is a formula.
    const income = round2(totals.total / (1 + (config.vatRate || 0.12)));
    const tax = round2(income * 0.01);
    f.getCell("L38").value = "WI 158";
    (["O", "T", "Y"] as const).forEach((col, i) => {
      f.getCell(`${col}38`).value = i === period.monthIndex ? income : 0;
    });
    f.getCell("AD38").value = income;
    f.getCell("AI38").value = tax;
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Locate the 2307 sheet's drawing part inside an xlsx zip. */
async function find2307DrawingPath(zip: JSZip): Promise<string | null> {
  const wbXml = await zip.file("xl/workbook.xml")?.async("string");
  const wbRels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wbXml || !wbRels) return null;
  let rid: string | null = null;
  for (const tag of wbXml.match(/<sheet\b[^>]*\/>/g) ?? []) {
    const n = /name="([^"]+)"/.exec(tag);
    const r = /r:id="(rId\d+)"/.exec(tag);
    if (n && r && /2307/i.test(n[1])) rid = r[1];
  }
  if (!rid) return null;
  const relTag = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(wbRels) ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(wbRels);
  if (!relTag) return null;
  const sheetFile = relTag[1].replace(/^\/?xl\//, "").split("/").pop();
  const sheetRels = await zip.file(`xl/worksheets/_rels/${sheetFile}.rels`)?.async("string");
  if (!sheetRels) return null;
  const dm = /Target="\.\.\/(drawings\/[^"]+)"/.exec(sheetRels);
  return dm ? `xl/${dm[1]}` : null;
}

/**
 * exceljs cannot preserve drawing shapes, so re-saving the workbook strips the
 * 2307 form's ~150 input boxes/lines. This copies the 2307 sheet's drawing (with
 * all shapes) and its images from the pristine source file back into the
 * generated workbook, so the standard form prints exactly as provided.
 */
export async function restore2307Shapes(workbook: Buffer, source: Buffer): Promise<Buffer> {
  try {
    const out = await JSZip.loadAsync(workbook);
    const src = await JSZip.loadAsync(source);
    const outDraw = await find2307DrawingPath(out);
    const srcDraw = await find2307DrawingPath(src);
    if (!outDraw || !srcDraw) return workbook;

    const srcXml = await src.file(srcDraw)!.async("string");
    const srcRelsPath = srcDraw.replace("drawings/", "drawings/_rels/") + ".rels";
    let srcRels = (await src.file(srcRelsPath)?.async("string")) ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

    // Copy each referenced image under a unique name and repoint the rels.
    let i = 0;
    for (const m of srcRels.matchAll(/Target="(\.\.\/media\/([^"]+))"/g)) {
      const ext = m[2].split(".").pop();
      const newName = `img2307_${i++}.${ext}`;
      const bytes = await src.file(`xl/media/${m[2]}`)?.async("nodebuffer");
      if (bytes) out.file(`xl/media/${newName}`, bytes);
      srcRels = srcRels.replace(m[1], `../media/${newName}`);
    }

    out.file(outDraw, srcXml);
    out.file(outDraw.replace("drawings/", "drawings/_rels/") + ".rels", srcRels);
    return await out.generateAsync({ type: "nodebuffer" });
  } catch {
    // Never break the download — fall back to the exceljs output.
    return workbook;
  }
}
