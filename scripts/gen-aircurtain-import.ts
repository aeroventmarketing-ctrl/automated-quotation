/**
 * KDK Air Curtain → the admin Import CSV:
 *   scripts/out/aircurtain-catalogue.csv  (import as "catalogue")
 *
 * Under Other Products → KDK → Air Curtain. Unlike the duty-selected KDK fans,
 * an air curtain is picked directly by two attributes: the EFFECTIVE (installation)
 * HEIGHT and the door width (= the unit LENGTH). Each (height, width) pair maps to
 * exactly one model, so no rating curve / duty selection is needed — the builder
 * looks the model up from these two dropdowns. Prices are VAT-inclusive.
 *
 * Source: the supplied KDK Air Curtain table (length, effective height, wattage,
 * air volume CMH/LPS/CFM, price).
 *
 * Run: npx tsx scripts/gen-aircurtain-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "scripts", "out");

interface AirCurtain {
  code: string;
  length_mm: number; // unit length = door width
  height_m: number; // effective / installation height
  power_w: number; // wattage
  cmh: number; // air volume m³/hr
  lps: number; // air volume L/s
  cfm: number; // air volume cfm
  price: number; // VAT-inclusive selling price (PHP)
}

const CURTAINS: AirCurtain[] = [
  { code: "10ESK", length_mm: 900, height_m: 3, power_w: 88, cmh: 860, lps: 239, cfm: 506, price: 37384 },
  { code: "10ELK", length_mm: 1200, height_m: 3, power_w: 116, cmh: 1150, lps: 319, cfm: 677, price: 39817 },
  { code: "12ESK", length_mm: 900, height_m: 3.5, power_w: 202, cmh: 990, lps: 275, cfm: 583, price: 41808 },
  { code: "12ELK", length_mm: 1200, height_m: 3.5, power_w: 258, cmh: 1340, lps: 372, cfm: 789, price: 45347 },
  { code: "14ESK", length_mm: 900, height_m: 4, power_w: 312, cmh: 1303, lps: 362, cfm: 767, price: 45237 },
  { code: "14ELK", length_mm: 1200, height_m: 4, power_w: 423, cmh: 1826, lps: 507, cfm: 1075, price: 47559 },
];

function csv(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const catHeader =
    "modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson";
  const catRows: string[] = [];

  for (const c of CURTAINS) {
    const description =
      "KDK Air Curtain\n" +
      `Effective height ${c.height_m} m · Door width ${c.length_mm} mm\n` +
      `Air Volume ${c.cmh} m³/hr (${c.lps} L/s · ${c.cfm} cfm) · ${c.power_w} W\n` +
      `Model: ${c.code}`;
    const specs: Record<string, unknown> = {
      category: "Other Products",
      brand: "KDK",
      type: "Air Curtain",
      tag: "AIRCURTAIN",
      length_mm: c.length_mm,
      effectiveHeight_m: c.height_m,
      power_w: c.power_w,
      airVolume_cmh: c.cmh,
      airVolume_lps: c.lps,
      airVolume_cfm: c.cfm,
    };
    catRows.push(
      [
        c.code,
        "CENTRIFUGAL",
        csv(`KDK Air Curtain ${c.length_mm}mm / ${c.height_m}m (${c.code})`),
        csv(description),
        String(c.length_mm),
        "unit",
        String(c.price),
        "PHP",
        csv(JSON.stringify(specs)),
      ].join(","),
    );
  }

  writeFileSync(join(OUT_DIR, "aircurtain-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");

  console.log("KDK Air Curtains:");
  for (const c of CURTAINS) {
    console.log(`  ${c.code}  ${c.length_mm}mm · ${c.height_m}m  ${c.cmh} m³/hr  ${c.power_w}W  ₱${c.price}`);
  }
  console.log(`\n${catRows.length} catalogue items.`);
  console.log("Wrote scripts/out/aircurtain-catalogue.csv (import as catalogue; no ratings needed).");
}

main();
