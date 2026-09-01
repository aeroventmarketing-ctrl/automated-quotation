import { existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { selectFan, suggestMotorHp, catalogueNum, type FanModelInput } from "./index";

const PA_PER_INWG = 249.0889, CFM_PER_M3HR = 0.588578;

/** One catalogue sheet → `specs.rows`, taking every column EXACTLY as printed. */
async function sheetRows(file: string, sheet: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(sheet)!;
  const val = (r: number, c: number) => { const v = ws.getRow(r).getCell(c).value as unknown; return v == null ? "" : (typeof v === "object" ? ((v as { result?: unknown; text?: unknown }).result ?? (v as { text?: unknown }).text ?? "") : v); };
  let hdr = 0, hp = 0, ang = 0, rpm = 0, bhp = 0;
  const spCols: { col: number; sp: number }[] = [];
  for (let r = 1; r <= 6 && !hdr; r++) {
    let h = 0, a = 0;
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = String(val(r, c)).trim().toLowerCase();
      if (t === "motor hp") h = c;
      if (t === "blade angle") a = c;
      if (t === "fan rpm") rpm = c;
      if (t === "max bhp") bhp = c;
    }
    if (h && a) { hdr = r; hp = h; ang = a; }
  }
  // The SP numbers sit on the header row itself (EWF) or the row below it (PRV).
  let spRow = hdr;
  for (const cand of [hdr, hdr + 1]) {
    const found = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      // The SP headers are TEXT in this catalogue ("0.000", "0.125", …) — the
      // same notation problem as the Motor HP column, one row higher up.
      const v = catalogueNum(val(cand, c));
      if (v != null && c > bhp && v >= 0 && v <= 5) found.push({ col: c, sp: v });
    }
    if (found.length >= 3) { spRow = cand; spCols.push(...found); break; }
  }
  const rows: { a: unknown; hp: unknown; rpm: unknown; bhp: unknown; c: [number, number][] }[] = [];
  for (let r = spRow + 1; r <= ws.rowCount; r++) {
    const h = val(r, hp);
    if (h === "" || String(h).length > 12) continue;
    const curve = spCols.map(({ col, sp }) => [sp, val(r, col)] as [number, unknown])
      .filter((e): e is [number, number] => typeof e[1] === "number");
    if (curve.length < 2) continue;
    rows.push({ a: val(r, ang), hp: h, rpm: val(r, rpm), bhp: val(r, bhp), c: curve });
  }
  return rows;
}

const CATALOGUE = "EWF Catalog.xlsx";

/**
 * Reads the OWNER'S OWN catalogue file, column for column, and checks the
 * engine installs the motor it prints. Skipped if the file isn't in the repo
 * root, so moving the upload can't break the suite.
 */
describe("the real EWF catalogue, read as printed", () => {
  it.skipIf(!existsSync(CATALOGUE))("selects a row and installs the Motor HP the catalogue prints", async () => {
    const rows = await sheetRows(CATALOGUE, "3600EWF");
    expect(rows.length).toBeGreaterThan(5);
    // Every printed Motor HP is readable, though most are fractions.
    expect(rows.every((r) => catalogueNum(r.hp) != null)).toBe(true);

    const model: FanModelInput = {
      id: "3600EWF", modelCode: "AV3600EWF", name: "Exhaust Wall Fan 36",
      ratingPoints: [],
      specs: { propeller: true, drive: "belt", bladeDia_in: 36, outletArea_ft2: 7.6, maxRpm: 1200, rows },
    };

    for (const [cfm, sp] of [[12000, 0.125], [15000, 0.125], [19000, 0.125]] as const) {
      const r = selectFan(model, { airflow_m3hr: cfm / CFM_PER_M3HR, staticPressure_pa: sp * PA_PER_INWG });
      expect(r).not.toBeNull();
      // The chosen motor is a value printed in the Motor HP column — never BHP/0.75.
      const printed = rows.map((x) => catalogueNum(x.hp));
      expect(printed).toContain(r!.motorHp);
      // …and it is the CATALOGUE motor, not BHP/0.75: at 15000 cfm the printed
      // row is 2 HP on 2.19 BHP, where BHP/0.75 would have called for 3 HP.
      expect(r!.motorHp).toBeLessThanOrEqual(suggestMotorHp(r!.bhp));
    }
  });
});
