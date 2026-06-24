/**
 * Parse the PRV (belt) + PRVDD (direct) Power Roof Ventilator catalog into the
 * two CSVs the admin Import screen accepts:
 *   scripts/out/prv-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/prv-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * One workbook holds a sheet per size: PRVDD (direct, 12"–48") and PRV (belt,
 * 20"–60"). Columns: SIZE, BLADE ANGLE, MOTOR HP, FAN RPM, MAX BHP, SONES, then
 * one column per static pressure (in. w.g.) holding the CFM.
 *
 * Like EWF/EWFDD, one design blade angle is kept per size (40° if offered, else
 * the next lower). Belt PRV is a multi-rpm grid selected below 1200 rpm; direct
 * PRVDD runs at its rated speed(s) (1750 / 1160 / 860 rpm) — flagged
 * `fixedSpeedDirect` so selection uses the fan's own speed. Motor HP comes from
 * the MOTOR HP column. Conversions:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * Run: npx tsx scripts/gen-prv-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;
const OUT_DIR = join(process.cwd(), "scripts", "out");
const EWF_BELT_MAX_RPM = 1200; // PRV belt is selected under 1200 rpm.

const PRV_PRICES: Record<number, number> = {
  2000: 20460, 2400: 24552, 3000: 30690, 3600: 36828,
  4200: 42966, 4800: 51480, 5400: 60588, 6000: 74250,
};
const PRVDD_PRICES: Record<number, number> = {
  1200: 12276, 1600: 16368, 1800: 18414, 2000: 20460, 2400: 24552,
  3000: 30690, 3600: 36828, 4200: 42966, 4800: 51480,
};

function pickAngle(angles: number[]): number {
  if (angles.includes(40)) return 40;
  const lower = angles.filter((a) => a < 40);
  return lower.length ? Math.max(...lower) : Math.min(...angles);
}

const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);
const cellVal = (c: ExcelJS.Cell): unknown => {
  const v = c.value as unknown;
  if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) {
    return (v as { result: unknown }).result;
  }
  return v;
};
function toNum(v: unknown): number | null {
  if (isNum(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    if (!Number.isNaN(n) && v.trim() !== "") return n;
  }
  return null;
}
function parseHp(v: unknown): number | null {
  if (isNum(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    // Mixed number, e.g. "1 1/2" -> 1.5, "7 1/2" -> 7.5.
    const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixed) {
      return Math.round((Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])) * 1000) / 1000;
    }
    const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac) return Math.round((Number(frac[1]) / Number(frac[2])) * 1000) / 1000;
    return toNum(t);
  }
  return null;
}

interface RawRow {
  code: number;
  direct: boolean;
  angle: number;
  rpm: number;
  bhp: number;
  motorHp: number | null;
  cfm: Array<{ sp_in: number; cfm: number }>;
}

function parseSheet(ws: ExcelJS.Worksheet): RawRow[] {
  // Size + drive come from the SHEET NAME (the in-cell model label is mislabelled
  // on some sheets, e.g. "4800PRVDD" rows say "4200PRVDD").
  const sm = ws.name.trim().match(/^(\d{3,4})PRV(DD)?$/i);
  if (!sm) return [];
  const code = Number(sm[1]);
  const direct = !!sm[2];

  // Header row: 2nd cell reads "BLADE ANGLE"; the SP labels sit one row below it
  // from column 7 (G) onward.
  let hdrRow = 0;
  for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
    if (String(cellVal(ws.getRow(r).getCell(2)) ?? "").trim().toUpperCase() === "BLADE ANGLE") {
      hdrRow = r;
      break;
    }
  }
  if (!hdrRow) return [];
  const spRow = hdrRow + 1;
  const spCols: Array<{ sp_in: number; col: number }> = [];
  for (let c = 7; c <= ws.columnCount; c++) {
    const sp = toNum(cellVal(ws.getRow(spRow).getCell(c)));
    if (sp != null) spCols.push({ sp_in: sp, col: c });
  }
  if (spCols.length < 2) return [];

  const rows: RawRow[] = [];
  for (let r = spRow + 1; r <= ws.rowCount; r++) {
    if (!/PRV/i.test(String(cellVal(ws.getRow(r).getCell(1)) ?? ""))) continue; // data rows only
    const angle = toNum(cellVal(ws.getRow(r).getCell(2)));
    const motorHp = parseHp(cellVal(ws.getRow(r).getCell(3)));
    const rpm = toNum(cellVal(ws.getRow(r).getCell(4)));
    const bhp = toNum(cellVal(ws.getRow(r).getCell(5)));
    if (angle == null || rpm == null || bhp == null || rpm <= 0) continue;
    const cfm: RawRow["cfm"] = [];
    for (const sc of spCols) {
      const v = toNum(cellVal(ws.getRow(r).getCell(sc.col)));
      if (v != null && v > 0) cfm.push({ sp_in: sc.sp_in, cfm: v });
    }
    if (cfm.length) rows.push({ code, direct, angle, rpm, bhp, motorHp, cfm });
  }
  return rows;
}

interface Model {
  code: number;
  direct: boolean;
  modelCode: string;
  dia: number;
  sizeLabel: string;
  angle: number;
  maxRpm: number;
  basePrice: number;
  motorHpByRpm: Array<[number, number]>;
  points: Array<{ rpm: number; cfm: number; sp_in: number; bhp: number }>;
}

function buildModels(rows: RawRow[]): Model[] {
  const byKey = new Map<string, RawRow[]>();
  for (const r of rows) {
    const key = `${r.code}-${r.direct ? "D" : "B"}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }
  const models: Model[] = [];
  for (const rs of byKey.values()) {
    const { code, direct } = rs[0];
    const angles = [...new Set(rs.map((r) => r.angle))];
    const angle = pickAngle(angles);
    const kept = rs.filter((r) => r.angle === angle);
    const points: Model["points"] = [];
    const motorByRpm = new Map<number, number>();
    let topRpm = 0;
    for (const r of kept) {
      for (const c of r.cfm) points.push({ rpm: r.rpm, cfm: c.cfm, sp_in: c.sp_in, bhp: r.bhp });
      if (r.rpm > topRpm) topRpm = r.rpm;
      if (r.motorHp != null) motorByRpm.set(r.rpm, r.motorHp);
    }
    const price = (direct ? PRVDD_PRICES : PRV_PRICES)[code];
    if (price == null) {
      console.warn(`  ! no price for ${code}${direct ? "PRVDD" : "PRV"} — skipped`);
      continue;
    }
    const tag = direct ? "PRVDD" : "PRV";
    models.push({
      code,
      direct,
      modelCode: `AV${code}${tag}`,
      dia: code / 100,
      sizeLabel: String(Math.round(code / 100)),
      angle,
      maxRpm: direct ? topRpm : EWF_BELT_MAX_RPM,
      basePrice: price,
      motorHpByRpm: [...motorByRpm.entries()].sort((a, b) => a[0] - b[0]),
      points,
    });
  }
  models.sort((a, b) => (a.direct === b.direct ? a.code - b.code : a.direct ? 1 : -1));
  return models;
}

const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(process.cwd(), "PRV Catalog.xlsx"));
  const rows = wb.worksheets.flatMap((ws) => parseSheet(ws));
  const models = buildModels(rows);
  if (!models.length) throw new Error("No PRV/PRVDD models parsed");

  const catHeader =
    "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows = models.map((m) => {
    const tag = m.direct ? "PRVDD" : "PRV";
    const driveWord = m.direct ? "Direct Drive" : "Belt Drive";
    const description =
      "Power Roof Ventilator\n" +
      `Propeller Type / ${driveWord}\n` +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel Aqua Green / Model: ${m.modelCode}`;
    // Outlet opening = blade Ø + 1"; area in ft² for the OV readout.
    const outletArea_ft2 = Math.round((Math.PI / 4) * ((m.dia + 1) / 12) ** 2 * 1000) / 1000;
    const specs: Record<string, unknown> = {
      bladeDia_in: m.dia,
      bladeAngle_deg: m.angle,
      outletArea_ft2,
      maxRpm: m.maxRpm,
      propeller: true,
      bladeType: "Propeller",
      drive: m.direct ? "direct" : "belt",
      category: "Propeller Type",
      type: "Power Roof Ventilator",
      tag,
    };
    if (m.motorHpByRpm.length) specs.motorHpByRpm = m.motorHpByRpm;
    if (m.direct) specs.fixedSpeedDirect = true;
    const name = `Power Roof Ventilator ${m.sizeLabel}" Propeller (${tag})`;
    return [
      m.modelCode, "PROPELLER", csv(name), csv(description),
      m.sizeLabel, "unit", String(m.basePrice), "PHP", csv(JSON.stringify(specs)),
    ].join(",");
  });
  writeFileSync(join(OUT_DIR, "prv-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");

  const ratHeader = "modelCode,rpm,airflow_m3hr,staticPressure_pa,power_kw,efficiency";
  const ratRows: string[] = [];
  for (const m of models) {
    for (const p of m.points) {
      ratRows.push([
        m.modelCode, String(Math.round(p.rpm)),
        (p.cfm * CFM_TO_M3HR).toFixed(2), (p.sp_in * INWG_TO_PA).toFixed(2),
        (p.bhp * KW_PER_HP).toFixed(4), "",
      ].join(","));
    }
  }
  writeFileSync(join(OUT_DIR, "prv-ratings.csv"), [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Models:");
  for (const m of models) {
    const rpms = [...new Set(m.points.map((p) => p.rpm))].sort((a, b) => a - b);
    console.log(
      `  ${m.modelCode}  Ø${m.sizeLabel}"  angle ${m.angle}°  rpm ${rpms.join("/")}  ` +
        `maxRPM ${m.maxRpm}  base ₱${m.basePrice}  ${m.points.length} pts`,
    );
  }
  console.log(`\n${catRows.length} catalogue items, ${ratRows.length} rating points.`);
  console.log("Wrote scripts/out/prv-catalogue.csv and scripts/out/prv-ratings.csv");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
