/**
 * Shutter Series Wall Mounted Fans → the admin Import CSVs:
 *   scripts/out/shutter-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/shutter-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * These are the "Shutter Series" under Other Products → KDK → Wall Mounted Fan.
 * Source: the per-model PDF spec sheets (15AAQ1.pdf … 40KQT.pdf). Headline specs
 * (Blade size, Air Volume CMH, Consumption W, Noise, RPM, Weight) read from each
 * sheet.
 *
 * SELECTION IS BY VOLUME FLOW ONLY — no static pressure is required. Same
 * fixed-speed engine as the other KDK units, but each unit only carries a light
 * 2-point curve from its shut-off down to its free-air Air Volume, so a model is
 * picked purely on whether it can move the requested flow (duty SP defaults to 0).
 * Air Volume is m³/hr, consumption W → power_kw = W/1000.
 *
 * The reversible-louver models (RLF / RLE) are rated on the EXHAUST air volume.
 *
 * NOTE: no selling-price list was supplied yet, so basePrice is 0 for every model
 * (priced later). Prices, once given, are VAT-inclusive.
 *
 * Run: npx tsx scripts/gen-shutter-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "scripts", "out");

interface Shutter {
  code: string;
  blade_mm: number;
  airVolume_cmh: number; // free-air Air Volume [CMH] (exhaust for RLF/RLE)
  power_w: number; // Consumption [W]
  noise_db: number;
  rpm: number;
  weight_kg: number;
  volts: number | null; // chart voltage where published (else null)
  shutoff_pa: number; // shut-off SP — charted where shown, else nominal
  price: number; // VAT-inclusive selling price (PHP); 0 = not yet priced
}

const SHUTTERS: Shutter[] = [
  { code: "15AAQ1", blade_mm: 150, airVolume_cmh: 306, power_w: 19, noise_db: 34, rpm: 1560, weight_kg: 1.4, volts: 220, shutoff_pa: 32, price: 0 },
  { code: "20ALH", blade_mm: 200, airVolume_cmh: 600, power_w: 29, noise_db: 44, rpm: 1340, weight_kg: 2.2, volts: null, shutoff_pa: 25, price: 0 },
  { code: "20AUH", blade_mm: 200, airVolume_cmh: 650, power_w: 29, noise_db: 42, rpm: 1400, weight_kg: 2.0, volts: null, shutoff_pa: 25, price: 0 },
  { code: "25ALH", blade_mm: 250, airVolume_cmh: 846, power_w: 33, noise_db: 43, rpm: 1050, weight_kg: 2.7, volts: null, shutoff_pa: 25, price: 0 },
  { code: "25AUH", blade_mm: 250, airVolume_cmh: 940, power_w: 33, noise_db: 39, rpm: 1125, weight_kg: 2.4, volts: null, shutoff_pa: 25, price: 0 },
  { code: "25RLF", blade_mm: 250, airVolume_cmh: 835, power_w: 34, noise_db: 45, rpm: 1060, weight_kg: 2.7, volts: null, shutoff_pa: 25, price: 0 },
  { code: "30ALF", blade_mm: 300, airVolume_cmh: 915, power_w: 33, noise_db: 43, rpm: 835, weight_kg: 3.1, volts: null, shutoff_pa: 25, price: 0 },
  { code: "30AUH", blade_mm: 300, airVolume_cmh: 1140, power_w: 33, noise_db: 38, rpm: 950, weight_kg: 2.7, volts: null, shutoff_pa: 25, price: 0 },
  { code: "30KQT", blade_mm: 307, airVolume_cmh: 1270, power_w: 51, noise_db: 46.5, rpm: 1255, weight_kg: 4.9, volts: 220, shutoff_pa: 60, price: 0 },
  { code: "30RLE", blade_mm: 300, airVolume_cmh: 730, power_w: 33, noise_db: 43, rpm: 835, weight_kg: 3.1, volts: null, shutoff_pa: 25, price: 0 },
  { code: "40KQT", blade_mm: 410, airVolume_cmh: 2190, power_w: 76, noise_db: 51, rpm: 1260, weight_kg: 6.4, volts: 230, shutoff_pa: 60, price: 0 },
];

function csv(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const catHeader =
    "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const ratHeader = "modelCode,rpm,airflow_m3hr,staticPressure_pa,power_kw,efficiency";
  const catRows: string[] = [];
  const ratRows: string[] = [];

  for (const s of SHUTTERS) {
    const power_kw = Math.round((s.power_w / 1000) * 100000) / 100000;
    const sizeLabel = String(s.blade_mm);
    const description =
      "Shutter Series Wall Mounted Fan\n" +
      "Automatic shutter / Wall mounting / Single speed\n" +
      `Blade ${s.blade_mm} mm · Air Volume ${s.airVolume_cmh} m³/hr · ${s.power_w} W · ${s.rpm} rpm · ${s.noise_db} dB(A)\n` +
      `Model: ${s.code}`;
    const specs: Record<string, unknown> = {
      category: "Other Products",
      brand: "KDK",
      type: "Wall Mounted Fan",
      series: "Shutter Series",
      tag: "WMFSHUTTER",
      fixedSpeed: true,
      flowOnly: true,
      rpm: s.rpm,
      power_w: s.power_w,
      ...(s.volts ? { volts: s.volts } : {}),
      noise_db: s.noise_db,
      weight_kg: s.weight_kg,
      blade_mm: s.blade_mm,
      airVolume_cmh: s.airVolume_cmh,
    };
    catRows.push(
      [
        s.code,
        "PROPELLER",
        csv(`Shutter Series Wall Fan ${s.blade_mm}mm (${s.code})`),
        csv(description),
        sizeLabel,
        "unit",
        String(s.price),
        "PHP",
        csv(JSON.stringify(specs)),
      ].join(","),
    );
    // Flow-only selection: a light 2-point curve (shut-off → free-air at SP 0) so
    // a model is chosen purely on whether it can move the requested air volume.
    const curve: [number, number][] = [[0, s.shutoff_pa], [s.airVolume_cmh, 0]];
    for (const [cmh, pa] of curve) {
      ratRows.push([s.code, String(s.rpm), cmh.toFixed(2), pa.toFixed(2), power_kw.toFixed(5), ""].join(","));
    }
  }

  writeFileSync(join(OUT_DIR, "shutter-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");
  writeFileSync(join(OUT_DIR, "shutter-ratings.csv"), [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Shutter Series Wall Mounted Fans (flow-only):");
  for (const s of SHUTTERS) {
    console.log(
      `  ${s.code}  blade ${s.blade_mm}mm  ${s.airVolume_cmh} m³/hr  ${s.power_w}W  ${s.rpm}rpm  ${s.price ? "₱" + s.price : "(no price)"}`,
    );
  }
  console.log(`\n${catRows.length} catalogue items, ${ratRows.length} rating points.`);
  console.log("Wrote scripts/out/shutter-catalogue.csv and scripts/out/shutter-ratings.csv");
}

main();
