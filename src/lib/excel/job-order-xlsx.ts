/**
 * Fills the Source sheet of the Centrifugal Blower Job Order template with a
 * FansJobOrder's inputs and returns the whole workbook (Source + the printable
 * "Centrifugal Blower" sheet) as a Buffer.
 *
 * Only the Source "Red - Editable" input cells are written; the Centrifugal
 * Blower sheet is 100% VLOOKUP formulas over Source, so we set fullCalcOnLoad so
 * Excel/LibreOffice recompute the production sheet when the file is opened.
 */
import ExcelJS from "exceljs";
import type { FansJobOrder } from "@/lib/job-order";

/** Parse a possibly-formatted numeric string ("21,338" → 21338); "" → undefined. */
function num(v: string): number | undefined {
  const t = (v ?? "").replace(/,/g, "").trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** A valid Date or undefined. */
function asDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function buildFansJobOrderWorkbook(
  templateBuffer: ArrayBuffer | Buffer,
  jo: FansJobOrder,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer as ArrayBuffer);
  const src = wb.getWorksheet("Source");
  if (!src) throw new Error("Job order template 'Source' sheet missing");

  // Set a cell only when a value is provided, so blanks keep the template default.
  const setText = (addr: string, v: string) => {
    if (v != null && String(v).trim() !== "") src.getCell(addr).value = v;
  };
  const setNum = (addr: string, v: string) => {
    const n = num(v);
    if (n !== undefined) src.getCell(addr).value = n;
  };
  const setDate = (addr: string, v: string) => {
    const d = asDate(v);
    if (d) src.getCell(addr).value = d;
  };

  // Header details
  setDate("B65", jo.date);
  setText("B66", jo.joNumber);
  setText("B67", jo.project);
  setText("B68", jo.make);
  setDate("B69", jo.targetDate);
  setNum("B70", jo.quantity);
  setText("B71", jo.uom);
  setNum("B72", jo.bodyLeadTime);
  setNum("B73", jo.bladeLeadTime);
  // Fan / blower details
  setNum("B77", jo.bladeDiameter);
  setText("B78", jo.orientation);
  setText("B79", jo.rotation);
  setText("B80", jo.bladeType);
  setText("B81", jo.driveType);
  setText("B82", jo.capacity);
  setText("B83", jo.capacityAt0);
  setNum("B84", jo.rpmCatalogue);
  // Motor details
  setText("B87", jo.motorBrand);
  setText("B88", jo.motorPhAlias);
  setText("B89", jo.motorHp);
  setNum("B90", jo.voltage);
  setNum("B91", jo.frequency);
  setText("B92", jo.mounting);
  setText("B93", jo.enclosure);
  setNum("B96", jo.motorPulley);
  setNum("B97", jo.fanPulley);

  // The printable sheet prints on Letter (8.5×11); force a recalc on open so its
  // VLOOKUP formulas reflect the inputs we just wrote.
  const cb = wb.getWorksheet("Centrifugal Blower");
  if (cb) cb.pageSetup = { ...cb.pageSetup, paperSize: 1 };
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
