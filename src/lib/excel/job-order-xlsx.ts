/**
 * Fills the Centrifugal Blower Job Order template with a FansJobOrder's inputs
 * and returns the workbook as a Buffer.
 *
 * We do NOT re-save the workbook through exceljs — that distorts the template's
 * embedded reference images and can alter the printable sheet's appearance.
 * Instead we edit ONLY the Source sheet's "Red - Editable" input cells directly
 * in the XML (preserving each cell's style), leaving every drawing, image and
 * format byte-for-byte identical. The printable "Centrifugal Blower" sheet is
 * 100% VLOOKUP formulas over Source, so we set fullCalcOnLoad so Excel/
 * LibreOffice recompute it when the file is opened.
 */
import JSZip from "jszip";
import type { FansJobOrder } from "@/lib/job-order";

type CellKind = "text" | "num" | "date";
type StringKey = { [K in keyof FansJobOrder]: FansJobOrder[K] extends string ? K : never }[keyof FansJobOrder];

/** Input-cell map: Source cell → (FansJobOrder field, value kind). */
const CELL_MAP: Array<{ cell: string; key: StringKey; kind: CellKind }> = [
  { cell: "B65", key: "date", kind: "date" },
  { cell: "B66", key: "joNumber", kind: "text" },
  { cell: "B67", key: "project", kind: "text" },
  { cell: "B68", key: "make", kind: "text" },
  { cell: "B69", key: "targetDate", kind: "date" },
  { cell: "B70", key: "quantity", kind: "num" },
  { cell: "B71", key: "uom", kind: "text" },
  { cell: "B72", key: "bodyLeadTime", kind: "num" },
  { cell: "B73", key: "bladeLeadTime", kind: "num" },
  { cell: "B77", key: "bladeDiameter", kind: "num" },
  { cell: "B78", key: "orientation", kind: "text" },
  { cell: "B79", key: "rotation", kind: "text" },
  { cell: "B80", key: "bladeType", kind: "text" },
  { cell: "B81", key: "driveType", kind: "text" },
  { cell: "B82", key: "capacity", kind: "text" },
  { cell: "B83", key: "capacityAt0", kind: "text" },
  { cell: "B84", key: "rpmCatalogue", kind: "num" },
  { cell: "B87", key: "motorBrand", kind: "text" },
  { cell: "B88", key: "motorPhAlias", kind: "text" },
  { cell: "B89", key: "motorHp", kind: "text" },
  { cell: "B90", key: "voltage", kind: "num" },
  { cell: "B91", key: "frequency", kind: "num" },
  { cell: "B92", key: "mounting", kind: "text" },
  { cell: "B93", key: "enclosure", kind: "text" },
  { cell: "B96", key: "motorPulley", kind: "num" },
  { cell: "B97", key: "fanPulley", kind: "num" },
];

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Days since the Excel 1900 epoch (1899-12-30) for an ISO date, or null. */
function excelSerial(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day - epoch) / 86400000);
}

/** Replace one cell's value in a worksheet XML, preserving its style attribute. */
function replaceCell(xml: string, addr: string, kind: CellKind, raw: string): string {
  const value = (raw ?? "").trim();
  if (value === "") return xml; // leave the template default for blanks
  // Match an existing <c r="ADDR" ...>…</c> or self-closing <c r="ADDR" .../>.
  const re = new RegExp(`<c r="${addr}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = re.exec(xml);
  if (!m) return xml; // cell not present in the template — skip
  const attrs = m[1] || "";
  const s = /\bs="(\d+)"/.exec(attrs);
  const style = s ? ` s="${s[1]}"` : "";
  let cell: string;
  if (kind === "num") {
    const n = Number(value.replace(/,/g, ""));
    if (!Number.isFinite(n)) return xml;
    cell = `<c r="${addr}"${style}><v>${n}</v></c>`;
  } else if (kind === "date") {
    const serial = excelSerial(value);
    if (serial == null) return xml;
    cell = `<c r="${addr}"${style}><v>${serial}</v></c>`;
  } else {
    cell = `<c r="${addr}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }
  return xml.slice(0, m.index) + cell + xml.slice(m.index + m[0].length);
}

/** Resolve a sheet's XML path inside the workbook zip by its display name. */
async function sheetPath(zip: JSZip, name: RegExp): Promise<string | null> {
  const wbXml = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wbXml || !rels) return null;
  let rid: string | null = null;
  for (const tag of wbXml.match(/<sheet [^>]*\/>/g) ?? []) {
    const n = /name="([^"]+)"/.exec(tag);
    const r = /r:id="(rId\d+)"/.exec(tag);
    if (n && r && name.test(n[1])) rid = r[1];
  }
  if (!rid) return null;
  const rel = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels);
  if (!rel) return null;
  return `xl/${rel[1].replace(/^\/?xl\//, "")}`;
}

