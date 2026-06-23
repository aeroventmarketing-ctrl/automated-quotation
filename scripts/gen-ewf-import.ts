/**
 * Parse the EWF (Panel Fan, belt) and EWFDD (Panel Fan, direct) propeller-fan
 * catalogs into the two CSVs the admin Import screen accepts:
 *   scripts/out/ewf-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/ewf-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Layout — both files share a column grid: MODEL, PROPELLER, BLADE ANGLE,
 * MOTOR HP, FAN RPM, MAX BHP, SONES, then one column per static pressure (in.
 * w.g.) holding the CFM. EWF is one size per tab (2000EWF…6000EWF); EWFDD is a
 * single stacked sheet (1400EWFDD…4800EWFDD, the 42"/48" rows mislabelled
 * "AV42000EWFDD"/"AV4800EWFDD").
 *
 * Each size offers several blade angles. Per the selection rule we keep ONE
 * design angle per size: 40° if the size offers it, otherwise the next lower
 * angle. The kept angle's rows become the size's rating curve(s). EWF (belt) is
 * a multi-rpm grid (the rows are fan-law-scaled motor selections); EWFDD
 * (direct) runs at a fixed motor speed (1750 rpm for 14"–20", 860/1160 rpm for
 * the larger sizes) — flagged `fixedSpeedDirect` so the engine selects at the
 * fan's own speed instead of the centrifugal 2-/4-pole bands.
 *
 * Each row reports a single MAX BHP (not per-SP), so every (CFM, SP) point in a
 * row carries that row's BHP — conservative for motor sizing. Conversions:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * Propeller panel fans have no meaningful outlet area, so no OV check is wired
 * (no outletArea_ft2 spec). EWF/EWFDD carry their own catalogue prices ×1.
 *
 * Run: npx tsx scripts/gen-ewf-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;

const OUT_DIR = join(process.cwd(), "scripts", "out");

// Price per size code (from the supplied EWF/EWFDD price list). Belt and direct
// share the same price for overlapping sizes; EWFDD adds 1400–1800, EWF adds
// 5400–6000.
const EWF_PRICES: Record<number, number> = {
  2000: 13152, 2400: 15703, 3000: 19629, 3600: 23555,
  4200: 27481, 4800: 31376, 5400: 52999, 6000: 60065,
};
const EWFDD_PRICES: Record<number, number> = {
  1400: 9618, 1600: 10992, 1800: 12366, 2000: 13152, 2400: 15703,
  3000: 19629, 3600: 23555, 4200: 27481, 4800: 31376,
};

/** Design blade angle: 40° if offered, else the next lower; else the lowest. */
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
/** Size code from a model label: "AV42000EWFDD" -> 4200, "5400EWF" -> 5400. */
function codeOf(raw: string): number | null {
  const m = raw.replace(/42000/, "4200").match(/(\d{3,4})/);
  return m ? Number(m[1]) : null;
}
/** Motor HP from the catalog cell: handles fractions ("1/4", "3/4") and numbers. */
function parseHp(v: unknown): number | null {
  if (isNum(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac) return Math.round((Number(frac[1]) / Number(frac[2])) * 1000) / 1000;
    return toNum(t);
  }
  return null;
}
// EWF (belt) propeller fans are selected below 1200 rpm; the design ceiling is
// fixed regardless of the (higher) tabulated motor-selection speeds.
const EWF_BELT_MAX_RPM = 1200;

interface RawRow {
  code: number;
  angle: number;
  rpm: number;
  bhp: number;
  motorHp: number | null;
  cfm: Array<{ sp_in: number; cfm: number }>;
}

/** Parse one worksheet into raw rows keyed by size code. */
function parseSheet(ws: ExcelJS.Worksheet): RawRow[] {
  // Header row: the one whose 3rd cell reads "BLADE ANGLE"; SP labels sit in the
  // same row from column 8 onward.
  let hdrRow = 0;
  for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
    if (String(cellVal(ws.getRow(r).getCell(3)) ?? "").trim().toUpperCase() === "BLADE ANGLE") {
      hdrRow = r;
      break;
    }
  }
  if (!hdrRow) return [];

  const spCols: Array<{ sp_in: number; col: number }> = [];
  for (let c = 8; c <= ws.columnCount; c++) {
    const sp = toNum(cellVal(ws.getRow(hdrRow).getCell(c)));
    if (sp != null) spCols.push({ sp_in: sp, col: c });
  }
  if (spCols.length < 2) return [];

  const rows: RawRow[] = [];
  for (let r = hdrRow + 1; r <= ws.rowCount; r++) {
    const raw = String(cellVal(ws.getRow(r).getCell(1)) ?? "").trim();
    if (!/EWF/i.test(raw)) continue;
    const code = codeOf(raw);
    const angle = toNum(cellVal(ws.getRow(r).getCell(3)));
    const motorHp = parseHp(cellVal(ws.getRow(r).getCell(4)));
    const rpm = toNum(cellVal(ws.getRow(r).getCell(5)));
    const bhp = toNum(cellVal(ws.getRow(r).getCell(6)));
    if (code == null || angle == null || rpm == null || bhp == null || rpm <= 0) continue;
    const cfm: RawRow["cfm"] = [];
    for (const sc of spCols) {
      const v = toNum(cellVal(ws.getRow(r).getCell(sc.col)));
      if (v != null && v > 0) cfm.push({ sp_in: sc.sp_in, cfm: v });
    }
    if (cfm.length) rows.push({ code, angle, rpm, bhp, motorHp, cfm });
  }
  return rows;
}

