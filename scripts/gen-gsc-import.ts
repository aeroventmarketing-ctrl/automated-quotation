/**
 * Aerovent High Pressure Wall Fan (GSC series) → the admin Import CSVs:
 *   scripts/out/gsc-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/gsc-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * These are the "High Pressure Series" under Other Products → KDK → Wall Mounted
 * Fan. Source: the per-model PDF spec sheets (25GSC.pdf … 60GSC.pdf). Headline
 * specs (Blade size, Air Volume CMH, Consumption W, Noise, RPM, Weight) read from
 * each sheet; the Static-Pressure-vs-Air-Volume curve points are DIGITISED from
 * the chart (approximate, 220/230 V 60 Hz).
 *
 * Same fixed-speed selection model as the KDK Ceiling Cassette / Cabinet Fan: the
 * unit runs at one rated speed, so selection checks whether the duty sits under
 * the fan curve (no speed scaling). Air Volume is m³/hr, curve SP is Pa,
 * consumption W → power_kw = W/1000.
 *
 * NOTE: no selling-price list was supplied yet, so basePrice is 0 for every model
 * (priced later, like 10CGB15 was). Prices, once given, are VAT-inclusive.
 *
 * Run: npx tsx scripts/gen-gsc-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "scripts", "out");

type Pt = [cmh: number, pa: number]; // (air volume m³/hr, static pressure Pa)

interface Gsc {
  code: string;
  blade_mm: number;
  airVolume_cmh: number; // free-air Air Volume [CMH] from the sheet
  power_w: number; // Consumption [W]
  noise_db: number;
  rpm: number;
  weight_kg: number;
  volts: number; // chart voltage (220 / 230 V, 60 Hz)
  price: number; // VAT-inclusive selling price (PHP); 0 = not yet priced
  curve: Pt[]; // curve digitised from the chart (descending SP, ends at CMH @ 0)
}

// Curves digitised from the PDF charts (approximate); no prices supplied yet.
const GSCS: Gsc[] = [
  {
    code: "25GSC", blade_mm: 250, airVolume_cmh: 1250, power_w: 47, noise_db: 39, rpm: 1560, weight_kg: 4.4, volts: 220, price: 0,
    curve: [[0, 80], [200, 75], [400, 68], [600, 60], [800, 52], [1000, 42], [1150, 22], [1250, 0]],
  },
  {
    code: "30GSC", blade_mm: 300, airVolume_cmh: 2080, power_w: 80, noise_db: 42, rpm: 1560, weight_kg: 6.1, volts: 220, price: 0,
    curve: [[0, 107], [250, 98], [500, 85], [750, 73], [1000, 63], [1300, 52], [1600, 40], [1900, 18], [2080, 0]],
  },
  {
    code: "35GSC", blade_mm: 350, airVolume_cmh: 2940, power_w: 127, noise_db: 48, rpm: 1660, weight_kg: 10.5, volts: 230, price: 0,
    curve: [[0, 120], [500, 108], [1000, 98], [1500, 85], [2000, 72], [2400, 55], [2700, 35], [2900, 10], [2940, 0]],
  },
  {
    code: "40GSC", blade_mm: 400, airVolume_cmh: 4240, power_w: 210, noise_db: 51, rpm: 1710, weight_kg: 19, volts: 230, price: 0,
    curve: [[0, 290], [500, 230], [1000, 180], [1500, 155], [2000, 145], [2500, 140], [3000, 122], [3500, 82], [4000, 30], [4240, 0]],
  },
  {
    code: "45GSC", blade_mm: 450, airVolume_cmh: 5970, power_w: 325, noise_db: 54, rpm: 1630, weight_kg: 19, volts: 220, price: 0,
    // Black curve (the higher-flow of the two on the sheet, ending at 5,970 m³/h).
    curve: [[0, 118], [2000, 117], [3500, 116], [4700, 114], [5000, 104], [5300, 90], [5500, 75], [5700, 52], [5850, 28], [5970, 0]],
  },
  {
    code: "50GSC", blade_mm: 500, airVolume_cmh: 7100, power_w: 326, noise_db: 51, rpm: 1130, weight_kg: 22.5, volts: 230, price: 0,
    curve: [[0, 112], [2500, 110], [4000, 105], [4800, 98], [5500, 80], [6200, 55], [6800, 25], [7100, 0]],
  },
  {
    code: "60GSC", blade_mm: 620, airVolume_cmh: 9410, power_w: 361, noise_db: 54, rpm: 1150, weight_kg: 34, volts: 230, price: 0,
    curve: [[0, 145], [3000, 142], [5000, 135], [6400, 120], [7500, 95], [8500, 60], [9200, 20], [9410, 0]],
  },
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

  for (const g of GSCS) {
    const power_kw = Math.round((g.power_w / 1000) * 100000) / 100000;
    const sizeLabel = String(g.blade_mm);
    const description =
      "Aerovent High Pressure Wall Fan\n" +
      "High pressure series / Single phase / Reversible\n" +
      `Blade ${g.blade_mm} mm · Air Volume ${g.airVolume_cmh} m³/hr · ${g.power_w} W · ${g.rpm} rpm · ${g.noise_db} dB(A)\n` +
      `Model: ${g.code}`;
    const specs: Record<string, unknown> = {
      category: "Other Products",
      brand: "KDK",
      type: "Wall Mounted Fan",
      series: "High Pressure Series",
      tag: "GSCHP",
      fixedSpeed: true,
      rpm: g.rpm,
      power_w: g.power_w,
      volts: g.volts,
      noise_db: g.noise_db,
      weight_kg: g.weight_kg,
      blade_mm: g.blade_mm,
      airVolume_cmh: g.airVolume_cmh,
    };
    catRows.push(
      [
        g.code,
        "AXIAL",
        csv(`Aerovent High Pressure Wall Fan ${g.blade_mm}mm (${g.code})`),
        csv(description),
        sizeLabel,
        "unit",
        String(g.price),
        "PHP",
        csv(JSON.stringify(specs)),
      ].join(","),
    );
    for (const [cmh, pa] of g.curve) {
      ratRows.push([g.code, String(g.rpm), cmh.toFixed(2), pa.toFixed(2), power_kw.toFixed(5), ""].join(","));
    }
  }

  writeFileSync(join(OUT_DIR, "gsc-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");
  writeFileSync(join(OUT_DIR, "gsc-ratings.csv"), [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Aerovent High Pressure Wall Fans (GSC):");
  for (const g of GSCS) {
    console.log(
      `  ${g.code}  blade ${g.blade_mm}mm  ${g.airVolume_cmh} m³/hr  ${g.power_w}W  ${g.rpm}rpm  SPmax ${g.curve[0][1]}Pa  ${g.price ? "₱" + g.price : "(no price)"}`,
    );
  }
  console.log(`\n${catRows.length} catalogue items, ${ratRows.length} rating points.`);
  console.log("Wrote scripts/out/gsc-catalogue.csv and scripts/out/gsc-ratings.csv");
}

main();
