/**
 * Parse the Plug Fan performance catalog into the two CSVs the admin Import
 * screen accepts:
 *   scripts/out/plugfan-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/plugfan-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Each model is its own tab ("1225CPF", …) named by wheel diameter ×100
 * (1225 = 12.25"). Each tab holds a CFM × static-pressure grid where every SP
 * spans TWO columns (RPM, BHP) starting at column 2 (there is NO outlet-velocity
 * column). One FanRatingPoint per filled (CFM, SP) cell, converted to SI:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * A Plug Fan is a backward-curved centrifugal impeller without a scroll housing.
 * Tag CPF, its own catalogue. Price is the SAME as the matching CEB size, and
 * TAG_FACTORS["CPF"] is ×1 (so body price = CEB). Selection is the standard
 * duty-based method (belt any RPM; direct → standard 2/4/6-pole bands via the
 * selector's directDrive flag), and the vibration-isolator recommendation is the
 * standard Centrifugal-Type set — all the same as CEB.
 *
 * Run: npx tsx scripts/gen-plugfan-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;

const SRC = join(process.cwd(), "Plug Fan Catalog.xlsx");
const OUT_DIR = join(process.cwd(), "scripts", "out");

// CEB catalogue (blade Ø in, price) — the price base. Each Plug Fan size adopts
// the matching CEB size's price exactly (Plug Fan price = CEB price, factor ×1).
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
/** `0.5" SP`, `2" SP` -> inches w.g. */
function parseSp(raw: string): number | null {
  const s = raw.replace(/SP/i, "").replace(/["”in.\s]+$/i, "").trim();
  const f = Number(s);
  return Number.isNaN(f) ? null : f;
}
const sizeLabelOf = (dia: number): string =>
  Number.isInteger(dia) ? String(dia) : String(Math.round(dia * 100) / 100);

interface Model {
  modelCode: string;
  dia: number;
  sizeLabel: string;
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
    const tab = ws.name.trim();
    const tm = tab.match(/^(\d+)CPF$/i);
    if (!tm) continue;
    const code = tm[1];
    const dia = Number(code) / 100;
    const modelCode = `AV${code}CPF`;

    // Locate the RPM/BHP header row (RPM appears in column 2); the row above it
    // holds the SP labels. No outlet-velocity column — SP columns start at col 2.
    let hdrRow = 0;
    for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
      if (String(cellVal(ws.getRow(r).getCell(2)) ?? "").trim().toUpperCase() === "RPM") {
        hdrRow = r;
        break;
      }
    }
    if (!hdrRow) throw new Error(`${modelCode}: no RPM/BHP header row found`);
    const spRow = hdrRow - 1;

    // Each SP spans 2 cols (RPM, BHP); pair RPM with the BHP to its right.
    const spCols: Array<{ sp_in: number; rpmCol: number; bhpCol: number }> = [];
    for (let c = 2; c <= ws.columnCount; c++) {
      if (String(cellVal(ws.getRow(hdrRow).getCell(c)) ?? "").trim().toUpperCase() !== "RPM") continue;
      const sp_in = parseSp(String(cellVal(ws.getRow(spRow).getCell(c)) ?? "").trim());
      if (sp_in == null) continue;
      spCols.push({ sp_in, rpmCol: c, bhpCol: c + 1 });
    }
    if (spCols.length < 2) throw new Error(`${modelCode}: found ${spCols.length} SP columns`);

    const points: Model["points"] = [];
    let maxRpm = 0;
    for (let r = hdrRow + 1; r <= ws.rowCount; r++) {
      const cfm = toNum(cellVal(ws.getRow(r).getCell(1)));
      if (cfm == null) continue;
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

    const { cebDia, price } = nearestCebPrice(dia);
    models.push({ modelCode, dia, sizeLabel: sizeLabelOf(dia), maxRpm, basePrice: price, cebDia, points });
  }
  if (!models.length) throw new Error("No <size>CPF tabs found");
  models.sort((a, b) => a.dia - b.dia);

  // --- catalogue CSV --------------------------------------------------------
  const catHeader = "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows = models.map((m) => {
    const description =
      "Plug Fan\n" +
      "Backward Curved / Belt Driven\n" +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel Aqua Green / Model: ${m.modelCode}`;
    const specs = {
      bladeDia_in: m.dia,
      maxRpm: m.maxRpm,
      bladeType: "Backward Curved",
      drive: "belt",
      category: "Centrifugal Type",
      type: "Plug Fan",
      tag: "CPF",
    };
    const name = `Plug Fan ${m.sizeLabel}\" Backward Curved (CPF)`;
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
  writeOut("plugfan-catalogue.csv", [catHeader, ...catRows].join("\n") + "\n");

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
  writeOut("plugfan-ratings.csv", [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Models:");
  for (const m of models) {
    console.log(
      `  ${m.modelCode}  Ø${m.sizeLabel}"  maxRPM ${m.maxRpm}  ` +
        `price ₱${m.basePrice} (= CEB Ø${m.cebDia}")  ${m.points.length} pts`,
    );
  }
  console.log(`\nModels: ${models.length}   Total rating points: ${total}`);
  console.log(`Wrote scripts/out/plugfan-catalogue.csv and scripts/out/plugfan-ratings.csv`);
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
