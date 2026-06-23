/**
 * Parse the DIDW (Double Inlet Double Width) performance catalog into the two
 * CSVs the admin Import screen accepts:
 *   scripts/out/didw-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/didw-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Unlike the FC catalog (one model per tab), the DIDW catalog stacks every model
 * in a single "Performance DWDI" sheet. Each block is:
 *   <size>DIDWCEB                       (model header, e.g. "1225DIDWCEB")
 *   Outlet Area … Wheel Dia … Max BHP … (info line)
 *   MAXIMUM RPM: Class I — … …          (class max-RPM line)
 *   CFM | OV | 0.5" SP | 1" SP | …       (SP-label row; each SP spans 2 cols)
 *        |    | RPM | BHP | RPM | BHP …  (RPM/BHP sub-header)
 *   <data rows>                          (CFM, OV, then RPM/BHP per SP)
 *
 * We emit one FanRatingPoint per filled (CFM, SP) cell, converted to SI:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * DIDW is backward-curve only and is tagged DIDWCEB. Its body price base is the
 * nearest CEB size's catalogue price; the ÷0.57 (DIDW) factor and material
 * factor are applied at quote time, not baked into the stored base price.
 *
 * Sizes without a confirmed price are excluded for now (EXCLUDE_CODES) — e.g.
 * the 89" (8900) wheel, whose price will be added later.
 *
 * Run: npx tsx scripts/gen-didw-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;

const SRC = join(process.cwd(), "DIDWCEB catalog.xlsx");
const SHEET = "Performance DWDI";
const OUT_DIR = join(process.cwd(), "scripts", "out");

// Size codes (Ø ×100) to skip until a confirmed price exists. The 89" (8900)
// wheel has no CEB price yet; it will be added with its own price later.
const EXCLUDE_CODES = new Set(["8900"]);

// Correct mislabelled size codes to their CEB-aligned nominal size. The sheet's
// "4250" block is the 40.25" wheel (AV4025DIDWCEB), priced off CEB 40.25".
const CODE_REMAP: Record<string, string> = { "4250": "4025" };

// CEB catalogue (blade Ø in, price) from "Categories for Claude.xlsx" — the ×1
// price base. Each DIDW size adopts the nearest CEB size's price; sizes with no
// CEB price (89", 98.25") are excluded so they can't be chosen as a base.
const CEB_PRICES: Array<[number, number]> = [
  [9, 17575], [10.5, 17575], [12.25, 19563], [13.5, 22738], [15, 24390],
  [16.5, 26451], [18.25, 29506], [20, 34977], [22.25, 36654], [24.5, 39349],
  [27, 47634], [30, 52823], [33, 65433], [36.5, 83827], [40.25, 99281],
  [44.5, 125775], [49, 146672], [54.5, 221496], [60, 253731], [66, 325385],
  [73, 359001], [80.75, 660691],
];
function nearestCebPrice(dia: number): { cebDia: number; price: number } {
  let best = CEB_PRICES[0];
  for (const row of CEB_PRICES) {
    if (Math.abs(row[0] - dia) < Math.abs(best[0] - dia)) best = row;
  }
  return { cebDia: best[0], price: best[1] };
}

const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);
const cellVal = (c: ExcelJS.Cell): unknown => {
  const v = c.value as unknown;
  if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) {
    return (v as { result: unknown }).result;
  }
  return v;
};
/** Coerce a cell value (number, or numeric string like "1240") to a number. */
function toNum(v: unknown): number | null {
  if (isNum(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    if (!Number.isNaN(n) && v.trim() !== "") return n;
  }
  return null;
}

/** SP label -> inches w.g. Handles `0.5" SP`, `1" SP`, `1/2"`, `1-1/4"`. */
function parseSp(raw: string): number | null {
  const s = raw.replace(/\s*SP\s*$/i, "").replace(/["”in.\s]+$/i, "").trim();
  let m = s.match(/^(\d+)[\s-](\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const f = Number(s);
  return Number.isNaN(f) ? null : f;
}

/** Format a wheel Ø as a label: 12.25 -> "12.25", 15 -> "15". */
const sizeLabelOf = (dia: number): string =>
  Number.isInteger(dia) ? String(dia) : String(Math.round(dia * 100) / 100);

interface Model {
  modelCode: string;
  dia: number;
  sizeLabel: string;
  outletArea_ft2: number;
  maxRpm: number;
  basePrice: number;
  cebDia: number;
  points: Array<{ rpm: number; cfm: number; sp_in: number; bhp: number }>;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`Sheet "${SHEET}" not found`);

  // Pass 1: locate every model-header row ("<size>DIDWCEB" in col 1).
  const heads: Array<{ row: number; code: string }> = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = String(cellVal(ws.getRow(r).getCell(1)) ?? "").trim();
    const m = v.match(/^(\d+)DIDWCEB$/i);
    if (m) heads.push({ row: r, code: m[1] });
  }
  if (!heads.length) throw new Error("No <size>DIDWCEB model headers found");

  const models: Model[] = [];
  for (let i = 0; i < heads.length; i++) {
    const { row: headRow, code: srcCode } = heads[i];
    const endRow = i + 1 < heads.length ? heads[i + 1].row - 1 : ws.rowCount;
    if (EXCLUDE_CODES.has(srcCode)) continue; // no confirmed price yet
    const code = CODE_REMAP[srcCode] ?? srcCode;
    const dia = Number(code) / 100;
    const modelCode = `AV${code}DIDWCEB`;

    // Find the RPM/BHP sub-header row within the block; SP labels sit one above.
    let rpmRow = 0;
    for (let r = headRow + 1; r <= Math.min(headRow + 6, endRow); r++) {
      if (String(cellVal(ws.getRow(r).getCell(3)) ?? "").trim().toUpperCase() === "RPM") {
        rpmRow = r;
        break;
      }
    }
    if (!rpmRow) throw new Error(`${modelCode}: no RPM/BHP header row found`);
    const spRow = rpmRow - 1;

    // Map SP columns: pair each RPM column with the BHP column to its right.
    const spCols: Array<{ sp_in: number; rpmCol: number; bhpCol: number }> = [];
    for (let c = 3; c <= ws.columnCount; c++) {
      if (String(cellVal(ws.getRow(rpmRow).getCell(c)) ?? "").trim().toUpperCase() !== "RPM") {
        continue;
      }
      const sp_in = parseSp(String(cellVal(ws.getRow(spRow).getCell(c)) ?? "").trim());
      if (sp_in == null) continue;
      spCols.push({ sp_in, rpmCol: c, bhpCol: c + 1 });
    }
    if (spCols.length < 2) throw new Error(`${modelCode}: found ${spCols.length} SP columns`);

    const points: Model["points"] = [];
    const areas: number[] = [];
    let maxRpm = 0;
    for (let r = rpmRow + 1; r <= endRow; r++) {
      const cfm = toNum(cellVal(ws.getRow(r).getCell(1)));
      if (cfm == null) continue; // notes / blank rows between blocks
      const ov = toNum(cellVal(ws.getRow(r).getCell(2)));
      if (ov != null && ov > 0) areas.push(cfm / ov);
      for (const sc of spCols) {
        const rpm = toNum(cellVal(ws.getRow(r).getCell(sc.rpmCol)));
        const bhp = toNum(cellVal(ws.getRow(r).getCell(sc.bhpCol)));
        if (rpm != null && bhp != null && rpm > 0) {
          points.push({ rpm, cfm, sp_in: sc.sp_in, bhp });
          if (rpm > maxRpm) maxRpm = rpm;
        }
      }
    }
    if (!points.length) throw new Error(`${modelCode}: no rating points parsed`);

    areas.sort((a, b) => a - b);
    const outletArea = areas.length ? areas[Math.floor(areas.length / 2)] : 0;
    const { cebDia, price } = nearestCebPrice(dia);

    models.push({
      modelCode,
      dia,
      sizeLabel: sizeLabelOf(dia),
      outletArea_ft2: Math.round(outletArea * 1000) / 1000,
      maxRpm,
      basePrice: price,
      cebDia,
      points,
    });
  }

  models.sort((a, b) => a.dia - b.dia);

  // --- catalogue CSV --------------------------------------------------------
  const catHeader =
    "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows = models.map((m) => {
    const description =
      "Centrifugal Blower - DIDW\n" +
      "Impeller Type / Belt Driven\n" +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel Aqua Green / Model: ${m.modelCode}`;
    const specs = {
      bladeDia_in: m.dia,
      outletArea_ft2: m.outletArea_ft2,
      maxRpm: m.maxRpm,
      bladeType: "Backward Curved",
      drive: "belt",
      category: "Centrifugal Type",
      type: "Double Inlet Double Width (DIDW)",
      tag: "DIDWCEB",
    };
    const name = `Centrifugal Blower - DIDW ${m.sizeLabel}\" Double Inlet Double Width (DIDWCEB)`;
    return [
      m.modelCode,
      "CENTRIFUGAL",
      csv(name),
      csv(description),
      m.sizeLabel,
      "unit",
      String(m.basePrice),
      "PHP",
      csv(JSON.stringify(specs)),
    ].join(",");
  });
  writeOut("didw-catalogue.csv", [catHeader, ...catRows].join("\n") + "\n");

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
  writeOut("didw-ratings.csv", [ratHeader, ...ratRows].join("\n") + "\n");

  // --- summary --------------------------------------------------------------
  console.log("Models:");
  for (const m of models) {
    console.log(
      `  ${m.modelCode}  Ø${m.sizeLabel}"  area ${m.outletArea_ft2} ft²  maxRPM ${m.maxRpm}  ` +
        `base ₱${m.basePrice} (CEB Ø${m.cebDia}")  ${m.points.length} pts`,
    );
  }
  console.log(`\nTotal rating points: ${total}`);
  console.log(`Wrote scripts/out/didw-catalogue.csv and scripts/out/didw-ratings.csv`);
}

function csv(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
function writeOut(name: string, content: string) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, name), content);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
