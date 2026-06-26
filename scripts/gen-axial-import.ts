/**
 * Parse the TAF (Tubeaxial) and VAF (Vaneaxial) axial-fan performance catalogs
 * into the two CSVs the admin Import screen accepts:
 *   scripts/out/axial-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/axial-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Layout — one worksheet per size (1200TAF…5400TAF, 1200VAF…5400VAF). Each sheet:
 *   r1  "<size>TAF • Wheel Dia. X in • Outlet Area Y ft² • Tip Speed = …"  (title)
 *   r2  "Performance shown is at standard air density … Max. RPM — Class I: 4455 …"
 *   r3  CFM | Outlet Vel. | <SP label>×3 | <SP label>×3 | …   (each SP spans 3 cols)
 *   r4  CFM | Outlet Vel. | RPM | BHP | ANG | RPM | BHP | ANG | …
 *   r5+ <CFM, Outlet Vel., then RPM/BHP/ANG per SP level>
 *
 * The TAF and VAF grids carry different SP columns (TAF 0.25"–2.75" in 0.25"
 * steps; VAF 0.25"–1.50" then 2.0/2.5/3.0/3.5/4.0"), so SP labels are read from
 * row 3 per sheet rather than assumed. We emit one FanRatingPoint per filled
 * (CFM, SP) cell, converted to SI:
 *   airflow_m3hr = CFM × 1.69901082
 *   staticPressure_pa = inWG × 249.0889
 *   power_kw = BHP × 0.745699872
 *
 * Each size yields a belt and a direct model that SHARE the same rating grid
 * (like EWF/EWFDD): TAF/TAFDD from the TAF catalog, VAF/VAFDD from the VAF
 * catalog. Direct drive runs at a single ~1750 rpm (4-pole) band 1663–1838 rpm
 * (specs.directBands); belt selects anywhere on the grid up to Class I 4455 rpm.
 *
 * Prices: TAF by wheel size from "TAF Prices.xlsx"; VAF = TAF ÷ 0.75 (≈ ×1.333),
 * per the supplied rule. Belt and direct of the same size share one price.
 *
 * Axial fans have no centrifugal-style outlet-velocity limit wired (no
 * outletArea_ft2 spec), so selection is by the CFM×SP grid alone.
 *
 * Run: npx tsx scripts/gen-axial-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const CFM_TO_M3HR = 1.69901082;
const INWG_TO_PA = 249.0889;
const KW_PER_HP = 0.745699872;

const OUT_DIR = join(process.cwd(), "scripts", "out");

// Class I maximum rated speed (rpm) printed on every sheet ("Max. RPM — Class I: 4455").
const MAX_RPM_CLASS_I = 4455;
// Direct-drive band: a single 4-pole motor at ~1750 rpm (1663–1838 rpm allowed).
const DIRECT_BANDS = [{ pole: 4, minRpm: 1663, maxRpm: 1838 }] as const;
// VAF price = TAF price ÷ 0.75 (≈ ×1.333).
const VAF_PRICE_DIVISOR = 0.75;

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

/** SP label -> inches w.g. Handles `0.25" SP`, `1.00" SP`, `2.75" SP`. */
function parseSp(raw: string): number | null {
  const s = raw.replace(/\s*SP\s*$/i, "").replace(/["”in.\s]+$/i, "").trim();
  const f = Number(s);
  return Number.isNaN(f) ? null : f;
}

/** Size code from a sheet name: "1200TAF" -> 1200, "5400VAF" -> 5400. */
function codeOf(sheetName: string): number | null {
  const m = sheetName.match(/^(\d{3,4})/);
  return m ? Number(m[1]) : null;
}

interface Point {
  rpm: number;
  cfm: number;
  sp_in: number;
  bhp: number;
}
interface SizeData {
  code: number;
  dia: number;
  sizeLabel: string;
  points: Point[];
}

/** Parse one TAF/VAF worksheet (one size) into its rating points. */
function parseSheet(ws: ExcelJS.Worksheet): SizeData | null {
  const code = codeOf(ws.name);
  if (code == null) return null;

  // Sub-header row: the one whose 3rd cell reads "RPM"; SP labels sit one above.
  let rpmRow = 0;
  for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
    if (String(cellVal(ws.getRow(r).getCell(3)) ?? "").trim().toUpperCase() === "RPM") {
      rpmRow = r;
      break;
    }
  }
  if (!rpmRow) return null;
  const spRow = rpmRow - 1;

  // Map SP columns: each SP level is a RPM/BHP/ANG triplet starting at an "RPM" col.
  const spCols: Array<{ sp_in: number; rpmCol: number; bhpCol: number }> = [];
  for (let c = 3; c <= ws.columnCount; c++) {
    if (String(cellVal(ws.getRow(rpmRow).getCell(c)) ?? "").trim().toUpperCase() !== "RPM") {
      continue;
    }
    const sp_in = parseSp(String(cellVal(ws.getRow(spRow).getCell(c)) ?? "").trim());
    if (sp_in == null) continue;
    spCols.push({ sp_in, rpmCol: c, bhpCol: c + 1 });
  }
  if (spCols.length < 2) return null;

  const points: Point[] = [];
  for (let r = rpmRow + 1; r <= ws.rowCount; r++) {
    const cfm = toNum(cellVal(ws.getRow(r).getCell(1)));
    if (cfm == null) continue; // notes / blank rows
    for (const sc of spCols) {
      const rpm = toNum(cellVal(ws.getRow(r).getCell(sc.rpmCol)));
      const bhp = toNum(cellVal(ws.getRow(r).getCell(sc.bhpCol)));
      if (rpm != null && bhp != null && rpm > 0) {
        points.push({ rpm, cfm, sp_in: sc.sp_in, bhp });
      }
    }
  }
  if (!points.length) return null;

  const dia = code / 100;
  return {
    code,
    dia,
    sizeLabel: Number.isInteger(dia) ? String(dia) : String(Math.round(dia * 100) / 100),
    points,
  };
}

/** Read TAF prices (Size, Price) from TAF Prices.xlsx, keyed by wheel size (in). */
async function readTafPrices(): Promise<Record<number, number>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(process.cwd(), "TAF Prices.xlsx"));
  const ws = wb.worksheets[0];
  const prices: Record<number, number> = {};
  for (let r = 1; r <= ws.rowCount; r++) {
    const size = toNum(cellVal(ws.getRow(r).getCell(3)));
    const price = toNum(cellVal(ws.getRow(r).getCell(4)));
    if (size != null && price != null && size > 0 && price > 0) prices[size] = price;
  }
  return prices;
}

