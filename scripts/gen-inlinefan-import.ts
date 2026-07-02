/**
 * Östberg CK Inline Duct Fans → the admin Import CSVs:
 *   scripts/out/inlinefan-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/inlinefan-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Source: the Östberg "Inline Duct Fan" New Product Memo. It gives the headline
 * specs (Max Air Flow CMH, Max Static Pressure Pa, Power W, RPM, Noise) and a
 * Static-Pressure-vs-Flow performance curve per model. The curves are only
 * printed as charts, so the (flow, SP) points below are DIGITISED from those
 * charts — approximate, good for duty-based selection, refine if numeric curve
 * data is available.
 *
 * These are FIXED-SPEED, single-phase (220–240 V) units run at one rated speed,
 * so selection checks whether the duty point sits under the fan curve (no speed
 * scaling). Air Flow is in CMH (= m³/hr) and the curve SP is already in Pa, so
 * no unit conversion is needed. Power (W) → power_kw = W / 1000. Each unit is a
 * whole item priced from the supplied VAT-exclusive selling-price list.
 *
 * Run: npx tsx scripts/gen-inlinefan-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "scripts", "out");
const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;

type Pt = [cmh: number, pa: number]; // (air flow m³/hr, static pressure Pa)

interface Fan {
  code: string; // model code, e.g. CK200
  series: string; // full series name, e.g. CK 200 B
  catalogNo: string;
  airFlow_cmh: number; // Max Air Flow (free air)
  maxSp_pa: number; // Max Static Pressure (shutoff)
  power_w: number;
  rpm: number;
  noise_db: number;
  net: number; // VAT-exclusive selling price (PHP)
  /** Performance curve, digitised from the memo chart, by descending SP. */
  curve: Pt[];
}

const FANS: Fan[] = [
  {
    code: "CK200", series: "CK 200 B", catalogNo: "1007000089",
    airFlow_cmh: 1159, maxSp_pa: 631, power_w: 220, rpm: 2730, noise_db: 47, net: 11622,
    curve: [
      [0, 631], [180, 615], [360, 585], [540, 535], [720, 460], [900, 355], [1080, 190], [1159, 0],
    ],
  },
  {
    code: "CK250", series: "CK 250 C", catalogNo: "1007000065",
    airFlow_cmh: 1120, maxSp_pa: 554, power_w: 165, rpm: 2530, noise_db: 50, net: 10482,
    curve: [
      [0, 554], [180, 520], [360, 470], [540, 410], [720, 330], [900, 230], [1080, 70], [1120, 0],
    ],
  },
  {
    code: "CK315", series: "CK 315 C", catalogNo: "1007000119",
    airFlow_cmh: 1584, maxSp_pa: 791, power_w: 305, rpm: 2655, noise_db: 50, net: 13052,
    curve: [
      [0, 791], [180, 760], [360, 720], [540, 665], [720, 590], [900, 500],
      [1080, 395], [1260, 270], [1440, 120], [1584, 0],
    ],
  },
];

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const catHeader = "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const ratHeader = "modelCode,rpm,airflow_m3hr,staticPressure_pa,power_kw,efficiency";
  const catRows: string[] = [];
  const ratRows: string[] = [];

  for (const f of FANS) {
    const power_kw = Math.round((f.power_w / 1000) * 100000) / 100000;
    const description =
      "Inline Duct Fan\n" +
      "Ostberg Brand\n" +
      `Air Flow ${f.airFlow_cmh} m³/hr · ${f.power_w} W · ${f.rpm} rpm · ${f.noise_db} dB(A)\n` +
      `Model: ${f.code}`;
    const specs: Record<string, unknown> = {
      category: "Other Products",
      brand: "Ostberg",
      type: "Inline Duct Fan",
      tag: "CK",
      fixedSpeed: true,
      rpm: f.rpm,
      power_w: f.power_w,
      noise_db: f.noise_db,
      airVolume_cmh: f.airFlow_cmh,
      maxStaticPressure_pa: f.maxSp_pa,
      catalogNo: f.catalogNo,
    };
    catRows.push(
      [
        f.code,
        "TUBULAR_INLINE",
        csv(`Östberg ${f.series} Inline Duct Fan`),
        csv(description),
        f.code.replace(/^CK/, ""),
        "unit",
        String(f.net),
        "PHP",
        csv(JSON.stringify(specs)),
      ].join(","),
    );
    for (const [cmh, pa] of f.curve) {
      ratRows.push([f.code, String(f.rpm), cmh.toFixed(2), pa.toFixed(2), power_kw.toFixed(5), ""].join(","));
    }
  }

  writeFileSync(join(OUT_DIR, "inlinefan-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");
  writeFileSync(join(OUT_DIR, "inlinefan-ratings.csv"), [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("Östberg CK inline duct fans:");
  for (const f of FANS) {
    console.log(`  ${f.code}  ${f.airFlow_cmh} m³/hr  ${f.power_w}W  ${f.rpm}rpm  SPmax ${f.maxSp_pa}Pa  ₱${f.net}`);
  }
  console.log(`\n${catRows.length} catalogue items, ${ratRows.length} rating points (curves digitised — approximate).`);
  console.log("Wrote scripts/out/inlinefan-catalogue.csv and scripts/out/inlinefan-ratings.csv");
}

main();