interface Model {
  code: number;
  modelCode: string;
  dia: number;
  sizeLabel: string;
  angle: number;
  maxRpm: number;
  basePrice: number;
  direct: boolean;
  /** Catalog MOTOR HP per rated speed: [rpm, hp] — selection reads the motor here. */
  motorHpByRpm: Array<[number, number]>;
  points: Array<{ rpm: number; cfm: number; sp_in: number; bhp: number }>;
}

/** Collapse raw rows for one catalog (file) into per-size models at the design angle. */
function buildModels(
  rows: RawRow[],
  direct: boolean,
  prices: Record<number, number>,
): Model[] {
  const byCode = new Map<number, RawRow[]>();
  for (const r of rows) {
    const arr = byCode.get(r.code) ?? [];
    arr.push(r);
    byCode.set(r.code, arr);
  }
  const models: Model[] = [];
  for (const [code, rs] of byCode) {
    const angles = [...new Set(rs.map((r) => r.angle))];
    const angle = pickAngle(angles);
    const kept = rs.filter((r) => r.angle === angle);
    const points: Model["points"] = [];
    let topRpm = 0;
    const motorByRpm = new Map<number, number>();
    for (const r of kept) {
      for (const c of r.cfm) points.push({ rpm: r.rpm, cfm: c.cfm, sp_in: c.sp_in, bhp: r.bhp });
      if (r.rpm > topRpm) topRpm = r.rpm;
      if (r.motorHp != null) motorByRpm.set(r.rpm, r.motorHp);
    }
    const price = prices[code];
    if (price == null) {
      console.warn(`  ! no price for ${code}${direct ? "EWFDD" : "EWF"} — skipped`);
      continue;
    }
    const tag = direct ? "EWFDD" : "EWF";
    // Belt EWF is selected under 1200 rpm; direct EWFDD runs at its rated speed.
    const maxRpm = direct ? topRpm : EWF_BELT_MAX_RPM;
    models.push({
      code,
      modelCode: `AV${code}${tag}`,
      dia: code / 100,
      sizeLabel: String(Math.round(code / 100)),
      angle,
      maxRpm,
      basePrice: price,
      direct,
      motorHpByRpm: [...motorByRpm.entries()].sort((a, b) => a[0] - b[0]),
      points,
    });
  }
  models.sort((a, b) => a.code - b.code);
  return models;
}

function csv(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const beltWb = new ExcelJS.Workbook();
  await beltWb.xlsx.readFile(join(process.cwd(), "EWF Catalog.xlsx"));
  const beltRows = beltWb.worksheets.flatMap((ws) => parseSheet(ws));

  const directWb = new ExcelJS.Workbook();
  await directWb.xlsx.readFile(join(process.cwd(), "EWFDD Catalog.xlsx"));
  const directRows = directWb.worksheets.flatMap((ws) => parseSheet(ws));

  const models = [
    ...buildModels(beltRows, false, EWF_PRICES),
    ...buildModels(directRows, true, EWFDD_PRICES),
  ];
  if (!models.length) throw new Error("No EWF/EWFDD models parsed");

  // --- catalogue CSV --------------------------------------------------------
  const catHeader =
    "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows = models.map((m) => {
    const driveWord = m.direct ? "Direct Drive" : "Belt Drive";
    const tag = m.direct ? "EWFDD" : "EWF";
    const description =
      "Panel Fan\n" +
      `Propeller Type / ${driveWord}\n` +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel Aqua Green / Model: ${m.modelCode}`;
    const specs: Record<string, unknown> = {
      bladeDia_in: m.dia,
      bladeAngle_deg: m.angle,
      maxRpm: m.maxRpm,
      propeller: true,
      bladeType: "Propeller",
      drive: m.direct ? "direct" : "belt",
      category: "Propeller Type",
      type: "Panel Fan",
      tag,
    };
    // Motor HP comes from the catalog's MOTOR HP column (per rated speed), not
    // the BHP/0.75 rule. Omitted where the catalog leaves the cell blank.
    if (m.motorHpByRpm.length) specs.motorHpByRpm = m.motorHpByRpm;
    if (m.direct) specs.fixedSpeedDirect = true;
    const name = `Panel Fan ${m.sizeLabel}" Propeller (${tag})`;
    return [
      m.modelCode,
      "PROPELLER",
      csv(name),
      csv(description),
      m.sizeLabel,
      "unit",
      String(m.basePrice),
      "PHP",
      csv(JSON.stringify(specs)),
    ].join(",");
  });
  writeFileSync(join(OUT_DIR, "ewf-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");

  // --- ratings CSV ----------------------------------------------------------
  const ratHeader = "modelCode,rpm,airflow_m3hr,staticPressure_pa,power_kw,efficiency";
  const ratRows: string[] = [];
  let total = 0;
  for (const m of models) {
    for (const p of m.points) {
      ratRows.push(
        [
          m.modelCode,
          String(Math.round(p.rpm)),
          (p.cfm * CFM_TO_M3HR).toFixed(2),
          (p.sp_in * INWG_TO_PA).toFixed(2),
          (p.bhp * KW_PER_HP).toFixed(4),
          "",
        ].join(","),
      );
      total++;
    }
  }
  writeFileSync(join(OUT_DIR, "ewf-ratings.csv"), [ratHeader, ...ratRows].join("\n") + "\n");

  // --- summary --------------------------------------------------------------
  console.log("Models:");
  for (const m of models) {
    const rpms = [...new Set(m.points.map((p) => p.rpm))].sort((a, b) => a - b);
    console.log(
      `  ${m.modelCode}  Ø${m.sizeLabel}"  angle ${m.angle}°  ` +
        `rpm ${rpms.join("/")}  maxRPM ${m.maxRpm}  base ₱${m.basePrice}  ${m.points.length} pts`,
    );
  }
  console.log(`\nTotal rating points: ${total}`);
  console.log("Wrote scripts/out/ewf-catalogue.csv and scripts/out/ewf-ratings.csv");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