function csv(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

interface ModelDef {
  modelCode: string;
  type: "Tubeaxial" | "Vaneaxial";
  tag: "TAF" | "TAFDD" | "VAF" | "VAFDD";
  direct: boolean;
  size: SizeData;
  basePrice: number;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const tafWb = new ExcelJS.Workbook();
  await tafWb.xlsx.readFile(join(process.cwd(), "TAF Catalog.xlsx"));
  const tafSizes = tafWb.worksheets.map(parseSheet).filter((s): s is SizeData => s != null);

  const vafWb = new ExcelJS.Workbook();
  await vafWb.xlsx.readFile(join(process.cwd(), "VAF Catalog.xlsx"));
  const vafSizes = vafWb.worksheets.map(parseSheet).filter((s): s is SizeData => s != null);

  const tafPrices = await readTafPrices();

  const models: ModelDef[] = [];
  // TAF (belt) + TAFDD (direct) — Tubeaxial, priced from TAF Prices.xlsx.
  for (const size of tafSizes) {
    const price = tafPrices[Math.round(size.dia)];
    if (price == null) {
      console.warn(`  ! no TAF price for ${size.code} (Ø${size.dia}") — skipped`);
      continue;
    }
    models.push({ modelCode: `AV${size.code}TAF`, type: "Tubeaxial", tag: "TAF", direct: false, size, basePrice: price });
    models.push({ modelCode: `AV${size.code}TAFDD`, type: "Tubeaxial", tag: "TAFDD", direct: true, size, basePrice: price });
  }
  // VAF (belt) + VAFDD (direct) — Vaneaxial, price = TAF ÷ 0.75.
  for (const size of vafSizes) {
    const taf = tafPrices[Math.round(size.dia)];
    if (taf == null) {
      console.warn(`  ! no TAF base price for VAF ${size.code} (Ø${size.dia}") — skipped`);
      continue;
    }
    const price = Math.round(taf / VAF_PRICE_DIVISOR);
    models.push({ modelCode: `AV${size.code}VAF`, type: "Vaneaxial", tag: "VAF", direct: false, size, basePrice: price });
    models.push({ modelCode: `AV${size.code}VAFDD`, type: "Vaneaxial", tag: "VAFDD", direct: true, size, basePrice: price });
  }
  if (!models.length) throw new Error("No TAF/VAF models parsed");

  // --- catalogue CSV --------------------------------------------------------
  const catHeader =
    "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows = models.map((m) => {
    const driveWord = m.direct ? "Direct Drive" : "Belt Drive";
    const description =
      `${m.type}\n` +
      `Axial Type / ${driveWord}\n` +
      "Made of Black Iron Sheet\n" +
      `Painted with Epoxy Enamel Aqua Green / Model: ${m.modelCode}`;
    const specs: Record<string, unknown> = {
      bladeDia_in: m.size.dia,
      maxRpm: MAX_RPM_CLASS_I,
      bladeType: "Axial",
      drive: m.direct ? "direct" : "belt",
      category: "Axial Type",
      type: m.type,
      tag: m.tag,
    };
    if (m.direct) specs.directBands = DIRECT_BANDS;
    const name = `${m.type} ${m.size.sizeLabel}" Axial Fan (${m.tag})`;
    return [
      m.modelCode,
      "AXIAL",
      csv(name),
      csv(description),
      m.size.sizeLabel,
      "unit",
      String(m.basePrice),
      "PHP",
      csv(JSON.stringify(specs)),
    ].join(",");
  });
  writeFileSync(join(OUT_DIR, "axial-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");

  // --- ratings CSV ----------------------------------------------------------
  const ratHeader = "modelCode,rpm,airflow_m3hr,staticPressure_pa,power_kw,efficiency";
  const ratRows: string[] = [];
  for (const m of models) {
    for (const p of m.size.points) {
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
    }
  }
  writeFileSync(join(OUT_DIR, "axial-ratings.csv"), [ratHeader, ...ratRows].join("\n") + "\n");

  // --- summary --------------------------------------------------------------
  console.log("Axial models:");
  for (const m of models) {
    const rpms = m.size.points.map((p) => p.rpm);
    console.log(
      `  ${m.modelCode}  Ø${m.size.sizeLabel}"  ${m.direct ? "direct" : "belt  "}  ` +
        `base ₱${m.basePrice}  ${m.size.points.length} pts  rpm ${Math.min(...rpms)}–${Math.max(...rpms)}`,
    );
  }
  console.log(`\n${catRows.length} catalogue items, ${ratRows.length} rating points.`);
  console.log("Wrote scripts/out/axial-catalogue.csv and scripts/out/axial-ratings.csv");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
