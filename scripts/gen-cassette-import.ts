/**
 * Ceiling-cassette ventilating fans (KDK-style sirocco units) → the admin Import
 * CSVs:
 *   scripts/out/cassette-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/cassette-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Source: the per-model PDF spec sheets (17CUF-17CUG.pdf … 38CHG.pdf). The PDFs
 * give the headline specs (Air Volume CMH, Consumption W, RPM, Noise, Weight)
 * and a Static-Pressure-vs-Air-Volume curve. The curves are only printed as
 * charts (no tabular data), so the (flow, SP) points below are DIGITISED from
 * those charts — approximate, good for duty-based selection, refine if needed.
 *
 * These are FIXED-SPEED units: they run at one rated speed (2-speed models use
 * the Hi curve here), so selection checks whether the duty point sits under the
 * fan curve — it never speed-scales. Air Volume is in CMH, which is m³/hr
 * directly, and the curve SP is already in Pa, so no unit conversion is needed.
 * Consumption (W) → power_kw = W / 1000.
 *
 * Per the supplied rules, the F/G code pairs are the same fan under two codes
 * (17CUF≡17CUG, 24CUF≡24CUG, 24CDF≡24CDG): both codes are created sharing one
 * curve and one price (from the supplied KDK selling-price list).
 *
 * Run: npx tsx scripts/gen-cassette-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "scripts", "out");

type Pt = [cmh: number, pa: number]; // (air volume m³/hr, static pressure Pa)

interface Cassette {
  /** Model codes that share this data (F/G pairs create two codes). */
  codes: string[];
  speeds: 1 | 2;
  airVolume_cmh: number; // free-air Air Volume (Hi)
  power_w: number; // Consumption (Hi)
  rpm: number; // RPM (Hi)
  noise_db: number;
  weight_kg: number;
  /** Hi-speed curve, digitised from the PDF chart, by descending SP. */
  curve: Pt[];
}

// Selling price (PHP) by model code, from the supplied KDK price list. F/G code
// pairs share the price of their listed (G) model: 17CUF≡17CUG, etc.
const PRICES: Record<string, number> = {
  "17CUG": 5807,
  "24CUG": 6802,
  "24CDG": 7300,
  "24CHG": 7687,
  "27CHH": 11005,
  "32CDH": 14268,
  "32CHH": 14378,
  "38CDG": 21346,
  "38CHG": 22397,
};

