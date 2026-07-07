/**
 * Parse the Radial Blower "Paddle Wheel" (Centrifugal Material Handling) catalog
 * into the two CSVs the admin Import screen accepts:
 *   scripts/out/rbpw-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/rbpw-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Source is a SINGLE sheet ("CMH-General Material") holding 16 models stacked
 * vertically. Each block is headed by a col-1 cell like `1281CMH   12.812"`
 * (model code + wheel Ø in inches), then a Fan-Efficiency line, an SP-label row,
 * a CFM|OV|RPM|BHP header row, and the CFM × static-pressure grid. Every SP
 * spans TWO columns (RPM, BHP) — we pair RPM with the BHP to its right. One
 * FanRatingPoint per filled (CFM, SP) cell, converted to SI:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * Radial Blower Paddle Wheel is tagged CMH (model codes end "CMH"). Its wheel
 * sizes adopt the nearest CEB size's catalogue price as the stored base; the
 * Radial-Blower price factor is applied at quote time via TAG_FACTORS["CMH"].
 * Belt drive selects at any RPM; direct drive is constrained to the standard
 * 2/4/6-pole bands by the selector's directDrive flag.
 *
 * Run: npx tsx scripts/gen-rbpw-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;

const SRC = join(process.cwd(), "Radial Blower Paddle Wheel Catalog.xlsx");
const OUT_DIR = join(process.cwd(), "scripts", "out");

// CEB catalogue (blade Ø in, price) — the price base (same table as HPB/CIEB).
// Each Radial Blower size adopts the nearest CEB size's price; the Radial-Blower
// factor is applied at quote time via TAG_FACTORS["CMH"].
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

// Corrected performance grids supplied by the client where the source sheet is
// wrong. AV5050CMH's block in the xlsx duplicated AV4512CMH's numbers; this is
// the correct 50.5" table. SP levels (inWG): 1,2,4,6,8,12,16,20,24,28,32; each
// row is [CFM, OV, then (RPM,BHP) per SP with null for blanks].
const OVERRIDE_SP = [1, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32];
const OVERRIDES: Record<string, Array<Array<number | null>>> = {
  AV5050CMH: [
    [5544, 1200, 277, 1.46, 376, 2.79, 525, 5.71, 641, 8.81, null, null, null, null, null, null, null, null, null, null, null, null],
    [7392, 1600, 296, 2.14, 387, 3.8, 530, 7.47, 644, 11.35, 741, 15.3, 904, 23.7, null, null, null, null, null, null, null, null],
    [9240, 2000, 321, 3.11, 405, 5.09, 538, 9.32, 649, 13.96, 745, 18.8, 906, 28.5, 1043, 38.72, null, null, null, null, null, null],
    [11088, 2400, 348, 4.34, 427, 6.67, 552, 11.53, 657, 16.72, 750, 22.23, 910, 33.74, 1046, 45.39, 1166, 57.35, 1274, 69.68, 1374, 82.65, null, null],
    [12936, 2800, 377, 5.9, 452, 8.63, 571, 14.2, 670, 19.93, 759, 26.02, 915, 38.9, 1050, 52.36, 1169, 65.81, 1276, 79.32, 1375, 93.28, 1468, 107.82],
    [14784, 3200, 408, 7.86, 478, 10.93, 592, 17.18, 688, 23.73, 772, 30.29, 922, 44.26, 1055, 59.24, 1173, 74.49, 1280, 89.73, 1378, 104.97, 1470, 120.63],
    [16632, 3600, 442, 10.37, 506, 13.7, 615, 20.64, 707, 27.83, 789, 35.19, 932, 50.09, 1061, 66.19, 1178, 83.03, 1284, 100.05, 1382, 117.11, 1473, 134.15],
    [18480, 4000, 477, 13.41, 535, 16.93, 640, 24.66, 729, 32.52, 808, 40.58, 947, 56.86, 1070, 73.74, 1184, 91.7, 1289, 110.21, 1386, 129.0, 1476, 147.65],
    [20328, 4400, 513, 17.07, 567, 20.9, 667, 29.33, 752, 37.73, 828, 46.34, 964, 64.22, 1083, 82.21, 1193, 101.11, 1296, 120.87, 1391, 140.78, 1481, 161.33],
    [22176, 4800, 550, 21.41, 599, 25.37, 694, 34.46, 777, 43.69, 851, 52.97, 982, 72.03, 1098, 91.33, 1204, 111.1, 1304, 131.85, 1398, 153.19, 1487, 175.11],
    [24024, 5200, 588, 26.55, 634, 30.82, 722, 40.23, 803, 50.32, 875, 60.3, 1002, 80.53, 1116, 101.47, 1219, 122.39, 1315, 143.81, 1406, 165.96, 1493, 188.9],
    [25872, 5600, 626, 32.42, 669, 36.94, 752, 46.91, 830, 57.67, 900, 68.37, 1024, 89.9, 1135, 112.21, 1236, 134.57, 1329, 156.93, 1418, 180.25, 1502, 203.87],
    [27720, 6000, 665, 39.25, 705, 43.96, 782, 54.19, 858, 65.82, 926, 77.23, 1047, 100.06, 1155, 123.56, 1254, 147.41, 1345, 171.04, 1431, 195.12, 1513, 219.74],
    [29568, 6400, 704, 46.95, 741, 51.79, 814, 62.54, 886, 74.62, 953, 86.97, 1071, 111.15, 1176, 135.64, 1273, 160.94, 1363, 186.26, 1447, 211.49, null, null],
    [31416, 6800, 743, 55.58, 778, 60.68, 847, 71.89, 915, 84.33, 980, 97.37, 1096, 123.2, 1199, 149.0, 1293, 175.2, 1382, 202.29, 1464, 228.66, null, null],
    [33264, 7200, 782, 65.18, 816, 70.76, 881, 82.31, 945, 95.03, 1008, 108.77, 1121, 135.91, 1222, 163.06, 1315, 190.79, 1401, 218.68, 1482, 246.69, null, null],
  ],
};

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

  // Locate each block by its col-1 header cell: `1281CMH   12.812"`.
  const headerRe = /^(\d+)\s*CMH\s+([\d.]+)"?/;
  const blockStarts: Array<{ row: number; code: string; dia: number }> = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = String(cellVal(ws.getRow(r).getCell(1)) ?? "").trim();
    const m = v.match(headerRe);
    if (m) blockStarts.push({ row: r, code: m[1], dia: Number(m[2]) });
  }
  if (!blockStarts.length) throw new Error("No <code>CMH block headers found");

  for (let i = 0; i < blockStarts.length; i++) {
    const { row: startRow, code, dia } = blockStarts[i];
    const endRow = i + 1 < blockStarts.length ? blockStarts[i + 1].row - 1 : ws.rowCount;
    const modelCode = `AV${code}CMH`;

    // Client-corrected grid overrides the sheet block where the source is wrong.
    const override = OVERRIDES[modelCode];
    if (override) {
      const points: Model["points"] = [];
      const areas: number[] = [];
      let maxRpm = 0;
      for (const row of override) {
        const cfm = row[0];
        const ov = row[1];
        if (cfm == null) continue;
        if (ov != null && ov > 0) areas.push(cfm / ov);
        for (let s = 0; s < OVERRIDE_SP.length; s++) {
          const rpm = row[2 + s * 2];
          const bhp = row[3 + s * 2];
          if (rpm != null && bhp != null && rpm > 0) {
            points.push({ rpm, cfm, sp_in: OVERRIDE_SP[s], bhp });
            if (rpm > maxRpm) maxRpm = rpm;
          }
        }
      }
      areas.sort((a, b) => a - b);
      const outletArea = areas.length ? areas[Math.floor(areas.length / 2)] : 0;
      const { cebDia, price } = nearestCebPrice(dia);
      models.push({
        modelCode, code, dia, sizeLabel: sizeLabelOf(dia),
        outletArea_ft2: Math.round(outletArea * 1000) / 1000,
        maxRpm, basePrice: price, cebDia, points,
      });
      continue;
    }

    // Within the block, find the RPM/BHP header row (col 3 == "RPM"); the row
    // above it holds the SP labels.
    let hdrRow = 0;
    for (let r = startRow; r <= Math.min(startRow + 6, endRow); r++) {
      if (String(cellVal(ws.getRow(r).getCell(3)) ?? "").trim().toUpperCase() === "RPM") {
        hdrRow = r;
        break;
      }
    }
    if (!hdrRow) throw new Error(`${modelCode}: no RPM/BHP header row found`);
    const spRow = hdrRow - 1;

    // Each SP spans 2 cols (RPM, BHP); pair RPM with the BHP to its right.
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
      modelCode,
      code,
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
  const catHeader = "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows = models.map((m) => {
    const description =
      "Radial Blower / Centrifugal Material Handling\n" +
      "Paddle Wheel / Belt Driven\n" +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel / Model: ${m.modelCode}`;
    const specs = {
      bladeDia_in: m.dia,
      outletArea_ft2: m.outletArea_ft2,
      maxRpm: m.maxRpm,
      bladeType: "Paddle Wheel",
      drive: "belt",
      category: "Centrifugal Type",
      type: "Radial Blower",
      tag: "CMH",
    };
    const name = `Radial Blower ${m.sizeLabel}\" Paddle Wheel (CMH)`;
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
  writeOut("rbpw-catalogue.csv", [catHeader, ...catRows].join("\n") + "\n");

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
  writeOut("rbpw-ratings.csv", [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Models:");
  for (const m of models) {
    console.log(
      `  ${m.modelCode}  Ø${m.sizeLabel}"  area ${m.outletArea_ft2} ft²  maxRPM ${m.maxRpm}  ` +
        `base ₱${m.basePrice} (CEB Ø${m.cebDia}")  ${m.points.length} pts`,
    );
  }
  console.log(`\nModels: ${models.length}   Total rating points: ${total}`);
  console.log(`Wrote scripts/out/rbpw-catalogue.csv and scripts/out/rbpw-ratings.csv`);
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
