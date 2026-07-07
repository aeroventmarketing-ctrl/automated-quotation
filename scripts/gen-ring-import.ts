/**
 * Parse the Radial Blower "Ring Paddle Wheel" (Centrifugal Material — Air)
 * catalog into the two CSVs the admin Import screen accepts:
 *   scripts/out/ring-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/ring-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Same single-sheet stacked-block layout as the Paddle Wheel (CMH) catalog: 16
 * models on one sheet ("CMA-Air"), each block headed by a col-1 cell like
 * `1281CMA   12.812"` (model code + wheel Ø in inches), then a Fan-Efficiency
 * line, an SP-label row, a CFM|OV|RPM|BHP header row, and the CFM ×
 * static-pressure grid. Every SP spans TWO columns (RPM, BHP). One
 * FanRatingPoint per filled (CFM, SP) cell, converted to SI:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * Ring Paddle Wheel is tagged CMA (model codes end "CMA"). Wheel sizes adopt the
 * nearest CEB size's catalogue price as the stored base; the Radial-Blower price
 * factor is applied at quote time via TAG_FACTORS["CMA"].
 *
 * Run: npx tsx scripts/gen-ring-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;

const SRC = join(process.cwd(), "Radial Blower Ring Paddle Catalog.xlsx");
const OUT_DIR = join(process.cwd(), "scripts", "out");

// CEB catalogue (blade Ø in, price) — the shared price base. Each Ring Paddle
// size adopts the nearest CEB size's price; the factor is applied at quote time.
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
function toNum(v: unknown): number | null {
  if (isNum(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    if (!Number.isNaN(n) && v.trim() !== "") return n;
  }
  return null;
}
/** `1" SP`, `12" SP` -> inches w.g. */
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
  cebDia: number;
  points: Array<{ rpm: number; cfm: number; sp_in: number; bhp: number }>;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const ws = wb.worksheets[0];
  const models: Model[] = [];

  // Locate each block by its col-1 header cell: `1281CMA   12.812"`. A couple of
  // block headers in the source are mistyped "…CMH" — accept CM[AH] but always
  // emit the CMA model code (this is the Air / Ring Paddle catalogue).
  const headerRe = /^(\d+)\s*CM[A-Z]\s+([\d.]+)"?/i;
  const blockStarts: Array<{ row: number; code: string; dia: number }> = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = String(cellVal(ws.getRow(r).getCell(1)) ?? "").trim();
    const m = v.match(headerRe);
    if (m) blockStarts.push({ row: r, code: m[1], dia: Number(m[2]) });
  }
  if (!blockStarts.length) throw new Error("No <code>CMA block headers found");

  for (let i = 0; i < blockStarts.length; i++) {
    const { row: startRow, code, dia } = blockStarts[i];
    const endRow = i + 1 < blockStarts.length ? blockStarts[i + 1].row - 1 : ws.rowCount;
    const modelCode = `AV${code}CMA`;

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
      if (cfm == null) continue; // skips the "MAXIMUM RPM:" note and blank rows
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
      modelCode, code, dia, sizeLabel: sizeLabelOf(dia),
      outletArea_ft2: Math.round(outletArea * 1000) / 1000,
      maxRpm, basePrice: price, cebDia, points,
    });
  }
  models.sort((a, b) => a.dia - b.dia);

  // --- catalogue CSV --------------------------------------------------------
  const catHeader = "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows = models.map((m) => {
    const description =
      "Radial Blower / Centrifugal Material Handling\n" +
      "Ring Paddle Wheel / Belt Driven\n" +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel / Model: ${m.modelCode}`;
    const specs = {
      bladeDia_in: m.dia,
      outletArea_ft2: m.outletArea_ft2,
      maxRpm: m.maxRpm,
      bladeType: "Ring Paddle Wheel",
      drive: "belt",
      category: "Centrifugal Type",
      type: "Radial Blower",
      tag: "CMA",
    };
    const name = `Radial Blower ${m.sizeLabel}\" Ring Paddle Wheel (CMA)`;
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
  writeOut("ring-catalogue.csv", [catHeader, ...catRows].join("\n") + "\n");

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
  writeOut("ring-ratings.csv", [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Models:");
  for (const m of models) {
    console.log(
      `  ${m.modelCode}  Ø${m.sizeLabel}"  area ${m.outletArea_ft2} ft²  maxRPM ${m.maxRpm}  ` +
        `base ₱${m.basePrice} (CEB Ø${m.cebDia}")  ${m.points.length} pts`,
    );
  }
  console.log(`\nModels: ${models.length}   Total rating points: ${total}`);
  console.log(`Wrote scripts/out/ring-catalogue.csv and scripts/out/ring-ratings.csv`);
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
