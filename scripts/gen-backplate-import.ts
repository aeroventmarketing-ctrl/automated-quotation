/**
 * Parse the Radial Blower "Backplate Paddle Wheel" (Centrifugal Material —
 * Shredding) catalog into the two CSVs the admin Import screen accepts:
 *   scripts/out/backplate-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/backplate-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Same single-sheet stacked-block layout as the Paddle Wheel (CMH) and Ring
 * Paddle Wheel (CMA) catalogs. NOTE: the source sheet ("CMH-Shredding") reuses
 * "…CMH" for its internal block codes, which collides with the Paddle Wheel
 * catalogue — so this catalogue is emitted under its OWN tag CMB (model codes
 * end "CMB"), keyed off the size code only.
 *
 * One FanRatingPoint per filled (CFM, SP) cell, converted to SI:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * Prices come from the client's Radial-Blower price list (shared across all
 * three blade types, keyed by size code); TAG_FACTORS["CMB"] is ×1 (the stored
 * price is already the final selling price).
 *
 * Run: npx tsx scripts/gen-backplate-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { RADIAL_PRICES } from "./radial-prices";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;

const SRC = join(process.cwd(), "Radial Blower Backplate Paddle Catalog.xlsx");
const OUT_DIR = join(process.cwd(), "scripts", "out");

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
function parseSp(raw: string): number | null {
  const s = raw.replace(/SP/i, "").replace(/["”in.\s]+$/i, "").trim();
  const f = Number(s);
  return Number.isNaN(f) ? null : f;
}
const sizeLabelOf = (dia: number): string =>
  Number.isInteger(dia) ? String(dia) : String(Math.round(dia * 1000) / 1000);

interface Model {
  modelCode: string;
  code: string;
  dia: number;
  sizeLabel: string;
  outletArea_ft2: number;
  maxRpm: number;
  basePrice: number;
  points: Array<{ rpm: number; cfm: number; sp_in: number; bhp: number }>;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const ws = wb.worksheets[0];
  const models: Model[] = [];

  // Sizes with no listed price (e.g. 8525 / 85.25") are held back until priced.
  const EXCLUDE = new Set(["8525"]);

  const headerRe = /^(\d+)\s*CM[A-Z]\s+([\d.]+)"?/i;
  const blockStarts: Array<{ row: number; code: string; dia: number }> = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = String(cellVal(ws.getRow(r).getCell(1)) ?? "").trim();
    const m = v.match(headerRe);
    if (m) blockStarts.push({ row: r, code: m[1], dia: Number(m[2]) });
  }
  if (!blockStarts.length) throw new Error("No <code>CM* block headers found");

  for (let i = 0; i < blockStarts.length; i++) {
    const { row: startRow, code, dia } = blockStarts[i];
    const endRow = i + 1 < blockStarts.length ? blockStarts[i + 1].row - 1 : ws.rowCount;
    if (EXCLUDE.has(code)) continue;
    const modelCode = `AV${code}CMB`;
    const price = RADIAL_PRICES[code];
    if (price == null) throw new Error(`${modelCode}: no price for size code ${code}`);

    let hdrRow = 0;
    for (let r = startRow; r <= Math.min(startRow + 6, endRow); r++) {
      if (String(cellVal(ws.getRow(r).getCell(3)) ?? "").trim().toUpperCase() === "RPM") {
        hdrRow = r;
        break;
      }
    }
    if (!hdrRow) throw new Error(`${modelCode}: no RPM/BHP header row found`);
    const spRow = hdrRow - 1;

    const spCols: Array<{ sp_in: number; rpmCol: number; bhpCol: number }> = [];
    for (let c = 3; c <= ws.columnCount; c++) {
      if (String(cellVal(ws.getRow(hdrRow).getCell(c)) ?? "").trim().toUpperCase() !== "RPM") continue;
      const sp_in = parseSp(String(cellVal(ws.getRow(spRow).getCell(c)) ?? "").trim());
      if (sp_in == null) continue;
      spCols.push({ sp_in, rpmCol: c, bhpCol: c + 1 });
    }
    if (spCols.length < 2) throw new Error(`${modelCode}: found ${spCols.length} SP columns`);

    const points: Model["points"] = [];
    const areas: number[] = [];
    let maxRpm = 0;
    for (let r = hdrRow + 1; r <= endRow; r++) {
      const cfm = toNum(cellVal(ws.getRow(r).getCell(1)));
      if (cfm == null) continue;
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

    models.push({
      modelCode, code, dia, sizeLabel: sizeLabelOf(dia),
      outletArea_ft2: Math.round(outletArea * 1000) / 1000,
      maxRpm, basePrice: price, points,
    });
  }
  models.sort((a, b) => a.dia - b.dia);

  // --- catalogue CSV --------------------------------------------------------
  const catHeader = "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows = models.map((m) => {
    const description =
      "Radial Blower / Centrifugal Material Handling\n" +
      "Backplate Paddle Wheel / Belt Driven\n" +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel / Model: ${m.modelCode}`;
    const specs = {
      bladeDia_in: m.dia,
      outletArea_ft2: m.outletArea_ft2,
      maxRpm: m.maxRpm,
      bladeType: "Backplate Paddle Wheel",
      drive: "belt",
      category: "Centrifugal Type",
      type: "Radial Blower",
      tag: "CMB",
    };
    const name = `Radial Blower ${m.sizeLabel}\" Backplate Paddle Wheel (CMB)`;
    return [
      m.modelCode, "CENTRIFUGAL", csv(name), csv(description), m.sizeLabel,
      "unit", String(m.basePrice), "PHP", csv(JSON.stringify(specs)),
    ].join(",");
  });
  writeOut("backplate-catalogue.csv", [catHeader, ...catRows].join("\n") + "\n");

  // --- ratings CSV ----------------------------------------------------------
  const ratHeader = "modelCode,rpm,airflow_m3hr,staticPressure_pa,power_kw,efficiency";
  const ratRows: string[] = [];
  let total = 0;
  for (const m of models) {
    for (const p of m.points) {
      ratRows.push([
        m.modelCode, String(Math.round(p.rpm)),
        (p.cfm * CFM_TO_M3HR).toFixed(2), (p.sp_in * INWG_TO_PA).toFixed(2),
        (p.bhp * KW_PER_HP).toFixed(4), "",
      ].join(","));
      total++;
    }
  }
  writeOut("backplate-ratings.csv", [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Models:");
  for (const m of models) {
    console.log(
      `  ${m.modelCode}  Ø${m.sizeLabel}"  area ${m.outletArea_ft2} ft²  maxRPM ${m.maxRpm}  ` +
        `price ₱${m.basePrice}  ${m.points.length} pts`,
    );
  }
  console.log(`\nModels: ${models.length}   Total rating points: ${total}`);
  console.log(`Wrote scripts/out/backplate-catalogue.csv and scripts/out/backplate-ratings.csv`);
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