export async function buildFansJobOrderWorkbook(
  templateBuffer: ArrayBuffer | Buffer,
  jo: FansJobOrder,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBuffer as ArrayBuffer);

  // 1) Write the Source input cells.
  const srcPath = (await sheetPath(zip, /source/i)) ?? "xl/worksheets/sheet2.xml";
  const srcFile = zip.file(srcPath);
  if (!srcFile) throw new Error("Job order template 'Source' sheet missing");
  let srcXml = await srcFile.async("string");
  for (const { cell, key, kind } of CELL_MAP) {
    srcXml = replaceCell(srcXml, cell, kind, jo[key]);
  }
  zip.file(srcPath, srcXml);

  // 2) Force Excel to recalculate the formula-driven printable sheet on open,
  //    and hide the Source sheet so the production copy shows only the
  //    Centrifugal Blower. (Source can't be deleted — the Centrifugal Blower is
  //    100% formulas over it — so it stays hidden and drives the calculations.)
  const wbPath = "xl/workbook.xml";
  let wbXml = await zip.file(wbPath)!.async("string");
  if (/<calcPr\b/.test(wbXml)) {
    if (!/fullCalcOnLoad=/.test(wbXml)) {
      wbXml = wbXml.replace(/<calcPr\b([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
    }
  } else {
    wbXml = wbXml.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
  }
  wbXml = wbXml.replace(/<sheet\b[^>]*\/>/g, (tag) => {
    if (!/name="[^"]*[Ss]ource[^"]*"/.test(tag)) return tag;
    return /\bstate="[^"]*"/.test(tag)
      ? tag.replace(/\bstate="[^"]*"/, 'state="hidden"')
      : tag.replace(/\/>$/, ' state="hidden"/>');
  });
  // A hidden sheet can't be the active tab — activate the Centrifugal Blower (0).
  wbXml = wbXml.replace(/(<workbookView\b[^>]*?)\sactiveTab="\d+"/, "$1 activeTab=\"0\"");
  zip.file(wbPath, wbXml);

  // 3) Print the production sheet on Letter (8.5×11) and always open it in
  //    Page Break Preview at 120% zoom, so the printable layout is what the
  //    production line sees.
  const cbPath = await sheetPath(zip, /centrifugal|blower/i);
  if (cbPath) {
    const cbFile = zip.file(cbPath);
    if (cbFile) {
      let cbXml = await cbFile.async("string");
      if (/<pageSetup\b/.test(cbXml)) {
        cbXml = /paperSize=/.test(cbXml)
          ? cbXml.replace(/(<pageSetup\b[^>]*?\bpaperSize=")\d+(")/, `$11$2`)
          : cbXml.replace(/<pageSetup\b/, '<pageSetup paperSize="1"');
      }
      // Force Page Break Preview at 120% on the sheet's view.
      cbXml = cbXml.replace(/<sheetView\b([^>]*?)(\/?)>/, (_m, attrs, selfClose) => {
        let a = attrs
          .replace(/\s*\bview="[^"]*"/g, "")
          .replace(/\s*\bzoomScale="[^"]*"/g, "")
          .replace(/\s*\bzoomScaleSheetLayoutView="[^"]*"/g, "");
        a = ` view="pageBreakPreview" zoomScale="120" zoomScaleSheetLayoutView="120"${a}`;
        return `<sheetView${a}${selfClose}>`;
      });
      zip.file(cbPath, cbXml);
    }
  }

  return await zip.generateAsync({ type: "nodebuffer" });
}
