/**
 * KDK Mini Sirocco Fan (CGB series) → the admin Import CSVs:
 *   scripts/out/minisirocco-catalogue.csv  (import as "catalogue" FIRST)
 *   scripts/out/minisirocco-ratings.csv    (import as "ratings" AFTER the catalogue)
 *
 * Source: the supplied Performance charts + KDK selling-price list. Per the
 * instructions the performance is taken from the 220V / 60Hz Hi curve, digitised
 * from the chart (approximate). The chart label "10CGB" is the same fan as the
 * sold "10CGB15" — the catalogue uses the "…CGB15" code throughout.
 *
 * Same fixed-speed model as the other KDK units (Ceiling Cassette / Cabinet Fan):
 * the unit runs at one rated speed and selection checks the duty against the fan
 * curve (no speed scaling). Air Volume is m³/hr and the curve SP is Pa.
 *
 * NOTE: the charts don't list Consumption (W) or RPM, so power_w / rpm are left
 * blank here — they show "--" until provided. Prices are VAT-inclusive; 10CGB15
 * had no price on the list (₱0 until supplied).
 *
 * Run: npx tsx scripts/gen-minisirocco-import.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "scripts", "out");

type Pt = [cmh: number, pa: number]; // (air volume m³/hr, static pressure Pa)

interface Mini {
  code: string; // sold code, e.g. "10CGB15"
  price: number; // VAT-inclusive selling price (PHP); 0 = not yet priced
  curve: Pt[]; // 220V 60Hz Hi curve, digitised from the chart (descending SP)
}

const MINIS: Mini[] = [
  { code: "10CGB15", price: 0, curve: [[0, 95], [30, 88], [60, 76], [90, 58], [110, 38], [125, 15], [132, 0]] },
  { code: "12CGB15", price: 7963, curve: [[0, 140], [60, 118], [120, 90], [160, 65], [200, 32], [225, 8], [235, 0]] },
  { code: "14CGB15", price: 8793, curve: [[0, 135], [60, 125], [120, 108], [180, 80], [220, 48], [245, 15], [258, 0]] },
  { code: "16CGB15", price: 12941, curve: [[0, 215], [120, 180], [240, 140], [360, 95], [450, 50], [490, 15], [510, 0]] },
  { code: "17CGB15", price: 15484, curve: [[0, 240], [150, 200], [300, 155], [450, 110], [600, 58], [700, 20], [730, 0]] },
  { code: "19CGB15", price: 19687, curve: [[0, 300], [180, 258], [360, 215], [540, 160], [720, 95], [840, 30], [880, 0]] },
  { code: "21CGB15", price: 37494, curve: [[0, 390], [360, 335], [720, 265], [1080, 175], [1300, 90], [1440, 0]] },
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

  for (const m of MINIS) {
    const sizeLabel = m.code.replace(/CGB.*$/, ""); // 10, 12, 14, 16, 17, 19, 21
    const maxFlow = m.curve[m.curve.length - 1][0];
    const description =
      "KDK Mini Sirocco Fan\n" +
      "Sirocco / 2-speed / Ceiling mounting\n" +
      `Air Volume ${maxFlow} m³/hr (220V 60Hz Hi)\n` +
      `Model: ${m.code}`;
    const specs: Record<string, unknown> = {
      category: "Other Products",
      brand: "KDK",
      type: "Mini Sirocco",
      tag: "MINISIROCCO",
      fixedSpeed: true,
      speeds: 2,
      airVolume_cmh: maxFlow,
    };
    catRows.push(
      [
        m.code,
        "CENTRIFUGAL",
        csv(`KDK Mini Sirocco ${sizeLabel} (${m.code})`),
        csv(description),
        sizeLabel,
        "unit",
        String(m.price),
        "PHP",
        csv(JSON.stringify(specs)),
      ].join(","),
    );
    // rpm / power unknown (not on the charts) → 0; the UI omits them until set.
    for (const [cmh, pa] of m.curve) {
      ratRows.push([m.code, "0", cmh.toFixed(2), pa.toFixed(2), "0", ""].join(","));
    }
  }

  writeFileSync(join(OUT_DIR, "minisirocco-catalogue.csv"), [catHeader, ...catRows].join("\n") + "\n");
  writeFileSync(join(OUT_DIR, "minisirocco-ratings.csv"), [ratHeader, ...ratRows].join("\n") + "\n");

  console.log("KDK Mini Sirocco Fans (220V 60Hz Hi):");
  for (const m of MINIS) {
    console.log(
      `  ${m.code}  max ${m.curve[m.curve.length - 1][0]} m³/hr  SPmax ${m.curve[0][1]}Pa  ${m.price ? "₱" + m.price : "(no price)"}`,
    );
  }
  console.log(`\n${catRows.length} catalogue items, ${ratRows.length} rating points.`);
  console.log("Wrote scripts/out/minisirocco-catalogue.csv and scripts/out/minisirocco-ratings.csv");
}

main();
