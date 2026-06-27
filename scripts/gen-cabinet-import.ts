/**
 * KDK Cabinet Fan (ceiling-mounted cabinet ventilating fans) → the admin Import
 * CSVs:
 *   scripts/out/cabinet-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/cabinet-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Source: the per-model PDF spec sheets (12NSB.pdf … 25NFB.pdf). Headline specs
 * (Air Volume CMH, Consumption W, RPM, Noise, Weight) read from each sheet; the
 * Static-Pressure-vs-Air-Volume curve points are DIGITISED from the chart
 * (approximate). All models are 2-speed — the Hi curve is used for selection.
 *
 * Same fixed-speed model as the KDK Ceiling Cassette: the unit runs at one rated
 * speed, so selection checks whether the duty sits under the fan curve (no speed
 * scaling). Air Volume is m³/hr, curve SP is Pa, consumption W → power_kw = W/1000.
 * Prices are the supplied VAT-inclusive selling prices.
 *
 * Run: npx tsx scripts/gen-cabinet-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "scripts", "out");

type Pt = [cmh: number, pa: number]; // (air volume m³/hr, static pressure Pa)

interface Cabinet {
  code: string;
  airVolume_cmh: number; // free-air Air Volume (Hi)
  power_w: number; // Consumption (Hi)
  rpm: number; // RPM (Hi); estimated where the sheet omits it
  noise_db: number;
  weight_kg: number;
  price: number; // VAT-inclusive selling price (PHP)
  curve: Pt[]; // Hi-speed curve, digitised from the PDF chart (descending SP)
}

// Curves digitised from the PDF charts (Hi speed); prices from the supplied list.
const CABINETS: Cabinet[] = [
  {
    code: "12NSB", airVolume_cmh: 190, power_w: 23, rpm: 1370, noise_db: 22, weight_kg: 5.5, price: 11447,
    curve: [[0, 155], [40, 140], [80, 118], [120, 88], [150, 55], [175, 22], [190, 0]],
  },
  {
    code: "15NSB", airVolume_cmh: 370, power_w: 42, rpm: 1385, noise_db: 27, weight_kg: 6.5, price: 13991,
    curve: [[0, 190], [80, 170], [160, 140], [240, 98], [300, 55], [350, 18], [370, 0]],
  },
  {
    code: "18NSB", airVolume_cmh: 510, power_w: 79, rpm: 1370, noise_db: 32, weight_kg: 8.5, price: 19134,
    curve: [[0, 260], [100, 240], [200, 200], [300, 150], [400, 95], [470, 35], [510, 0]],
  },
  {
    code: "18NFB", airVolume_cmh: 760, power_w: 129, rpm: 1370, noise_db: 32, weight_kg: 10, price: 26323,
    curve: [[0, 210], [150, 200], [300, 178], [450, 135], [600, 75], [700, 28], [760, 0]],
  },
  {
    code: "20NSB", airVolume_cmh: 880, power_w: 169, rpm: 1370, noise_db: 33, weight_kg: 14, price: 30969,
    curve: [[0, 400], [150, 370], [300, 310], [450, 235], [600, 150], [780, 50], [880, 0]],
  },
  {
    code: "23NLB", airVolume_cmh: 1100, power_w: 310, rpm: 1210, noise_db: 40, weight_kg: 18, price: 35172,
    curve: [[0, 490], [200, 460], [400, 400], [600, 310], [800, 200], [1000, 75], [1100, 0]],
  },
  {
    code: "25NSB", airVolume_cmh: 1700, power_w: 467, rpm: 1245, noise_db: 42, weight_kg: 24, price: 43135,
    curve: [[0, 650], [300, 560], [600, 470], [900, 370], [1200, 240], [1500, 90], [1700, 0]],
  },
  {
    code: "25NFB", airVolume_cmh: 1810, power_w: 520, rpm: 1245, noise_db: 42, weight_kg: 24, price: 48112,
    curve: [[0, 680], [300, 600], [600, 500], [900, 390], [1200, 250], [1500, 110], [1810, 0]],
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

  for (const c of CABINETS) {
    const power_kw = Math.round((c.power_w / 1000) * 100000) / 100000;
    const sizeLabel = c.code.replace(/\D.*$/, ""); // 12, 15, 18, 20, 23, 25
    const description =
      "KDK Cabinet Fan\n" +
      "Sirocco / 2-speed / Ceiling mounting\n" +
      `Air Volume ${c.airVolume_cmh} m³/hr · ${c.power_w} W · ${c.rpm} rpm · ${c.noise_db} dB(A)\n` +
      `Model: ${c.code}`;
    const specs: Record<string, unknown> = {
      category: "Other Products",
      brand: "KDK",
      type: "Cabinet Fan",
      tag: "CABINETFAN",
      fixedSpeed: true,
      rpm: c.rpm,
      power_w: c.power_w,
      speeds: 2,
      noise_db: c.noise_db,
      weight_kg: c.weight_kg,
      airVolume_cmh: c.airVolume_cmh,
    };
    catRows.push(
      [
        c.code,
        "CENTRIFUGAL",
        csv(`KDK Cabinet Fan ${sizeLabel} (${c.code})`),
        csv(description),
        sizeLabel,
        "unit",
        String(c.price),
        "PHP",
        csv(JSON.stringify(specs)),
      ].join(","),
    );
    for (const [cmh, pa] of c.curve) {
      ratRows.push([c.code, String(c.rpm), cmh.toFixed(2), pa.toFixed(2), power_kw.toFixed(5), ""].join(","));
    }
  }

  writeFileSync(join(OUT_DIR, "cabinet-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");
  writeFileSync(join(OUT_DIR, "cabinet-ratings.csv"), [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("KDK Cabinet Fans:");
  for (const c of CABINETS) {
    console.log(
      `  ${c.code}  ${c.airVolume_cmh} m³/hr  ${c.power_w}W  ${c.rpm}rpm  SPmax ${c.curve[0][1]}Pa  ₱${c.price}`,
    );
  }
  console.log(`\n${catRows.length} catalogue items, ${ratRows.length} rating points.`);
  console.log("Wrote scripts/out/cabinet-catalogue.csv and scripts/out/cabinet-ratings.csv");
}

main();
