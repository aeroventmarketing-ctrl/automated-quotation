/**
 * Parse the Forward Curve (Series FC) performance catalog into the two CSVs the
 * admin Import screen accepts:
 *   scripts/out/fc-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/fc-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Each model tab holds a CFM × static-pressure grid (each SP split into RPM and
 * BHP). We emit one FanRatingPoint per filled (CFM, SP) cell, converted to SI:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * Forward-curve models are tagged CFAB (Tag/Model = CFAB). Their body price base
 * is the nearest CEB size's catalogue price; the ÷0.9 (CFAB) factor and material
 * factor are applied at quote time, not baked into the stored base price.
 *
 * Run: npx tsx scripts/gen-fc-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;

const SRC = join(process.cwd(), "Aerovent_FC_Forward_Curve_Catalog.xlsx");
const OUT_DIR = join(process.cwd(), "scripts", "out");

// CEB catalogue (blade Ø in, price) from "Categories for Claude.xlsx" — the ×1
// price base. Each FC size adopts the nearest CEB size's price.
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

/** "9 1/8", "30 1/4", "12 5/8", "1-1/4", "1.0", "1/8" -> decimal. */
function parseMixed(raw: string): number | null {
  const s = raw.replace(/["”in.\s]+$/i, "").trim();
  // whole + fraction, separated by space or hyphen: "9 1/8" or "1-1/4"
  let m = s.match(/^(\d+)[\s-](\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const f = Number(s);
  return Number.isNaN(f) ? null : f;
}

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

  const models: Model[] = [];

  for (const ws of wb.worksheets) {
    if (!/^FC-\d+/.test(ws.name)) continue;

    // Title row carries the wheel diameter, e.g. "FC-109 · 9 1/8 in. Wheel ...".
    const title = String(cellVal(ws.getRow(1).getCell(1)) ?? "");
    const diaMatch = title.match(/·\s*([\d\s/.-]+?)\s*in\.?\s*Wheel/i);
    const dia = diaMatch ? parseMixed(diaMatch[1]) : null;
    if (dia == null) throw new Error(`${ws.name}: could not parse wheel diameter from "${title}"`);

    // Locate the header row whose cells read RPM/BHP; the row above holds SP labels.
    let hdrRow = 0;
    for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
      const c3 = String(cellVal(ws.getRow(r).getCell(3)) ?? "").trim().toUpperCase();
      if (c3 === "RPM") { hdrRow = r; break; }
    }
    if (!hdrRow) throw new Error(`${ws.name}: no RPM/BHP header row found`);
    const spRow = hdrRow - 1;

    // Map SP columns: pair each RPM column with the BHP column to its right.
    const spCols: Array<{ sp_in: number; rpmCol: number; bhpCol: number }> = [];
    for (let c = 3; c <= ws.columnCount; c++) {
      const kind = String(cellVal(ws.getRow(hdrRow).getCell(c)) ?? "").trim().toUpperCase();
      if (kind !== "RPM") continue;
      const spLabel = String(cellVal(ws.getRow(spRow).getCell(c)) ?? "").trim();
      const sp_in = parseMixed(spLabel);
      if (sp_in == null) continue;
      spCols.push({ sp_in, rpmCol: c, bhpCol: c + 1 });
    }
    if (spCols.length < 2) throw new Error(`${ws.name}: found ${spCols.length} SP columns`);

    const points: Model["points"] = [];
    const areas: number[] = [];
    let maxRpm = 0;
    for (let r = hdrRow + 1; r <= ws.rowCount; r++) {
      const cfm = cellVal(ws.getRow(r).getCell(1));
      if (!isNum(cfm)) continue; // notes / blank rows
      const ov = cellVal(ws.getRow(r).getCell(2));
      if (isNum(ov) && ov > 0) areas.push(cfm / ov);
      for (const sc of spCols) {
        const rpm = cellVal(ws.getRow(r).getCell(sc.rpmCol));
        const bhp = cellVal(ws.getRow(r).getCell(sc.bhpCol));
        if (isNum(rpm) && isNum(bhp) && rpm > 0) {
          points.push({ rpm, cfm, sp_in: sc.sp_in, bhp });
          if (rpm > maxRpm) maxRpm = rpm;
        }
      }
    }
    if (!points.length) throw new Error(`${ws.name}: no rating points parsed`);

    areas.sort((a, b) => a - b);
    const outletArea = areas.length ? areas[Math.floor(areas.length / 2)] : 0;
    const { cebDia, price } = nearestCebPrice(dia);
    const sizeNum = Math.round(dia * 100);
    const modelCode = `AV${String(sizeNum).padStart(4, "0")}CFAB`;

    models.push({
      modelCode,
      dia,
      sizeLabel: String(dia),
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
      "Centrifugal Blower\n" +
      "Impeller Type / Belt Driven\n" +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel Aqua Green / Model: ${m.modelCode}`;
    const specs = {
      bladeDia_in: m.dia,
      outletArea_ft2: m.outletArea_ft2,
      maxRpm: m.maxRpm,
      bladeType: "Forward Curved",
      drive: "belt",
      category: "Centrifugal Type",
      type: "Centfrifugal Blower",
      tag: "CFAB",
    };
    const name = `Centrifugal Blower ${m.sizeLabel}\" Forward Curved (CFAB)`;
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
  writeOut("fc-catalogue.csv", [catHeader, ...catRows].join("\n") + "\n");

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
  writeOut("fc-ratings.csv", [ratHeader, ...ratRows].join("\n") + "\n");

  // --- summary --------------------------------------------------------------
  console.log("Models:");
  for (const m of models) {
    console.log(
      `  ${m.modelCode}  Ø${m.sizeLabel}"  area ${m.outletArea_ft2} ft²  maxRPM ${m.maxRpm}  ` +
        `base ₱${m.basePrice} (CEB Ø${m.cebDia})  ${m.points.length} pts`,
    );
  }
  console.log(`\nTotal rating points: ${total}`);
  console.log(`Wrote scripts/out/fc-catalogue.csv and scripts/out/fc-ratings.csv`);
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
