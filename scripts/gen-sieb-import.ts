/**
 * Parse the SIEB (Tubular Inline — Centrifugal Inline) performance catalog into:
 *   scripts/out/sieb-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/sieb-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Each model is its own tab ("0900SIEB", …). Unlike CIEB, the SIEB table is
 * RPM-indexed: each row is a fixed RPM and every static-pressure column gives
 * CFM / BHP / Sone at that RPM. We emit one FanRatingPoint per filled (RPM, SP)
 * cell (Sone ignored), converted to SI:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * SIEB is backward-inclined inline (Tubular Inline Type), tagged SIEB. Its size
 * codes align 1:1 with CEB and its body price is the matching CEB size's price
 * ×1 (no extra factor); the material factor is applied at quote time.
 *
 * Run: npx tsx scripts/gen-sieb-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;

const SRC = join(process.cwd(), "SIEB Catalog.xlsx");
const OUT_DIR = join(process.cwd(), "scripts", "out");

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
function parseSp(raw: string): number | null {
  const s = raw.replace(/["”in.\s]+$/i, "").trim();
  let m = s.match(/^(\d+)[\s-](\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const f = Number(s);
  return Number.isNaN(f) ? null : f;
}
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

  const models: Model[] = [];

  for (const ws of wb.worksheets) {
    const tab = ws.name.trim();
    const tm = tab.match(/^(\d+)SIEB$/i);
    if (!tm) continue;
    const code = tm[1];
    const dia = Number(code) / 100;
    const modelCode = `AV${code}SIEB`;

    // Outlet area from the info line ("Outlet Area: 1.62 ft² …").
    let outletArea = 0;
    for (let r = 1; r <= Math.min(4, ws.rowCount); r++) {
      const txt = String(cellVal(ws.getRow(r).getCell(1)) ?? "");
      const m = txt.match(/Outlet\s*Area:?\s*([\d.]+)/i);
      if (m) { outletArea = Number(m[1]); break; }
    }

    // Header row: the sub-header whose 3rd column reads "CFM"; SP labels sit above.
    let hdrRow = 0;
    for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
      if (String(cellVal(ws.getRow(r).getCell(3)) ?? "").trim().toUpperCase() === "CFM") {
        hdrRow = r;
        break;
      }
    }
    if (!hdrRow) throw new Error(`${modelCode}: no CFM header row found`);
    const spRow = hdrRow - 1;
    const RPM_COL = 2;

    // Each SP spans 3 cols (CFM, BHP, Sone); pair CFM with the BHP to its right.
    const spCols: Array<{ sp_in: number; cfmCol: number; bhpCol: number }> = [];
    for (let c = 3; c <= ws.columnCount; c++) {
      if (String(cellVal(ws.getRow(hdrRow).getCell(c)) ?? "").trim().toUpperCase() !== "CFM") {
        continue;
      }
      const sp_in = parseSp(String(cellVal(ws.getRow(spRow).getCell(c)) ?? "").trim());
      if (sp_in == null) continue;
      spCols.push({ sp_in, cfmCol: c, bhpCol: c + 1 });
    }
    if (spCols.length < 2) throw new Error(`${modelCode}: found ${spCols.length} SP columns`);

    const points: Model["points"] = [];
    let maxRpm = 0;
    for (let r = hdrRow + 1; r <= ws.rowCount; r++) {
      const rpm = toNum(cellVal(ws.getRow(r).getCell(RPM_COL)));
      if (rpm == null || rpm <= 0) continue;
      for (const sc of spCols) {
        const cfm = toNum(cellVal(ws.getRow(r).getCell(sc.cfmCol)));
        const bhp = toNum(cellVal(ws.getRow(r).getCell(sc.bhpCol)));
        if (cfm != null && cfm > 0 && bhp != null) {
          points.push({ rpm, cfm, sp_in: sc.sp_in, bhp });
          if (rpm > maxRpm) maxRpm = rpm;
        }
      }
    }
    if (!points.length) throw new Error(`${modelCode}: no rating points parsed`);
    if (!outletArea) throw new Error(`${modelCode}: no outlet area found`);

    const { cebDia, price } = nearestCebPrice(dia);
    models.push({
      modelCode,
      dia,
      sizeLabel: sizeLabelOf(dia),
      outletArea_ft2: outletArea,
      maxRpm,
      basePrice: price,
      cebDia,
      points,
    });
  }
  if (!models.length) throw new Error("No <size>SIEB tabs found");

  models.sort((a, b) => a.dia - b.dia);

  const catHeader =
    "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows = models.map((m) => {
    const description =
      "Square Inline Blower\n" +
      "Tubular Inline Type / Belt Driven\n" +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel Aqua Green / Model: ${m.modelCode}`;
    const specs = {
      bladeDia_in: m.dia,
      outletArea_ft2: m.outletArea_ft2,
      maxRpm: m.maxRpm,
      bladeType: "Backwardly Inclined",
      drive: "belt",
      category: "Tubular Inline Type",
      type: "Square Inline Blower",
      tag: "SIEB",
    };
    const name = `Square Inline Blower ${m.sizeLabel}\" Backwardly Inclined (SIEB)`;
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
  writeOut("sieb-catalogue.csv", [catHeader, ...catRows].join("\n") + "\n");

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
  writeOut("sieb-ratings.csv", [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Models:");
  for (const m of models) {
    console.log(
      `  ${m.modelCode}  Ø${m.sizeLabel}"  area ${m.outletArea_ft2} ft²  maxRPM ${m.maxRpm}  ` +
        `base ₱${m.basePrice} (CEB Ø${m.cebDia}")  ${m.points.length} pts`,
    );
  }
  console.log(`\nTotal rating points: ${total}`);
  console.log(`Wrote scripts/out/sieb-catalogue.csv and scripts/out/sieb-ratings.csv`);
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
