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
import { imageDataUrlSize } from "@/lib/signature";

/** AeroVent's payor details for the BIR 2307 (Part II). */
const PAYOR = {
  tin: "201-616-609",
  branch: "000",
  name: "AEROVENT FANS AND BLOWERS MANUFACTURING",
  address: "7635 NARRA ROAD, BAYAN-BAYANAN, BRGY. SAN VICENTE, SAN PEDRO, LAGUNA",
  zip: "4023",
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

export interface Signatory2307 {
  name?: string;
  designation?: string;
}

/** Fill the PO sheet and return the whole workbook (PO + 2307) as a Buffer. */
export async function buildPurchaseOrderWorkbook(
  templateBuffer: ArrayBuffer | Buffer,
  po: PurchaseOrder,
  signatory: Signatory2307 = {},
  purchaser: { name?: string; designation?: string; signature?: string | null } = {},
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

  // --- Purchaser signature block ("Account Purchaser") -----------------------
  // The template's signature line ("___") sits at row 29+N, with "Account
  // Purchaser" at 30+N and "AEROVENT" at 31+N. Print the purchaser's name just
  // above the line and overlay their signature image on it.
  const purchaserName = (purchaser.name ?? po.createdByName ?? "").trim();
  const purchaserDesignation = (purchaser.designation ?? "").trim();
  const lineRow = 29 + N; // the "___________" signature line (kept)
  // Printed name sits on its own row just above the signature line, centred in
  // column B (the "___" line stays on lineRow, below the name).
  if (purchaserName) {
    // Name sits on the signature-line row itself (lineRow), centred + bottom-
    // aligned in column B, and that row is shrunk to height 2 so the name rests
    // right on the line. Clear the column-A original.
    ws.getCell(`A${lineRow}`).value = null;
    const nameCell = ws.getCell(`B${lineRow}`);
    nameCell.value = purchaserName;
    nameCell.font = { name: "Arial", size: 9, bold: true };
    nameCell.alignment = { horizontal: "center", vertical: "bottom" };
    ws.getRow(lineRow).height = 2;
  }
  // Designation (row 30+N) and company "AEROVENT" (row 31+N): move to column B,
  // centred (trim the template's leading spaces), and clear the column-A originals.
  {
    const des = purchaserDesignation || String(ws.getCell(`A${lineRow + 1}`).value ?? "").trim();
    ws.getCell(`A${lineRow + 1}`).value = null;
    if (des) {
      const desCell = ws.getCell(`B${lineRow + 1}`);
      desCell.value = des;
      desCell.alignment = { horizontal: "center", vertical: "middle" };
    }
  }
  {
    const company = String(ws.getCell(`A${lineRow + 2}`).value ?? "").trim();
    ws.getCell(`A${lineRow + 2}`).value = null;
    if (company) {
      const coCell = ws.getCell(`B${lineRow + 2}`);
      coCell.value = company;
      coCell.alignment = { horizontal: "center", vertical: "middle" };
    }
  }
  const sigUrl = (purchaser.signature ?? "").trim();
  if (sigUrl && /^data:image\/(png|jpe?g);base64,/i.test(sigUrl)) {
    const dim = imageDataUrlSize(sigUrl) ?? { width: 300, height: 100 };
    const ext = /^data:image\/png/i.test(sigUrl) ? "png" : "jpeg";
    // Cap to a signature-sized box, preserving aspect ratio.
    const maxW = 150, maxH = 46;
    const aspect = dim.width > 0 && dim.height > 0 ? dim.width / dim.height : 3;
    let w = maxW, h = Math.round(w / aspect);
    if (h > maxH) { h = maxH; w = Math.round(h * aspect); }
    const sigId = wb.addImage({ base64: sigUrl.split(",")[1], extension: ext as "png" | "jpeg" });
    // Float the signature just above the printed name, centred over col B (0-indexed).
    ws.addImage(sigId, { tl: { col: 0.9, row: lineRow - 4 }, ext: { width: w, height: h }, editAs: "oneCell" });
  }

  // --- BIR 2307 ---------------------------------------------------------------
  // Part I/II (period, payee, payor) can't be written as cell values — the form's
  // opaque white input boxes sit ON TOP of those cells, so any cell text is
  // hidden behind them. Those fields are painted as overlay text boxes instead,
  // in restore2307Shapes(). Here we only fill Part III, whose amount cells are
  // NOT covered by a box and therefore display.
  const f = wb.worksheets.find((s) => /2307/i.test(s.name));
  if (f) {
    // Fit the form to exactly one page wide so the right-hand column (the 4A/8A
    // ZIP boxes) never spills off the printed page. Height is left unconstrained
    // (fitToHeight 0 = as many pages as needed) so nothing is squashed vertically.
    f.pageSetup.fitToPage = true;
    f.pageSetup.fitToWidth = 1;
    f.pageSetup.fitToHeight = 0;

    const period = quarterPeriod(po.date);
    // Part III — ATC + amounts (income = VAT-exclusive; tax = 1%). Amount goes in
    // the month-of-quarter column (1st→O, 2nd→T, 3rd→Y); AI48 total is a formula.
    const income = round2(totals.total / (1 + (config.vatRate || 0.12)));
    const tax = round2(income * 0.01);
    f.getCell("A38").value = "Income payments made by top 10,000 private corporations to";
    f.getCell("L38").value = "WI 158";
    (["O", "T", "Y"] as const).forEach((col, i) => {
      f.getCell(`${col}38`).value = i === period.monthIndex ? income : 0;
    });
    f.getCell("AD38").value = income;
    f.getCell("AI38").value = tax;

    // Payor signatory — printed name + designation in the merged block A63:AN65,
    // bottom-aligned so it sits just above the "Signature over Printed Name" line
    // (row 66). The signature image is added in restore2307Shapes (exceljs would
    // otherwise strip it when it re-writes the drawing).
    const name = (signatory.name ?? "").trim();
    const designation = (signatory.designation ?? "").trim();
    if (name || designation) {
      const runs: ExcelJS.RichText[] = [];
      if (name) runs.push({ text: name, font: { name: "Arial", size: 8, bold: true } });
      if (designation) runs.push({ text: `${runs.length ? "\n" : ""}${designation}`, font: { name: "Arial", size: 8, bold: true } });
      f.getCell("A63").value = { richText: runs };
      f.getCell("A63").alignment = { horizontal: "center", vertical: "bottom", wrapText: true };
    }
  }

  // Rename the 2307 tab to "2307" and password-protect both tabs so the
  // generated PO/2307 can't be accidentally edited. Same password for every
  // client. (Only selection is allowed, matching Excel's default Protect Sheet.)
  if (f) f.name = "2307";
  const PROTECT_PASSWORD = "142677";
  const protectOpts = { selectLockedCells: true, selectUnlockedCells: true } as const;
  await ws.protect(PROTECT_PASSWORD, protectOpts);
  if (f) await f.protect(PROTECT_PASSWORD, protectOpts);

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
const TNR = `<a:latin typeface="Times New Roman" panose="02020603050405020304" pitchFamily="18" charset="0"/><a:cs typeface="Times New Roman" panose="02020603050405020304" pitchFamily="18" charset="0"/>`;

/**
 * Free-text fields (payee/payor name & address). These are simple boxes with no
 * pre-drawn segments, so the value is painted as a single left-aligned overlay
 * text box covering the whole white box.
 */
type TextField = {
  key: "payeeName" | "payeeAddress" | "payorName" | "payorAddress";
  from: { c: number; co: number; r: number; ro: number };
  to: { c: number; co: number; r: number; ro: number };
  off: [number, number];
  ext: [number, number];
  sz: number;
};

const TEXT_FIELDS: TextField[] = [
  { key: "payeeName", from: { c: 1, co: 19706, r: 16, ro: 0 }, to: { c: 39, co: 131378, r: 17, ro: 90482 }, off: [200681, 2143125], ext: [6969672, 223832], sz: 1100 },
  { key: "payeeAddress", from: { c: 1, co: 26276, r: 19, ro: 0 }, to: { c: 35, co: 151086, r: 20, ro: 90483 }, off: [207251, 2543175], ext: [6306535, 223833], sz: 1000 },
  { key: "payorName", from: { c: 1, co: 19706, r: 28, ro: 0 }, to: { c: 39, co: 131378, r: 29, ro: 90482 }, off: [200681, 3762375], ext: [6969672, 223832], sz: 1100 },
  { key: "payorAddress", from: { c: 1, co: 26276, r: 31, ro: 0 }, to: { c: 35, co: 65690, r: 32, ro: 90483 }, off: [207251, 4162425], ext: [6221139, 223833], sz: 1000 },
];

/**
 * Segmented fields (period dates, TINs, ZIPs). The form pre-draws a row of small
 * boxes with separators; we place ONE centred digit box over each cell so the
 * value reads one-number-per-box. `centers` are the absolute EMU x-centres of
 * each cell (measured from AeroVent's blank form); `y`/`cy` are the row's EMU
 * top/height. Digits fill cells left-to-right.
 */
type SegField = {
  key: "periodFrom" | "periodTo" | "payeeTin" | "payorTin" | "payeeZip" | "payorZip";
  centers: number[];
  y: number;
  cy: number;
  sz: number;
  nudge?: number; // extra per-field horizontal shift in EMU (1px = 9525 EMU)
};

// TIN cell centres (measured from the form's dividers). Payee item 2 and payor
// item 6 use the identical box grid, so they share one set of x-centres.
// Last group (branch code) individually tuned: 1st 0 +¼ col, 2nd 0 −¼ col, 3rd 0 −1 col.
const TIN_CENTERS = [2594777, 2768308, 2941839, 3274577, 3448108, 3621639, 3950414, 4123945, 4297476, 4657817, 4895389, 5089579];

const SEG_FIELDS: SegField[] = [
  { key: "periodFrom", y: 1325179, cy: 223372, sz: 1000, centers: [1844726, 2019499, 2198995, 2375555, 2539103, 2712696, 2892192, 3078367] },
  { key: "periodTo", y: 1309706, cy: 236124, sz: 1000, nudge: 58150, centers: [5120710, 5294470, 5474139, 5647900, 5815755, 5989515, 6169184, 6342945] }, // ½ col right, then ¼ col left
  { key: "payeeTin", y: 1757952, cy: 216193, sz: 1000, nudge: 0, centers: TIN_CENTERS }, // ¼ col right, then ¼ col left
  { key: "payorTin", y: 3401328, cy: 227267, sz: 1000, nudge: 0, centers: TIN_CENTERS }, // ¼ col right, then ¼ col left
  { key: "payeeZip", y: 2544538, cy: 222358, sz: 1000, nudge: 0, centers: [6989798, 7151590, 7313382, 7475174] }, // 1 col right, then 1 col left
  { key: "payorZip", y: 4191002, cy: 272141, sz: 1000, nudge: -208070, centers: [7020710, 7228780, 7436849, 7644919] }, // 1 col left
];

const DIGIT_BOX_W = 150000; // EMU width of each centred digit box
const DIGIT_NUDGE_X = 9525; // shift every digit right by 1px (1px = 9525 EMU) for box alignment

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A single left-aligned overlay text box spanning a free-text field's box. */
function textOverlay(g: TextField, value: string, id: number): string {
  if (!value || !value.trim()) return "";
  const text = escapeXml(value.trim());
  const { from: a, to: b } = g;
  return (
    `<xdr:twoCellAnchor>` +
    `<xdr:from><xdr:col>${a.c}</xdr:col><xdr:colOff>${a.co}</xdr:colOff><xdr:row>${a.r}</xdr:row><xdr:rowOff>${a.ro}</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${b.c}</xdr:col><xdr:colOff>${b.co}</xdr:colOff><xdr:row>${b.r}</xdr:row><xdr:rowOff>${b.ro}</xdr:rowOff></xdr:to>` +
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="af_${g.key}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="${g.off[0]}" y="${g.off[1]}"/><a:ext cx="${g.ext[0]}" cy="${g.ext[1]}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="9525" cmpd="sng"><a:noFill/></a:ln></xdr:spPr>` +
    `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" rtlCol="0" anchor="ctr"/><a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="en-US" sz="${g.sz}">${TNR}</a:rPr><a:t>${text}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`
  );
}

/** One centred digit box, absolutely positioned over a segment cell. */
function digitBox(cx: number, y: number, cy: number, sz: number, ch: string, id: number): string {
  const px = Math.round(cx - DIGIT_BOX_W / 2 + DIGIT_NUDGE_X);
  return (
    `<xdr:absoluteAnchor><xdr:pos x="${px}" y="${y}"/><xdr:ext cx="${DIGIT_BOX_W}" cy="${cy}"/>` +
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="afd_${id}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="${px}" y="${y}"/><a:ext cx="${DIGIT_BOX_W}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr>` +
    `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr" anchorCtr="1"/><a:lstStyle/>` +
    `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="${sz}">${TNR}</a:rPr><a:t>${escapeXml(ch)}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:absoluteAnchor>`
  );
}

/** Per-digit centred boxes for one segmented field (digits fill cells L→R). */
function segOverlay(g: SegField, value: string, startId: number): { xml: string; nextId: number } {
  const digits = (value ?? "").replace(/[^0-9A-Za-z]/g, "").split("");
  let id = startId;
  let xml = "";
  digits.forEach((d, i) => {
    if (i < g.centers.length) xml += digitBox(g.centers[i] + (g.nudge ?? 0), g.y, g.cy, g.sz, d, id++);
  });
  return { xml, nextId: id };
}

/** Inject the Part I/II overlay text boxes into the 2307 drawing XML. */
function injectFieldOverlays(drawingXml: string, fields: Fields2307): string {
  let id = 9001;
  let anchors = TEXT_FIELDS.map((g) => textOverlay(g, fields[g.key], id++)).join("");
  for (const g of SEG_FIELDS) {
    const r = segOverlay(g, fields[g.key], id);
    anchors += r.xml;
    id = r.nextId;
  }
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
export async function restore2307Shapes(workbook: Buffer, source: Buffer, fields?: Fields2307, signature?: string): Promise<Buffer> {
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

    // Payor signature image — placed over the "Signature over Printed Name" line.
    const sig = parseDataUrl(signature);
    if (sig) {
      const mediaName = `signature.${sig.ext}`;
      out.file(`xl/media/${mediaName}`, sig.bytes);
      await ensureContentType(out, sig.ext, sig.mime);
      const relId = "rIdSignature";
      srcRels = srcRels.replace(
        "</Relationships>",
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/></Relationships>`,
      );
      srcXml = srcXml.replace("</xdr:wsDr>", `${signaturePicAnchor(relId, imageSize(sig.bytes, sig.ext))}</xdr:wsDr>`);
    }

    out.file(outDraw, srcXml);
    out.file(outDraw.replace("drawings/", "drawings/_rels/") + ".rels", srcRels);
    return await out.generateAsync({ type: "nodebuffer" });
  } catch {
    // Never break the download — fall back to the exceljs output.
    return workbook;
  }
}

/** Parse a data URL into image bytes + extension/mime, or null if unusable. */
function parseDataUrl(dataUrl?: string): { bytes: Buffer; ext: string; mime: string } | null {
  if (!dataUrl) return null;
  const m = /^data:(image\/(png|jpe?g|gif));base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = m[2].toLowerCase() === "jpeg" ? "jpg" : m[2].toLowerCase();
  return { bytes: Buffer.from(m[3], "base64"), ext, mime };
}

/** Ensure [Content_Types].xml declares a Default for the image extension. */
async function ensureContentType(zip: JSZip, ext: string, mime: string): Promise<void> {
  const ct = await zip.file("[Content_Types].xml")?.async("string");
  if (!ct) return;
  if (new RegExp(`Extension="${ext}"`, "i").test(ct)) return;
  zip.file("[Content_Types].xml", ct.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`));
}

/** Read pixel dimensions from PNG/JPEG bytes (fallback 3:1 if unknown). */
function imageSize(bytes: Buffer, ext: string): { w: number; h: number } {
  try {
    if (ext === "png" && bytes.length > 24 && bytes.readUInt32BE(12) === 0x49484452) {
      return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
    }
    if (ext === "jpg") {
      let o = 2;
      while (o + 9 < bytes.length) {
        if (bytes[o] !== 0xff) { o++; continue; }
        const marker = bytes[o + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: bytes.readUInt16BE(o + 5), w: bytes.readUInt16BE(o + 7) };
        }
        o += 2 + bytes.readUInt16BE(o + 2);
      }
    }
  } catch { /* fall through */ }
  return { w: 300, h: 100 };
}

// Signature placement on the 2307 (absolute EMU, measured from the form).
const SIG_CENTER_X = 3609975; // horizontal centre of the merged A63:AN65 block (matches the centred name)
const SIG_SHIFT_X = 217170; //   move right 1.2 column-widths (≈180,975 EMU each)
const SIG_BASE_Y = 9540225; //   just below the declaration line, above the name
const SIG_DROP_Y = 38100; //     sits just above the printed name (raised ~1 row)

/**
 * A fixed-size picture anchor for the payor signature. Aspect ratio is preserved
 * (no stretch), the image is capped to a signature-sized box, and it is centred
 * horizontally over the printed name and dropped onto it.
 */
function signaturePicAnchor(relId: string, size: { w: number; h: number }): string {
  const MAX_W = 1550000; // ~1.6"
  const MAX_H = 430000; //  ~0.45"
  const aspect = size.w > 0 && size.h > 0 ? size.w / size.h : 3;
  let cx = MAX_W;
  let cy = Math.round(cx / aspect);
  if (cy > MAX_H) { cy = MAX_H; cx = Math.round(cy * aspect); }
  const x = Math.round(SIG_CENTER_X - cx / 2) + SIG_SHIFT_X;
  const y = SIG_BASE_Y + SIG_DROP_Y;
  return (
    `<xdr:absoluteAnchor>` +
    `<xdr:pos x="${x}" y="${y}"/>` +
    `<xdr:ext cx="${cx}" cy="${cy}"/>` +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="9600" name="payor-signature"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor>`
  );
}