// All curves below are digitised from the PDF charts (approximate).
const CASSETTES: Cassette[] = [
  {
    codes: ["17CUF", "17CUG"], speeds: 1, airVolume_cmh: 85, power_w: 10, rpm: 770, noise_db: 26, weight_kg: 1.9,
    curve: [[0, 120], [20, 110], [40, 92], [55, 70], [70, 42], [80, 20], [85, 0]],
  },
  {
    codes: ["24CUF", "24CUG"], speeds: 1, airVolume_cmh: 140, power_w: 15.5, rpm: 615, noise_db: 28, weight_kg: 2.8,
    curve: [[0, 125], [40, 108], [70, 88], [100, 60], [120, 35], [135, 12], [140, 0]],
  },
  {
    codes: ["24CDF", "24CDG"], speeds: 1, airVolume_cmh: 170, power_w: 16.5, rpm: 700, noise_db: 31.5, weight_kg: 2.8,
    curve: [[0, 135], [50, 118], [90, 92], [120, 68], [150, 32], [165, 10], [170, 0]],
  },
  {
    codes: ["24CHG"], speeds: 1, airVolume_cmh: 190, power_w: 22, rpm: 730, noise_db: 33.5, weight_kg: 2.8,
    curve: [[0, 135], [50, 120], [100, 95], [140, 60], [170, 28], [185, 8], [190, 0]],
  },
  {
    codes: ["27CHH"], speeds: 2, airVolume_cmh: 345, power_w: 36, rpm: 590, noise_db: 35.5, weight_kg: 4.4,
    curve: [[0, 170], [50, 158], [150, 118], [250, 72], [320, 28], [350, 0]],
  },
  {
    codes: ["32CDH"], speeds: 2, airVolume_cmh: 410, power_w: 48, rpm: 580, noise_db: 35.5, weight_kg: 5.2,
    curve: [[0, 210], [100, 168], [200, 120], [300, 70], [380, 20], [410, 0]],
  },
  {
    codes: ["32CHH"], speeds: 2, airVolume_cmh: 545, power_w: 68, rpm: 725, noise_db: 41.5, weight_kg: 5.6,
    curve: [[0, 270], [150, 205], [300, 140], [450, 68], [520, 22], [545, 0]],
  },
  {
    codes: ["38CDG"], speeds: 2, airVolume_cmh: 665, power_w: 107, rpm: 657, noise_db: 45, weight_kg: 9.7,
    curve: [[0, 355], [200, 278], [400, 190], [550, 95], [640, 20], [665, 0]],
  },
  {
    codes: ["38CHG"], speeds: 2, airVolume_cmh: 790, power_w: 138, rpm: 760, noise_db: 49, weight_kg: 10.4,
    curve: [[0, 400], [200, 360], [400, 275], [550, 185], [700, 70], [790, 0]],
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

  for (const c of CASSETTES) {
    const power_kw = Math.round((c.power_w / 1000) * 100000) / 100000;
    // F/G pairs share the price of whichever code is in the price list (the G).
    const price = c.codes.map((code) => PRICES[code]).find((p) => p != null) ?? 0;
    for (const code of c.codes) {
      const sizeLabel = code.slice(0, 2); // 17, 24, 27, 32, 38
      const speedWord = c.speeds === 2 ? "2-speed" : "single-speed";
      const description =
        "KDK Ceiling Cassette Ventilating Fan\n" +
        `Sirocco / ${speedWord} / Ceiling mounting\n` +
        `Air Volume ${c.airVolume_cmh} m³/hr · ${c.power_w} W · ${c.rpm} rpm · ${c.noise_db} dB(A)\n` +
        `Model: ${code}`;
      const specs: Record<string, unknown> = {
        category: "Other Products",
        brand: "KDK",
        type: "Ceiling Cassette",
        tag: "CASSETTE",
        fixedSpeed: true,
        rpm: c.rpm,
        power_w: c.power_w,
        speeds: c.speeds,
        noise_db: c.noise_db,
        weight_kg: c.weight_kg,
        airVolume_cmh: c.airVolume_cmh,
      };
      catRows.push(
        [
          code,
          "CENTRIFUGAL",
          csv(`KDK Ceiling Cassette ${sizeLabel}" (${code})`),
          csv(description),
          sizeLabel,
          "unit",
          String(price),
          "PHP",
          csv(JSON.stringify(specs)),
        ].join(","),
      );
      // Rating curve: one point per (flow, SP), at the fixed rpm. Power is the
      // unit's rated consumption (constant for a fixed-speed unit).
      for (const [cmh, pa] of c.curve) {
        ratRows.push([code, String(c.rpm), cmh.toFixed(2), pa.toFixed(2), power_kw.toFixed(5), ""].join(","));
      }
    }
  }

  writeFileSync(join(OUT_DIR, "cassette-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");
  writeFileSync(join(OUT_DIR, "cassette-ratings.csv"), [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Ceiling cassettes:");
  for (const c of CASSETTES) {
    console.log(
      `  ${c.codes.join("/")}  ${c.airVolume_cmh} m³/hr  ${c.power_w}W  ${c.rpm}rpm  ${c.speeds}-spd  SPmax ${c.curve[0][1]}Pa`,
    );
  }
  console.log(`\n${catRows.length} catalogue items, ${ratRows.length} rating points. Prices from the supplied list.`);
  console.log("Wrote scripts/out/cassette-catalogue.csv and scripts/out/cassette-ratings.csv");
}

main();
