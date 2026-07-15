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

/**
 * The values that auto-populate the BIR 2307's Part I/II white input boxes.
 * Payee name/address come from the Purchase Order (the actual transaction);
 * payee TIN/ZIP come from the Supplier's List; payor is always AeroVent.
 */
export interface Fields2307 {
  periodFrom: string;
  periodTo: string;
  payeeTin: string;
  payeeName: string;
  payeeAddress: string;
  payeeZip: string;
  payorTin: string;
  payorName: string;
  payorAddress: string;
  payorZip: string;
}

/** Compute the 2307 Part I/II field values for a PO + matched supplier. */
export function build2307Fields(po: PurchaseOrder, payee: Payee2307 = {}): Fields2307 {
  const period = quarterPeriod(po.date);
  return {
    periodFrom: period.from,
    periodTo: period.to,
    payeeTin: payee.tin ?? "",
    payeeName: po.supplier.company || payee.name || "",
    payeeAddress: po.supplier.address || payee.address || "",
    payeeZip: payee.zip ?? "",
    payorTin: `${PAYOR.tin}-${PAYOR.branch}`,
    payorName: PAYOR.name,
    payorAddress: PAYOR.address,
    payorZip: PAYOR.zip,
  };
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

  // --- BIR 2307 ---------------------------------------------------------------
  // Part I/II (period, payee, payor) can't be written as cell values — the form's
  // opaque white input boxes sit ON TOP of those cells, so any cell text is
  // hidden behind them. Those fields are painted as overlay text boxes instead,
  // in restore2307Shapes(). Here we only fill Part III, whose amount cells are
  // NOT covered by a box and therefore display.
  const f = wb.worksheets.find((s) => /2307/i.test(s.name));
  if (f) {
    const period = quarterPeriod(po.date);
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

/**
 * Geometry (two-cell anchor + absolute transform) of each 2307 Part I/II input
 * box, read from AeroVent's standard blank form. An overlay text box is painted
 * at each anchor so the value shows ON the white box instead of behind it.
 * `seg` fields (dates, TINs, ZIPs) print their digits over the box's pre-drawn
 * segment separators, so the digits are spread out to land in the small cells.
 */
type FieldGeom = {
  key: keyof Fields2307;
  from: { c: number; co: number; r: number; ro: number };
  to: { c: number; co: number; r: number; ro: number };
  off: [number, number];
  ext: [number, number];
  sz: number;
  seg: boolean;
};

const FIELD_GEOM: FieldGeom[] = [
  { key: "periodFrom", from: { c: 9, co: 48374, r: 10, ro: 42933 }, to: { c: 16, co: 128788, r: 11, ro: 123430 }, off: [1759699, 1325179], ext: [1413914, 223372], sz: 1100, seg: true },
  { key: "periodTo", from: { c: 26, co: 55387, r: 10, ro: 33810 }, to: { c: 33, co: 111975, r: 11, ro: 120709 }, off: [5035601, 1309706], ext: [1390088, 236124], sz: 1100, seg: true },
  { key: "payeeTin", from: { c: 13, co: 28336, r: 13, ro: 57059 }, to: { c: 28, co: 150830, r: 14, ro: 126749 }, off: [2508011, 1757952], ext: [3004033, 216193], sz: 1100, seg: true },
  { key: "payeeName", from: { c: 1, co: 19706, r: 16, ro: 0 }, to: { c: 39, co: 131378, r: 17, ro: 90482 }, off: [200681, 2143125], ext: [6969672, 223832], sz: 1100, seg: false },
  { key: "payeeAddress", from: { c: 1, co: 26276, r: 19, ro: 0 }, to: { c: 35, co: 151086, r: 20, ro: 90483 }, off: [207251, 2543175], ext: [6306535, 223833], sz: 1000, seg: false },
  { key: "payeeZip", from: { c: 36, co: 39414, r: 19, ro: 2 }, to: { c: 39, co: 125589, r: 20, ro: 89464 }, off: [6924628, 2544538], ext: [606875, 222358], sz: 1100, seg: true },
  { key: "payorTin", from: { c: 12, co: 153106, r: 25, ro: 40364 }, to: { c: 28, co: 161114, r: 26, ro: 127931 }, off: [2439106, 3401328], ext: [3086397, 227267], sz: 1100, seg: true },
  { key: "payorName", from: { c: 1, co: 19706, r: 28, ro: 0 }, to: { c: 39, co: 131378, r: 29, ro: 90482 }, off: [200681, 3762375], ext: [6969672, 223832], sz: 1100, seg: false },
  { key: "payorAddress", from: { c: 1, co: 26276, r: 31, ro: 0 }, to: { c: 35, co: 65690, r: 32, ro: 90483 }, off: [207251, 4162425], ext: [6221139, 223833], sz: 1000, seg: false },
  { key: "payorZip", from: { c: 35, co: 124813, r: 31, ro: 2 }, to: { c: 39, co: 133350, r: 33, ro: 0 }, off: [6816352, 4191002], ext: [726087, 272141], sz: 1100, seg: true },
];

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Spread a segmented value's characters so they land over the form's boxes. */
function spreadSegments(s: string): string {
  return s.replace(/[^0-9A-Za-z]/g, "").split("").join("  ");
}

/** Build one overlay text-box anchor for a field, or "" if the value is blank. */
function overlayAnchor(g: FieldGeom, value: string, id: number): string {
  if (!value || !value.trim()) return "";
  const text = escapeXml(g.seg ? spreadSegments(value) : value.trim());
  const { from: a, to: b } = g;
  return (
    `<xdr:twoCellAnchor>` +
    `<xdr:from><xdr:col>${a.c}</xdr:col><xdr:colOff>${a.co}</xdr:colOff><xdr:row>${a.r}</xdr:row><xdr:rowOff>${a.ro}</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${b.c}</xdr:col><xdr:colOff>${b.co}</xdr:colOff><xdr:row>${b.r}</xdr:row><xdr:rowOff>${b.ro}</xdr:rowOff></xdr:to>` +
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="af_${g.key}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="${g.off[0]}" y="${g.off[1]}"/><a:ext cx="${g.ext[0]}" cy="${g.ext[1]}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="9525" cmpd="sng"><a:noFill/></a:ln></xdr:spPr>` +
    `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" rtlCol="0" anchor="ctr"/><a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="en-US" sz="${g.sz}"><a:latin typeface="Times New Roman" panose="02020603050405020304" pitchFamily="18" charset="0"/><a:cs typeface="Times New Roman" panose="02020603050405020304" pitchFamily="18" charset="0"/></a:rPr>` +
    `<a:t>${text}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`
  );
}

/** Inject the Part I/II overlay text boxes into the 2307 drawing XML. */
function injectFieldOverlays(drawingXml: string, fields: Fields2307): string {
  let id = 9001;
  const anchors = FIELD_GEOM.map((g) => overlayAnchor(g, fields[g.key], id++)).join("");
  if (!anchors) return drawingXml;
  return drawingXml.replace("</xdr:wsDr>", `${anchors}</xdr:wsDr>`);
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
export async function restore2307Shapes(workbook: Buffer, source: Buffer, fields?: Fields2307): Promise<Buffer> {
  try {
    const out = await JSZip.loadAsync(workbook);
    const src = await JSZip.loadAsync(source);
    const outDraw = await find2307DrawingPath(out);
    const srcDraw = await find2307DrawingPath(src);
    if (!outDraw || !srcDraw) return workbook;

    let srcXml = await src.file(srcDraw)!.async("string");
    // Paint the Part I/II values as overlay text boxes on top of the white boxes.
    if (fields) srcXml = injectFieldOverlays(srcXml, fields);
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
