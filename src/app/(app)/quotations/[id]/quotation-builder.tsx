"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuotationStatusBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/utils";
import { config } from "@/lib/config";
import {
  lookupMotor,
  motorModelCode,
  computeUnitPrice,
  combinedModel,
  hpOptions,
  dynamicBalancingApplies,
  type Voltage,
} from "@/lib/pricing/motors";
import { Download, Send, Check, CornerUpLeft, Trash2, Gauge, Plus } from "lucide-react";
import { PRODUCT_CATEGORIES, typesFor, entryFor, brandsFor, seriesFor, groupsFor, groupForType } from "@/lib/product-taxonomy";
import { ConfidenceBadge } from "@/components/status-badge";
import type { SelectionResult } from "@/lib/selection";
import {
  normalizeAirflowUnit,
  normalizePressureUnit,
  convertAirflow,
  convertPressure,
  normalizePowerUnit,
  convertPower,
  roundPower,
} from "@/lib/units";
import { updateQuotationLines, transitionQuotation } from "../actions";
import { updateQuoteNumber } from "../../admin/actions";

interface CatalogEntry {
  modelCode: string;
  description: string;
  basePrice: number;
  bladeDia: number | null;
  // Air-curtain attributes — present only on Air Curtain catalogue items.
  type?: string | null;
  lengthMm?: number | null;
  heightM?: number | null;
  powerW?: number | null;
  airVolumeCmh?: number | null;
}

interface LineSpecs {
  itemLabel: string;
  capacity_cfm: number | null;
  staticPressure_pa: number | null;
  inches: number | null;
  motorHp: number | null;
  motorPh: number | null;
  motorVolts: number | null;
  motorPole: number | null;
  bodyPrice: number | null; // net blower-body price (before motor / VAT)
  power_w: number | null; // KDK unit rated consumption (W), from the catalog
  blowerModel: string | null; // base catalogue model code, e.g. AV1225CEB
  // Per-item product selection (classification).
  category: string;
  brand: string;
  type: string;
  bladeType: string;
  drive: string;
  material: string;
  shape: string;
  sizeL: string;
  sizeW: string;
  sizeUnit?: string; // dimension unit (mm/cm/inches) for sized accessories
  powderCoated?: boolean; // accessory powder-coat finish flag
  // Air-curtain client inputs (installation height + door width with units).
  acHeight?: number | null;
  acHeightUnit?: string;
  acWidth?: number | null;
  acWidthUnit?: string;
  // Motor Controller: pull phase/pole/HP/volts from the nearest fan line above.
  mcRecommend?: boolean;
}
/** Fan/blower categories a Motor Controller can take its motor details from. */
const BLOWER_CATEGORIES = new Set([
  "Centrifugal Type",
  "Axial Type",
  "Propeller Type",
  "Tubular Inline Type",
  "Cabinet Type",
]);
interface Line {
  id: string;
  descriptionSnapshot: string;
  qty: number;
  unitPrice: number; // VAT-inclusive
  lineTotal: number;
  selectionNote: string | null;
  specs: LineSpecs;
  rawSpecs: Record<string, unknown>;
}
interface Quote {
  id: string;
  quoteNumber: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SENT";
  currency: string;
  vatMode: "INCLUSIVE" | "EXCLUSIVE" | "EXCLUSIVE_PLUS";
  discountPct: number;
  headerUnits: { capacity: string; pressure: string; motor: string };
  projectName: string;
  subtotal: number;
  vat: number;
  total: number;
  notes: string | null;
  terms: string | null;
  validUntil: string;
  templateId: string;
  templateName: string;
  customer: string;
  preparedBy: string;
  approvedBy: string | null;
  items: Line[];
}

const numOrNull = (v: string): number | null => (v === "" ? null : Number(v) || 0);
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const voltageKey = (v: number | null): Voltage => (v === 220 ? "220" : v === 440 ? "440" : "380");
/** Replace the "Model:" value in a standard description (no-op if absent). */
function rewriteModelLine(desc: string, combined: string): string {
  if (!combined || !/Model:\s*/i.test(desc)) return desc;
  return desc.replace(/(Model:\s*)([^\n]*)/i, `$1${combined}`);
}
/**
 * Effective blower model code for a drive: catalogue models are belt-drive, so
 * a direct-drive selection appends "DD" (e.g. AV2450CEB -> AV2450CEBDD).
 */
function effectiveBlowerModel(model: string | null, drive: string): string {
  if (!model) return "";
  // Natively-direct catalogues already encode the drive in the code (…EWFDD),
  // so only append "DD" for belt-catalogue models that don't already end in DD.
  if (/direct/i.test(drive) && !/DD$/i.test(model)) return `${model}DD`;
  return model;
}
/**
 * Reflect the drive in the description as "Belt Drive" / "Direct Drive". When a
 * drive is chosen the word is flipped to match; otherwise the existing Belt or
 * Direct word is kept and only "Driven" is normalised to "Drive".
 */
function rewriteDriveLine(desc: string, drive: string): string {
  if (drive) {
    const word = /direct/i.test(drive) ? "Direct" : "Belt";
    return desc.replace(/\b(?:Belt|Direct) Driven?\b/gi, `${word} Drive`);
  }
  return desc.replace(/\b(Belt|Direct) Driven?\b/gi, "$1 Drive");
}
/**
 * Forward-curve (CFAB) units are "Centrifugal Fresh Air Blower" in the
 * description; any other blade type is plain "Centrifugal Blower". Idempotent
 * both ways so it can run on every recompute.
 */
/**
 * Propeller wall fans (Exhaust / Fresh Air) share one catalogue and selection
 * path — EWF (belt) / EWFDD (direct). "Panel Fan" is the legacy type name, kept
 * so older saved quotes still resolve.
 */
const PROPELLER_FAN_TYPES = new Set([
  "Exhaust Wall Fan",
  "Fresh Air Wall Fan",
  "Power Roof Ventilator",
  "Panel Fan",
]);
const AXIAL_FAN_TYPES = new Set(["Tubeaxial", "Vaneaxial"]);
// KDK pre-built units: selected by model (no blade type / drive / material).
// They follow the quote's VAT presentation like any other product. The
// "KDK - Ceiling Cassette" alias covers quotes saved during the brief window
// the brand was part of the type name.
const KDK_TYPES = new Set(["Ceiling Cassette", "KDK - Ceiling Cassette"]);
const NO_BLADE_DRIVE_TYPES = KDK_TYPES;
/** KDK pre-built units (whole catalogue items) hide blade type / drive / material. */
const isPrebuiltUnit = (specs: { brand: string; type: string }): boolean =>
  specs.brand === "KDK" || NO_BLADE_DRIVE_TYPES.has(specs.type);
/** Shutter Series wall fans select on air volume only — static pressure is N/A. */
const isFlowOnlyUnit = (specs: { type: string; bladeType: string }): boolean =>
  specs.type === "Wall Mounted Fan" && specs.bladeType === "Shutter Series";
/** Air curtains are picked differently from the duty-selected fans. */
const isAirCurtain = (specs: { type: string }): boolean => specs.type === "Air Curtain";
/** Motor Controller is a simple sub-typed item (Motor Starter / VFD) — no fan
 *  fields (blade/drive/material/duty/size). The sub-type lives in bladeType. */
const isMotorController = (specs: { type: string }): boolean => specs.type === "Motor Controller";
/** Spring Vibration Isolator: priced by mounting + rated capacity (no duty/motor). */
const isIsolator = (specs: { type: string }): boolean => specs.type === "Spring Vibration Isolator";
/** Rated capacities (kg); price by mounting (foot/ceiling). */
const ISO_CAPS = [25, 35, 50, 80, 120, 175, 225, 300, 450, 600, 825];
const ISO_PRICE: { foot: Record<number, number>; ceiling: Record<number, number> } = {
  // Foot Mounted = "Floor Mounted" table; Ceiling Mounted = "Hanger Type" table.
  foot: { 25: 1417, 35: 1478, 50: 1540, 80: 1589, 120: 1663, 175: 1724, 225: 2587, 300: 3819, 450: 4127, 600: 4805, 825: 4866 },
  ceiling: { 25: 1294, 35: 1331, 50: 1355, 80: 1417, 120: 1478, 175: 1540, 225: 1725, 300: 3696, 450: 4189, 600: 5544, 825: 5667 },
};
/** Motor weight (kg) by HP — used to recommend an isolator capacity from a motor. */
const MOTOR_WEIGHT_KG: Record<number, number> = {
  0.5: 12, 1: 14, 1.5: 25, 2: 25, 3: 31, 5: 42, 7.5: 67, 10: 78, 15: 122,
  20: 144, 25: 182, 30: 182, 40: 215, 50: 315, 60: 315, 75: 375,
};
/** Smallest rated capacity that covers the required load (kg). */
const isolatorRatedCap = (capKg: number | null): number | null =>
  capKg == null ? null : ISO_CAPS.find((c) => c >= capKg) ?? null;
/** Isolator net (VAT-exclusive) price from mounting + required capacity. */
function isolatorNetPrice(shape: string, capKg: number | null): number | null {
  const rated = isolatorRatedCap(capKg);
  if (rated == null) return null;
  const table = shape === "Foot Mounted" ? ISO_PRICE.foot : shape === "Ceiling Mounted" ? ISO_PRICE.ceiling : null;
  return table ? table[rated] ?? null : null;
}
/**
 * Recommend a spring set from the fan/blower above: number of springs and the
 * rated capacity per spring. Load = motor weight × 9, divided per category, then
 * rounded up to the next rated capacity. Propeller types use no springs.
 *   Axial / Tubular Inline → 4 springs, ÷4
 *   Centrifugal SISW (non-cabinet) → 6 springs, ÷6
 *   Centrifugal DIDW (non-cabinet) → 6 springs, ÷5
 *   Cabinet SISW → 4 springs, ÷3   ·   Cabinet DIDW → 4 springs, ÷2
 */
function isolatorRecommend(
  category: string,
  type: string,
  motorKg: number | null,
): { springs: number; rated: number | null; noSpring: boolean } | null {
  if (category === "Propeller Type") return { springs: 0, rated: null, noSpring: true };
  if (motorKg == null) return null;
  const t = (type || "").toLowerCase();
  let divisor: number;
  let springs: number;
  if (t.includes("cabinet") && t.includes("sisw")) { divisor = 3; springs = 4; }
  else if (t.includes("cabinet") && t.includes("didw")) { divisor = 2; springs = 4; }
  else if (category === "Axial Type" || category === "Tubular Inline Type") { divisor = 4; springs = 4; }
  else if (category === "Centrifugal Type") { divisor = t.includes("didw") ? 5 : 6; springs = 6; }
  else return null;
  return { springs, rated: isolatorRatedCap((motorKg * 9) / divisor), noSpring: false };
}
/** Isolator description: type / mounting / rated capacity + spring colour. */
function buildIsolatorDescription(shape: string, capKg: number | null): string {
  const rated = isolatorRatedCap(capKg);
  return [
    "Spring Vibration Isolator",
    shape || "",
    rated != null ? `Rated capacity ${rated} kg` : "",
  ]
    .filter((l) => l.length > 0)
    .join("\n");
}
/** Motor-starter wiring options (dropdown values keep the Y/Δ symbol). */
const MOTOR_STARTER_TYPES = ["DOL", "Y/Δ", "Y/YY"];
/** Spelled-out labels for the description box (the dropdown keeps the symbol). */
const STARTER_DESC_LABEL: Record<string, string> = { DOL: "Direct Online", "Y/Δ": "Y-Delta", "Y/YY": "Y-Double Y" };
/**
 * Motor Controller description. For a Motor Starter the "Motor Starter" line is
 * dropped and the starter type is spelled out (e.g. Y/Δ → Y-Delta); other
 * sub-types (VFD) keep their name.
 */
function buildMotorControllerDescription(subType?: string | null, starterType?: string | null): string {
  const line2 =
    subType === "Motor Starter"
      ? starterType
        ? STARTER_DESC_LABEL[starterType] ?? starterType
        : ""
      : subType || "";
  return ["Motor Controller", line2].filter((l) => l.length > 0).join("\n");
}
/** DOL motor-starter HP buckets and VAT-inclusive price by phase/voltage column. */
const DOL_HP_OPTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5];
const DOL_PRICE: Record<"sp220" | "tp220" | "tp380400" | "tp440", Record<number, number>> = {
  sp220: { 0.25: 9784, 0.5: 9784, 0.75: 9784, 1: 9784, 1.5: 9784, 2: 10826, 3: 11000, 5: 13045, 7.5: 16884 },
  tp220: { 0.25: 10405, 0.5: 10405, 0.75: 10405, 1: 10405, 1.5: 10405, 2: 10405, 3: 10405, 5: 11514, 7.5: 12692 },
  tp380400: { 0.25: 10386, 0.5: 10386, 0.75: 10386, 1: 10386, 1.5: 10386, 2: 10386, 3: 10386, 5: 10386, 7.5: 11507 },
  tp440: { 0.25: 10386, 0.5: 10386, 0.75: 10386, 1: 10386, 1.5: 10386, 2: 10386, 3: 10386, 5: 10386, 7.5: 10386 },
};
/** DOL price from phase + voltage + HP (single-phase is 220 V only). */
function dolUnitPrice(phase: number | null, volts: number | null, hp: number | null): number | null {
  if (phase == null || hp == null) return null;
  const col =
    phase === 1
      ? DOL_PRICE.sp220
      : volts === 220
        ? DOL_PRICE.tp220
        : volts === 440
          ? DOL_PRICE.tp440
          : volts === 380 || volts === 400
            ? DOL_PRICE.tp380400
            : null;
  return col ? col[hp] ?? null : null;
}
/** Voltages valid for a starter type: Y-Δ → 220/440, Y-YY → 380/400, else all. */
function starterVolts(drive: string | null | undefined): number[] {
  if (drive === "Y/Δ") return [220, 440];
  if (drive === "Y/YY") return [380, 400];
  return [220, 380, 400, 440];
}
/** Reduced-voltage starters (Y-Δ / Y-YY) are sized for larger motors (5–50 HP). */
const REDUCED_HP_OPTIONS = [5, 7.5, 10, 15, 20, 25, 30, 40, 50];
const YDELTA_PRICE: Record<"220" | "440", Record<number, number>> = {
  "220": { 5: 19928, 7.5: 22930, 10: 25686, 15: 27725, 20: 32020, 25: 37213, 30: 39462, 40: 50266, 50: 64021 },
  "440": { 5: 22532, 7.5: 22532, 10: 23235, 15: 24945, 20: 25502, 25: 28249, 30: 29925, 40: 37443, 50: 39605 },
};
const YYY_PRICE: Record<number, number> = { 5: 25624, 7.5: 25624, 10: 25926, 15: 28195, 20: 30378, 25: 32575, 30: 36307, 40: 42261, 50: 48414 };
/** HP buckets for a starter type (DOL: 0.25–7.5; Y-Δ / Y-YY: 5–50). */
function starterHpOptions(drive: string | null | undefined): number[] {
  return drive === "Y/Δ" || drive === "Y/YY" ? REDUCED_HP_OPTIONS : DOL_HP_OPTIONS;
}
/** VAT-exclusive (net) price for a motor-starter selection, or null if incomplete. */
function starterNetPrice(
  drive: string | null | undefined,
  phase: number | null,
  volts: number | null,
  hp: number | null,
): number | null {
  if (hp == null) return null;
  if (drive === "DOL") return dolUnitPrice(phase, volts, hp);
  if (drive === "Y/Δ") {
    if (volts === 220) return YDELTA_PRICE["220"][hp] ?? null;
    if (volts === 440) return YDELTA_PRICE["440"][hp] ?? null;
    return null;
  }
  if (drive === "Y/YY") return volts === 380 || volts === 400 ? YYY_PRICE[hp] ?? null : null;
  return null;
}
/** Variable Frequency Drive: price by HP only; voltage just gates availability. */
const VFD_HP_OPTIONS = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150];
const VFD_PRICE: Record<number, number> = {
  1: 25042, 2: 25706, 3: 29696, 5: 32577, 7.5: 44100, 10: 49862, 15: 65485, 20: 77229, 25: 96620,
  30: 149804, 40: 167422, 50: 349137, 60: 394454, 75: 452071, 100: 573178, 125: 396893, 150: 461379,
};
/** VFD voltages (3-phase): 220/380/400/440 up to 100 HP; 440 V only for 125 & 150 HP. */
function vfdVolts(hp: number | null): number[] {
  return hp === 125 || hp === 150 ? [440] : [220, 380, 400, 440];
}
/** VFD net (VAT-exclusive) price — needs HP and an available voltage. */
function vfdNetPrice(volts: number | null, hp: number | null): number | null {
  if (hp == null || volts == null || !vfdVolts(hp).includes(volts)) return null;
  return VFD_PRICE[hp] ?? null;
}
/** Length units the sales team can enter the client's height / door width in. */
const LENGTH_UNITS = ["mm", "cm", "inches", "feet", "meter"];
const LEN_TO_M: Record<string, number> = { mm: 0.001, cm: 0.01, inches: 0.0254, feet: 0.3048, meter: 1, m: 1 };
const lenToMeters = (v: number, unit: string): number => v * (LEN_TO_M[unit] ?? 1);
/** Format an air-volume value: whole number when large, 1 decimal when small. */
const fmtFlow = (v: number): number => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
/** Ensure a current value shows in a dropdown even if it's outside the options. */
const withVal = (opts: number[], v: number | null | undefined): number[] =>
  v != null && !opts.includes(v) ? [v, ...opts] : opts;
/** Air-curtain description (covers client opening; lists the unit's ratings). */
function buildAirCurtainDescription(model?: string | null, heightM?: number | null, widthMm?: number | null): string {
  return [
    "Air Curtain",
    "KDK Brand",
    heightM != null ? `Effective height ${heightM} m` : "",
    widthMm != null ? `Unit width ${widthMm} mm` : "",
    model ? `Model: ${model}` : "",
  ]
    .filter((l) => l.length > 0)
    .join("\n");
}
/** Wheel-construction label for line 2 of a blower/fan description. */
function constructionLabel(type: string): string {
  if (PROPELLER_FAN_TYPES.has(type)) return "Propeller Type";
  if (AXIAL_FAN_TYPES.has(type)) return "Axial Type";
  return "Impeller Type";
}
/**
 * Blower/fan description, rebuilt from the current selections so each dropdown
 * updates its own part — used by every blower category:
 *   line 1  <product noun>                                     (Type / Blade)
 *   line 2  <Impeller|Propeller|Axial> Type / <Belt|Direct> Drive   (Blade / Drive)
 *   line 3  Made of <material>                                  (Material)
 *   line 4  Painted with Epoxy Enamel Aqua Green[ / Model: <model>]
 * The paint phrase is constant (dropped only for unpainted stainless); the model
 * is filled once a size is picked via Run selection (the export renders only the
 * description, so it lives here).
 */
function buildBlowerDescription(
  type: string,
  bladeType: string,
  drive: string,
  material: string,
  model?: string | null,
): string {
  const driveWord = /direct/i.test(drive) ? "Direct Drive" : "Belt Drive";
  const stainless = /stainless 3(?:04|16)/i.test(material);
  const lines = [
    productNoun(type, bladeType),
    `${constructionLabel(type)} / ${driveWord}`,
    `Made of ${materialPhrase(material || "Black Iron Sheet")}`,
    stainless
      ? model
        ? `Model: ${model}`
        : ""
      : `Painted with Epoxy Enamel Aqua Green${model ? ` / Model: ${model}` : ""}`,
  ];
  return lines.filter((l) => l.length > 0).join("\n");
}
/**
 * KDK pre-built unit description, built from the selections (no blade/drive/
 * material/paint lines):
 *   line 1  <type>                  e.g. "Ceiling Cassette"
 *   line 2  KDK Brand
 *   line 3  Model: <model>          once the salesperson picks a model
 */
function buildKdkDescription(type: string, model?: string | null, series?: string | null): string {
  return [series ? `${type} - ${series}` : type, "KDK Brand", model ? `Model: ${model}` : ""]
    .filter((l) => l.length > 0)
    .join("\n");
}
/**
 * Product noun for the first description line, by type and blade type:
 *  - Cabinet Blower (SISW) -> "Cabinet Blower-SISW"
 *  - Forward Curved        -> "Centrifugal Fresh Air Blower"
 *  - otherwise             -> "Centrifugal Blower"
 */
function productNoun(type: string, bladeType: string): string {
  if (PROPELLER_FAN_TYPES.has(type)) return type;
  if (type === "Cabinet Blower (SISW)") return "Cabinet Blower-SISW";
  if (type === "Cabinet Blower (DIDW)") return "Cabinet Blower-DIDW";
  if (type === "Centrifugal Inline Blower") return "Centrifugal Inline Blower";
  if (type === "Square Inline Blower") return "Square Inline Blower";
  if (type === "Centrifugal Blower (DIDW)" || type === "Double Inlet Double Width (DIDW)")
    return "Centrifugal Blower - DIDW";
  if (/forward/i.test(bladeType)) return "Centrifugal Fresh Air Blower";
  if (type === "Centrifugal Blower (SISW)") return "Centrifugal Blower";
  return type || "Centrifugal Blower"; // future types: fall back to the type name
}
// Known product nouns, longest/most-specific first so the swap is unambiguous
// (e.g. "Centrifugal Blower - DIDW" before the bare "Centrifugal Blower").
const PRODUCT_NOUNS = [
  "Exhaust Wall Fan",
  "Fresh Air Wall Fan",
  "Panel Fan",
  "Centrifugal Fresh Air Blower",
  "Centrifugal Inline Blower",
  "Square Inline Blower",
  "Centrifugal Blower - DIDW",
  "Cabinet Blower-SISW",
  "Cabinet Blower-DIDW",
  "Centrifugal Blower",
];
/**
 * Replace whichever known product noun appears in the description with the one
 * implied by the current type/blade. Idempotent, so it runs on every recompute.
 */
function rewriteProductNoun(desc: string, type: string, bladeType: string): string {
  const target = productNoun(type, bladeType);
  let out = desc;
  for (const noun of PRODUCT_NOUNS) {
    const re = new RegExp(noun, "i");
    if (re.test(out)) {
      out = out.replace(re, target);
      break;
    }
  }
  // All centrifugal blowers are impeller-type; normalise the older inline wording.
  return out.replace(/Tubular Inline Type/gi, "Impeller Type");
}

/**
 * Drive options for a blade type. Forward curve (CFAB) is belt-only — its
 * performance ratings don't reach direct-drive speeds (e.g. 1750 rpm).
 */
function drivesFor(category: string, type: string, bladeType: string): string[] {
  const drives = entryFor(category, type)?.drives ?? [];
  return /forward/i.test(bladeType) ? drives.filter((d) => !/direct/i.test(d)) : drives;
}

/** Standard paint line, dropped for stainless builds. */
const PAINT_PHRASE = "Painted with Epoxy Enamel Aqua Green";
/** Material phrase for the description (drops a redundant trailing "material"). */
const MATERIAL_PHRASES: Record<string, string> = {
  "Heavy gauge material": "Heavy Gauge Material",
  "Stainless 304 material": "Stainless Steel 304",
  "Stainless 316 material": "Stainless Steel 316",
};
function materialPhrase(material: string): string {
  return MATERIAL_PHRASES[material] ?? material.replace(/\s+material$/i, "").trim();
}
/**
 * Reflect the chosen material in the description. The standard text already
 * carries a "Made of ..." line, so replace it in place; otherwise append one
 * for any non-standard material.
 */
function rewriteMaterialLine(desc: string, material: string): string {
  if (!material) return desc;
  const phrase = `Made of ${materialPhrase(material)}`;
  if (/Made of [^\n]*/i.test(desc)) return desc.replace(/Made of [^\n]*/i, phrase);
  return material === "Black Iron Sheet" ? desc : `${desc.replace(/\s+$/, "")}\n${phrase}`;
}
/**
 * Stainless 304/316 are unpainted, so drop the standard paint phrase (and its
 * "/ " separator before "Model:"); restore it for any other material.
 */
function rewritePaintLine(desc: string, material: string): string {
  const stainless = /stainless 3(?:04|16)/i.test(material);
  let out = desc.replace(new RegExp(`${PAINT_PHRASE}\\s*/\\s*`, "gi"), "");
  if (!stainless && /Model:/i.test(out) && !new RegExp(PAINT_PHRASE, "i").test(out)) {
    out = out.replace(/Model:/i, `${PAINT_PHRASE} / Model:`);
  }
  return out;
}

/** Unit options for the quote table headers (from the English & Metric chart). */
const CAPACITY_UNITS = ["cfm", "m³/hr", "m³/min", "m³/sec", "l/s", "l/min"];
const PRESSURE_UNITS = ["in-w.g.", "mm-w.g.", "Pa", "in-Hg", "mm-Hg", "psi", "atm"];
const POWER_UNITS = ["HP", "kW", "W"];
/** Material -> body-price multiplier (applied to the catalogue body price). */
const MATERIAL_FACTORS: Record<string, number> = {
  "Black Iron Sheet": 1,
  "Heavy gauge material": 1.25,
  "Fiberglass reinforced metal": 5.5,
  "Stainless 304 material": 4,
  "Stainless 316 material": 5,
  "Boiler Plate": 8,
};
const MATERIAL_OPTIONS = Object.keys(MATERIAL_FACTORS);
/** Categories whose body price is scaled by the material multiplier. */
const MATERIAL_CATEGORIES = new Set([
  "Centrifugal Type",
  "Axial Type",
  "Propeller Type",
  "Tubular Inline Type",
  "Cabinet Type",
]);
const materialFactor = (specs: LineSpecs): number =>
  MATERIAL_CATEGORIES.has(specs.category) ? MATERIAL_FACTORS[specs.material] ?? 1 : 1;

/**
 * Model-code tag by product type and blade type. DIDW has its own catalogue
 * (DIDWCEB backward / DIDWCFAB forward); Cabinet SISW reuses the CEB catalogue
 * (sold as CABSISW); Cabinet DIDW reuses the DIDW catalogue (sold as CEBCAB
 * backward / CFABCAB forward); forward curve is CFAB; otherwise CEB.
 */
function resolveTag(type: string, bladeType: string, category = ""): string {
  // Axial fans: Tubeaxial = TAF, Vaneaxial = VAF (belt tag; the drive picks the
  // "…DD" direct variant in selectionTag). Gated on the Axial Type category so
  // the Tubular Inline Type tube-/vane-axial entries are unaffected.
  if (category === "Axial Type") return type === "Vaneaxial" ? "VAF" : "TAF";
  // Propeller wall fans: Exhaust = EWF/EWFDD, Fresh Air = FAWF/FAWFDD. The belt
  // tag carries the ×1 price factor; the drive picks the direct variant in
  // selectionTag and via the model code from selection.
  if (type === "Power Roof Ventilator") return "PRV";
  if (type === "Fresh Air Wall Fan") return "FAWF";
  if (PROPELLER_FAN_TYPES.has(type)) return "EWF";
  if (type === "Centrifugal Inline Blower") return "CIEB";
  if (type === "Square Inline Blower") return "SIEB";
  if (type === "Cabinet Blower (DIDW)")
    return /forward/i.test(bladeType) ? "CFABCAB" : "CEBCAB";
  if (type === "Centrifugal Blower (DIDW)" || type === "Double Inlet Double Width (DIDW)")
    return /forward/i.test(bladeType) ? "DIDWCFAB" : "DIDWCEB";
  if (type === "Cabinet Blower (SISW)") return "CABSISW";
  if (/forward/i.test(bladeType)) return "CFAB";
  return "CEB";
}
/**
 * Catalogue tag to query when selecting for a type/blade. The cabinet tags reuse
 * the matching blower catalogue: CABSISW→CEB, CEBCAB→DIDWCEB, CFABCAB→DIDWCFAB;
 * SIEB (Square Inline) reuses the CIEB catalogue; every other tag queries its own.
 */
function selectionTag(type: string, bladeType: string, drive = "", category = ""): string {
  // KDK fixed-speed units query their own catalogue by type.
  if (KDK_TYPES.has(type)) return "CASSETTE";
  if (type === "Cabinet Fan") return "CABINETFAN";
  if (type === "Mini Sirocco") return "MINISIROCCO";
  // Wall Mounted Fan series (held in bladeType): High Pressure → GSC catalogue,
  // Shutter → the shutter/louver wall fans (flow-only selection).
  if (type === "Wall Mounted Fan") {
    if (bladeType === "High Pressure Series") return "GSCHP";
    if (bladeType === "Shutter Series") return "WMFSHUTTER";
    return "";
  }
  // Axial fans query their own belt/direct catalogue: TAF/TAFDD, VAF/VAFDD.
  if (category === "Axial Type") {
    const base = type === "Vaneaxial" ? "VAF" : "TAF";
    return /direct/i.test(drive) ? `${base}DD` : base;
  }
  // Propeller wall fans query their own belt/direct catalogue by application.
  if (type === "Power Roof Ventilator") return /direct/i.test(drive) ? "PRVDD" : "PRV";
  if (type === "Fresh Air Wall Fan") return /direct/i.test(drive) ? "FAWFDD" : "FAWF";
  if (PROPELLER_FAN_TYPES.has(type)) return /direct/i.test(drive) ? "EWFDD" : "EWF";
  const tag = resolveTag(type, bladeType, category);
  if (tag === "CABSISW") return "CEB";
  if (tag === "CEBCAB") return "DIDWCEB";
  if (tag === "CFABCAB") return "DIDWCFAB";
  if (tag === "SIEB") return "CIEB";
  return tag;
}
/**
 * Body-price factor by tag, applied to the body only (then × material):
 *  CEB ×1 (base) · CFAB ÷0.9 · CABSISW ÷0.54 · DIDWCEB ÷0.57 ·
 *  DIDWCFAB ÷0.9 ÷0.57 (forward × double-width) ·
 *  CEBCAB ÷0.57 ÷0.54 (DIDWCEB cabinet) ·
 *  CFABCAB ÷0.9 ÷0.57 ÷0.9 (DIDWCFAB cabinet).
 */
const TAG_FACTORS: Record<string, number> = {
  CEB: 1,
  CIEB: 1,
  SIEB: 1,
  EWF: 1,
  EWFDD: 1,
  FAWF: 1,
  FAWFDD: 1,
  PRV: 1,
  PRVDD: 1,
  // Axial fans carry their own catalogue price (VAF = TAF ÷ 0.75 is baked into
  // the stored VAF price), so the body factor is ×1; belt and direct share it.
  TAF: 1,
  TAFDD: 1,
  VAF: 1,
  VAFDD: 1,
  CFAB: 1 / 0.9,
  CABSISW: 1 / 0.54,
  DIDWCEB: 1 / 0.57,
  DIDWCFAB: 1 / (0.9 * 0.57),
  CEBCAB: 1 / (0.57 * 0.54),
  CFABCAB: 1 / (0.9 * 0.57 * 0.9),
};
const tagFactor = (tag: string): number => TAG_FACTORS[tag] ?? 1;
const bladeFactor = (specs: LineSpecs): number => tagFactor(resolveTag(specs.type, specs.bladeType, specs.category));
/** Net body price after the tag (blade/type) factor and material factor. */
const bodyPriceOf = (specs: LineSpecs): number =>
  (specs.bodyPrice ?? 0) * bladeFactor(specs) * materialFactor(specs);
/**
 * Re-tag a blower model code to match the current type/blade/drive.
 *  - Centrifugal family (CEB/CFAB/DIDW…/CIEB/SIEB): swap the suffix in place.
 *  - Wall fans: swap the application+drive suffix (EWF/EWFDD/FAWF/FAWFDD).
 * Crossing between the centrifugal and wall-fan families returns null — the size
 * systems differ, so the model must be re-selected.
 */
const WALL_FAN_SUFFIX = /(AV\d+)(?:FAWFDD|EWFDD|PRVDD|FAWF|EWF|PRV)$/i;
const AXIAL_SUFFIX = /(AV\d+)(?:VAFDD|TAFDD|VAF|TAF)$/i;
function retagModel(model: string | null, type: string, bladeType: string, drive = "", category = ""): string | null {
  if (!model) return model;
  if (category === "Axial Type") {
    const base = type === "Vaneaxial" ? "VAF" : "TAF";
    const suffix = base + (/direct/i.test(drive) ? "DD" : "");
    if (AXIAL_SUFFIX.test(model)) return model.replace(AXIAL_SUFFIX, `$1${suffix}`);
    return null; // came from another family — sizes differ, force re-selection
  }
  if (AXIAL_SUFFIX.test(model)) return null; // axial -> other family, force re-selection
  if (PROPELLER_FAN_TYPES.has(type)) {
    const app =
      type === "Power Roof Ventilator" ? "PRV" : type === "Fresh Air Wall Fan" ? "FAWF" : "EWF";
    const suffix = app + (/direct/i.test(drive) ? "DD" : "");
    if (WALL_FAN_SUFFIX.test(model)) return model.replace(WALL_FAN_SUFFIX, `$1${suffix}`);
    return null; // came from another family — sizes differ, force re-selection
  }
  if (WALL_FAN_SUFFIX.test(model)) return null; // wall fan -> centrifugal, force re-selection
  return model.replace(/(AV\d+)(?:DIDWCFAB|DIDWCEB|CFABCAB|CEBCAB|CABSISW|CIEB|SIEB|CFAB|CEB)/i, `$1${resolveTag(type, bladeType, category)}`);
}

/** Sized accessory types that carry a unit-of-measurement dropdown (mm/cm/inches). */
const UOM_TYPES = new Set([
  "Air Grille",
  "Bar Grille",
  "Ceiling Diffuser",
  "Louvers",
  "Perforated Air Grille",
  "Weather hood",
  "Backdraft Damper",
  "Fire Damper",
  "Gravity Shutter",
  "OBVD",
  "Smoke Damper",
  "Volume Damper",
  "Motorized Fire Damper",
  "Motorized Smoke Damper",
  "Motorized Volume Damper",
]);
const SIZE_UNITS = ["mm", "cm", "inches"];
/** Material options for Ventilation Accessories (Air Terminals / Dampers). */
const ACC_MATERIALS = ["Galvanized Iron", "Aluminum", "Stainless Steel 304"];
/** Accessory types that offer the powder-coat finish option. */
const POWDER_COAT_TYPES = new Set([
  "Air Grille",
  "Bar Grille",
  "Ceiling Diffuser",
  "Louvers",
  "Perforated Air Grille",
  "Vent Cap",
  "Weather hood",
  "Backdraft Damper",
  "Fire Damper",
  "Gravity Shutter",
  "OBVD",
  "Smoke Damper",
  "Volume Damper",
]);
// Air Terminals / Dampers use a trade conversion (NOT the exact 25.4 mm/inch):
//   25 mm = 1 inch · 2.5 cm = 1 inch · 10 mm = 1 cm.
const ACC_MM_PER_UNIT: Record<string, number> = { mm: 1, cm: 10, inches: 25 };
/** Convert a sized-accessory dimension between mm/cm/inches via the trade ratio. */
function convertAccSize(value: string, from: string, to: string): string {
  const n = parseFloat(value);
  if (!value || Number.isNaN(n) || from === to) return value;
  const mm = n * (ACC_MM_PER_UNIT[from] ?? 1);
  const out = mm / (ACC_MM_PER_UNIT[to] ?? 1);
  return String(Math.round(out * 1000) / 1000); // trim float noise
}

// --- Air Terminals / Dampers body pricing (per square inch, VAT-inclusive) ----
// Body price = area(sq in) × rate × material factor (powder coat ×1.5). Area uses
// the trade inch (25 mm = 1 inch); round = bounding square (D × D).
const ACC_GRILLE_TYPES = new Set(["Air Grille", "Bar Grille", "Ceiling Diffuser", "Louvers"]);
const ACC_DAMPER_TYPES = new Set(["Backdraft Damper", "Fire Damper", "Smoke Damper", "Volume Damper"]);
const ACC_MATERIAL_FACTOR: Record<string, number> = {
  "Galvanized Iron": 1,
  Aluminum: 3,
  "Stainless Steel 304": 4,
};
/** Per-square-inch body rate for an accessory, or null if not auto-priced. */
function accessoryRate(type: string, shape: string): number | null {
  const priced =
    ACC_GRILLE_TYPES.has(type) || ACC_DAMPER_TYPES.has(type) || type === "OBVD" || type === "Perforated Air Grille";
  if (!priced) return null;
  if (shape === "Round") return 10.42; // round grilles / dampers / diffusers
  if (type === "Perforated Air Grille") return 6; // perforated air grilles
  if (type === "OBVD") return 5;
  if (ACC_DAMPER_TYPES.has(type)) return 8; // square / rectangular damper / volume
  return 5; // square / rectangular grilles / louvers / diffusers
}
/** Accessory area in square inches (trade inch). Round = bounding square D×D. */
function accAreaSqIn(specs: LineSpecs): number | null {
  const unit = specs.sizeUnit || "mm";
  const toIn = (v: string): number | null => {
    const n = parseFloat(v);
    if (!v || Number.isNaN(n)) return null;
    return (n * (ACC_MM_PER_UNIT[unit] ?? 1)) / 25; // 25 mm = 1 inch
  };
  if (specs.shape === "Round") {
    const d = toIn(specs.sizeL);
    return d != null ? d * d : null;
  }
  const L = toIn(specs.sizeL);
  const W = toIn(specs.sizeW);
  return L != null && W != null ? L * W : null;
}
/** Minimum billable accessory area — anything smaller is charged as 100 sq in. */
const ACC_MIN_SQIN = 100;
/** Billed area: the computed area, floored to the 100 sq in minimum. */
function accBilledAreaSqIn(specs: LineSpecs): number | null {
  const area = accAreaSqIn(specs);
  return area == null ? null : Math.max(area, ACC_MIN_SQIN);
}
/** Powder-coat multiplier by type — ceiling diffuser ×2.12, otherwise ×1.5. */
function accPowderFactor(type: string): number {
  return type === "Ceiling Diffuser" ? 2.12 : 1.5;
}
/** Flat add-on (VAT-inclusive) on top of the body price — fire damper fusible link. */
function accFlatAdd(type: string): number {
  return type === "Fire Damper" ? 455 : 0;
}
/** Auto unit price (VAT-inclusive) for a sized accessory, or null if incomplete. */
function accessoryUnitPrice(specs: LineSpecs): number | null {
  const rate = accessoryRate(specs.type, specs.shape);
  const area = accBilledAreaSqIn(specs);
  const mat = ACC_MATERIAL_FACTOR[specs.material];
  if (rate == null || area == null || mat == null) return null;
  const body = area * rate * mat * (specs.powderCoated ? accPowderFactor(specs.type) : 1);
  return round2(body + accFlatAdd(specs.type));
}
/** A Ventilation Accessory that isn't the spring isolator (which prices itself). */
const isAccessory = (specs: { category: string; type: string }): boolean =>
  specs.category === "Ventilation Accessories" && specs.type !== "Spring Vibration Isolator";
/** Material label as shown in the description ("G.I." for Galvanized Iron). */
function accMaterialLabel(material: string): string {
  return material === "Galvanized Iron" ? "G.I." : material;
}
/**
 * Accessory description, one detail per line:
 *   Type / dimensions + unit / material / finish (oven-baked enamel or powder).
 * Lines appear as the matching selections are made; the finish line follows the
 * material. Round uses Ø diameter; square/rectangle uses L x W.
 */
function buildAccessoryDescription(specs: LineSpecs): string {
  const lines: string[] = [];
  if (specs.type) lines.push(specs.type);
  const unit = specs.sizeUnit || "mm";
  if (specs.shape === "Round") {
    if (specs.sizeL) lines.push(`Ø${specs.sizeL} ${unit}`);
  } else if (specs.sizeL && specs.sizeW) {
    lines.push(`${specs.sizeL} x ${specs.sizeW} ${unit}`);
  }
  if (ACC_MATERIALS.includes(specs.material)) {
    lines.push(`${accMaterialLabel(specs.material)} Material`);
    // Finish follows the material — but stainless steel 304 carries no finish.
    if (specs.material !== "Stainless Steel 304") {
      lines.push(
        POWDER_COAT_TYPES.has(specs.type) && specs.powderCoated
          ? "Powder Coated White"
          : "Painted with Oven Baked Enamel",
      );
    }
  }
  return lines.join("\n");
}

/** Shape / variant options for a Ventilation Accessory type. */
function shapesFor(type: string): string[] {
  if (type === "Bar Grille") return ["Rectangle"];
  if (type === "Jet Nozzle Diffuser" || type === "Vent Cap" || type === "Wind Driven Roof Ventilator") return ["Round"];
  if (type === "Spring Vibration Isolator") return ["Foot Mounted", "Ceiling Mounted"];
  // Air Terminals / Dampers: square and rectangle share the L×W size fields.
  return ["Round", "Square/Rectangle"];
}

/** Label for the variant dropdown (mounting for isolators, otherwise shape). */
function variantLabel(type: string): string {
  return type === "Spring Vibration Isolator" ? "Mounting" : "Shape";
}

/** What the size field(s) mean for this accessory. */
function sizeMode(type: string, shape: string): "capacity" | "diameter" | "lw" {
  if (type === "Spring Vibration Isolator") return "capacity";
  if (shape === "Round") return "diameter";
  return "lw";
}

function selSize(r: SelectionResult): number {
  if (r.sizeLabel) {
    const n = parseFloat(r.sizeLabel);
    if (!Number.isNaN(n)) return n;
  }
  const m = r.modelCode.match(/(\d{3,5})/);
  return m ? parseInt(m[1], 10) / 100 : 0;
}

/** 3 sizes smaller + the recommended (top HIGH) + 3 bigger, in size order. */
function sizeWindow(results: SelectionResult[]): { rec: SelectionResult; list: SelectionResult[] } | null {
  if (results.length === 0) return null;
  const rec = results.find((r) => r.confidence === "HIGH") ?? results[0];
  const bySize = [...results].sort((a, b) => selSize(a) - selSize(b));
  const idx = bySize.findIndex((r) => r.modelId === rec.modelId);
  return { rec, list: bySize.slice(Math.max(0, idx - 3), idx + 4) };
}

export function QuotationBuilder({
  quotation,
  templates,
  canApprove,
  isAdmin = false,
  catalog,
}: {
  quotation: Quote;
  templates: { id: string; name: string }[];
  canApprove: boolean;
  isAdmin?: boolean;
  catalog: Record<string, CatalogEntry>;
}) {
  const router = useRouter();
  const editable = quotation.status === "DRAFT";

  // Admin-only quotation-number editing.
  const [quoteNo, setQuoteNo] = useState(quotation.quoteNumber);
  const [editingNo, setEditingNo] = useState(false);
  const [noDraft, setNoDraft] = useState(quotation.quoteNumber);
  const [noBusy, setNoBusy] = useState(false);
  const [noErr, setNoErr] = useState<string | null>(null);
  async function saveQuoteNo() {
    setNoBusy(true);
    setNoErr(null);
    const res = await updateQuoteNumber({ id: quotation.id, quoteNumber: noDraft.trim() });
    setNoBusy(false);
    if ("error" in res) {
      setNoErr(res.error);
      return;
    }
    setQuoteNo(noDraft.trim());
    setEditingNo(false);
    router.refresh();
  }

  const [lines, setLines] = useState<Line[]>(quotation.items);
  const [templateId, setTemplateId] = useState(quotation.templateId);
  const [projectName, setProjectName] = useState(quotation.projectName);
  const [vatMode, setVatMode] = useState(quotation.vatMode);
  const [discountPct, setDiscountPct] = useState(quotation.discountPct);
  const [units, setUnits] = useState(() => ({
    capacity: quotation.headerUnits.capacity || "cfm",
    pressure: quotation.headerUnits.pressure || "in-w.g.",
    motor: quotation.headerUnits.motor || "HP",
  }));
  const [notes, setNotes] = useState(quotation.notes ?? "");
  const [terms, setTerms] = useState(quotation.terms ?? "");
  const [validUntil, setValidUntil] = useState(quotation.validUntil);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Per-line fan-selector state, keyed by line id.
  const [sel, setSel] = useState<Record<string, { loading: boolean; error: string | null; results: SelectionResult[] | null }>>({});
  // Air-curtain recommendation list: collapse after a unit is picked (per line).
  // Lines that already have a picked air-curtain model load collapsed.
  const [acCollapsed, setAcCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      quotation.items.filter((l) => isAirCurtain(l.specs) && l.specs.blowerModel).map((l) => [l.id, true]),
    ),
  );
  // Air-curtain picks only show after the user clicks "Run selection" (per line).
  const [acRan, setAcRan] = useState<Record<string, boolean>>({});

  const vatRate = config.vatRate;
  // KDK products follow the quote's VAT presentation like every other product
  // (priced VAT-exclusive when the quote is in an exclusive mode); the catalogue
  // price is stored VAT-inclusive and the mode strips/adds VAT for display.
  const effectiveVatMode = vatMode;
  const totals = useMemo(() => {
    const gross = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0); // VAT-inclusive
    const net = gross / (1 + vatRate);
    const exclusive = effectiveVatMode !== "INCLUSIVE";
    const displayedNet = exclusive ? net : gross;
    const discountAmt = displayedNet * (discountPct / 100);
    const finalNet = displayedNet - discountAmt;
    const addVat = effectiveVatMode === "EXCLUSIVE_PLUS";
    const vatAmt = addVat ? finalNet * vatRate : 0;
    const grandTotal = finalNet + vatAmt;
    return { net, vat: gross - net, gross, exclusive, displayedNet, discountAmt, finalNet, addVat, vatAmt, grandTotal };
  }, [lines, vatRate, effectiveVatMode, discountPct]);

  // Keep "Recommend?" Motor Controller lines in sync with the nearest fan line
  // above: whenever any line changes, re-pull phase/pole/HP/volts and re-price.
  // Returns the same array reference when nothing changed (so it can't loop).
  useEffect(() => {
    setLines((ls) => {
      let changed = false;
      const next = ls.map((l, idx) => {
        if (!l.specs.mcRecommend || (!isMotorController(l.specs) && !isIsolator(l.specs))) return l;
        let src: LineSpecs | null = null;
        for (let i = idx - 1; i >= 0; i--) {
          if (BLOWER_CATEGORIES.has(ls[i].specs.category)) { src = ls[i].specs; break; }
        }
        // Isolator: recommend a spring set from the motor above. Number of springs
        // + per-spring capacity are computed per fan category; price is always the
        // foot-mounted price for that capacity; Qty = number of springs.
        if (isIsolator(l.specs)) {
          const motorKg = src?.motorHp != null ? MOTOR_WEIGHT_KG[src.motorHp] ?? null : null;
          const rec = src ? isolatorRecommend(src.category, src.type, motorKg) : null;
          const shape = "Foot Mounted"; // recommendation always uses the foot-mounted price
          const rated = rec && !rec.noSpring ? rec.rated : null;
          const sizeL = rated != null ? String(rated) : "";
          const qty = rec && rec.springs > 0 ? rec.springs : l.qty;
          const net = rated != null ? ISO_PRICE.foot[rated] ?? null : null;
          const unitPrice = net != null ? round2(net * (1 + vatRate)) : 0;
          const desc = rec?.noSpring
            ? "Spring Vibration Isolator\nNo spring required (propeller type)"
            : buildIsolatorDescription(shape, rated);
          if (
            l.specs.shape === shape && l.specs.sizeL === sizeL && l.qty === qty &&
            l.unitPrice === unitPrice && l.descriptionSnapshot === desc
          ) return l;
          changed = true;
          const specs = { ...l.specs, shape, sizeL };
          return { ...l, qty, specs, descriptionSnapshot: desc, unitPrice };
        }
        const ph = src?.motorPh ?? null;
        const pole = src?.motorPole ?? null;
        const hp = src?.motorHp ?? null;
        let volts = src?.motorVolts ?? null;
        // Pick the controller from the motor: ≥15 HP → VFD; 3-phase 7.5–10 HP →
        // Y-Δ (220/440) or Y-YY (380/400); otherwise (≤5 HP or single-phase) → DOL.
        let bladeType = l.specs.bladeType;
        let drive = l.specs.drive;
        if (hp != null && ph != null) {
          if (hp >= 15) {
            bladeType = "Variable Frequency Drive";
            drive = "";
          } else if (ph === 1 || hp < 7.5) {
            bladeType = "Motor Starter";
            drive = "DOL";
          } else {
            bladeType = "Motor Starter";
            drive = volts === 220 || volts === 440 ? "Y/Δ" : volts === 380 || volts === 400 ? "Y/YY" : "";
          }
        }
        const isVfd = bladeType === "Variable Frequency Drive";
        if (!isVfd && ph === 1) volts = 220; // DOL single-phase is 220 V
        // Price: VFD has no single-phase output; otherwise look up the right table.
        const net =
          hp == null || ph == null
            ? null
            : isVfd
              ? ph === 1 ? null : vfdNetPrice(volts, hp)
              : starterNetPrice(drive, ph, volts, hp);
        const unitPrice = net != null ? round2(net * (1 + vatRate)) : 0;
        if (
          l.specs.bladeType === bladeType && l.specs.drive === drive && l.specs.motorPh === ph &&
          l.specs.motorPole === pole && l.specs.motorHp === hp && l.specs.motorVolts === volts &&
          l.unitPrice === unitPrice
        ) return l; // already in sync
        changed = true;
        const specs = { ...l.specs, bladeType, drive, motorPh: ph, motorPole: pole, motorHp: hp, motorVolts: volts };
        if (net != null) specs.bodyPrice = net;
        return {
          ...l,
          specs,
          descriptionSnapshot: buildMotorControllerDescription(bladeType, drive),
          unitPrice,
        };
      });
      return changed ? next : ls;
    });
  }, [lines, vatRate]);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function updateSpec(id: string, patch: Partial<LineSpecs>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, specs: { ...l.specs, ...patch } } : l)));
  }
  // KDK pre-built units: merge the patch and rebuild the KDK description
  // (Type / KDK Brand / Model). KDK units are single-phase, 220 V (fixed).
  function applyKdk(id: string, patch: Partial<LineSpecs>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const specs = { ...l.specs, ...patch, motorPh: 1, motorVolts: 220, inches: null };
        return { ...l, specs, descriptionSnapshot: buildKdkDescription(specs.type, specs.blowerModel, specs.bladeType) };
      }),
    );
  }
  // Air-curtain recommendation: from the client's installation height + door
  // width, the unit must reach the full height (effective height ≥ installation
  // height) and span the opening (unit width ≥ door width). Cheapest qualifying
  // model first. Returns [] until both inputs are entered.
  function airCurtainPicks(specs: LineSpecs): CatalogEntry[] {
    if (specs.acHeight == null || specs.acWidth == null) return [];
    const needH = lenToMeters(specs.acHeight, specs.acHeightUnit ?? "meter");
    const needW = lenToMeters(specs.acWidth, specs.acWidthUnit ?? "mm") * 1000; // → mm
    return Object.values(catalog)
      .filter((c) => c.type === "Air Curtain" && (c.heightM ?? 0) >= needH && (c.lengthMm ?? 0) >= needW)
      .sort(
        (a, b) =>
          a.basePrice - b.basePrice ||
          (a.heightM ?? 0) - (b.heightM ?? 0) ||
          (a.lengthMm ?? 0) - (b.lengthMm ?? 0),
      );
  }
  // Apply a recommended air-curtain model: the catalogue (VAT-exclusive) price
  // stored gross + consumption, single-phase 220 V (the client height/width
  // inputs are kept on the line).
  function applyAirCurtainModel(lineId: string, entry: CatalogEntry) {
    // Air volume for the quote's Capacity column, in the header's flow unit.
    const headerUnit = normalizeAirflowUnit(units.capacity) ?? "m3hr";
    const capVal =
      entry.airVolumeCmh != null ? fmtFlow(convertAirflow(entry.airVolumeCmh, "m3hr", headerUnit)) : null;
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== lineId) return l;
        const specs: LineSpecs = {
          ...l.specs,
          blowerModel: entry.modelCode,
          bodyPrice: entry.basePrice,
          power_w: entry.powerW ?? null,
          capacity_cfm: capVal ?? l.specs.capacity_cfm,
          motorPh: 1,
          motorVolts: 220,
          inches: null,
        };
        return {
          ...l,
          specs,
          unitPrice: round2(entry.basePrice * (1 + vatRate)),
          descriptionSnapshot: buildAirCurtainDescription(entry.modelCode, entry.heightM, entry.lengthMm),
        };
      }),
    );
    setAcCollapsed((m) => ({ ...m, [lineId]: true })); // collapse the list after picking
  }
  // Spring Vibration Isolator: merge the mounting / capacity patch, rebuild the
  // description, and auto-fill the VAT-inclusive unit price (table prices are net).
  function applyIsolator(lineId: string, patch: Partial<LineSpecs>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== lineId) return l;
        const specs = { ...l.specs, ...patch };
        const capRaw = specs.sizeL ? Number(specs.sizeL) : NaN;
        const capKg = Number.isNaN(capRaw) ? null : capRaw;
        const net = isolatorNetPrice(specs.shape, capKg);
        return {
          ...l,
          specs,
          descriptionSnapshot: buildIsolatorDescription(specs.shape, capKg),
          ...(net != null ? { unitPrice: round2(net * (1 + vatRate)) } : {}),
        };
      }),
    );
  }
  // Air Terminals / Dampers: merge the patch and auto-fill the per-square-inch
  // body price (VAT-inclusive). When the inputs aren't complete the price is left
  // as-is, except on a type change (resetPrice) where the stale price is cleared.
  function applyAccessory(lineId: string, patch: Partial<LineSpecs>, resetPrice = false) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== lineId) return l;
        const specs = { ...l.specs, ...patch };
        // Stainless steel 304 is never powder-coated — drop any stale flag so the
        // price and description don't carry the ×1.5 / "Powder Coated" finish.
        if (specs.material === "Stainless Steel 304") specs.powderCoated = false;
        const price = accessoryUnitPrice(specs);
        return {
          ...l,
          specs,
          descriptionSnapshot: buildAccessoryDescription(specs),
          ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
        };
      }),
    );
  }
  // Motor Controller: merge the patch (sub-type and/or phase/HP/voltage), rebuild
  // the description, and — for a Motor Starter — auto-fill the VAT-inclusive unit
  // price from the starter table (DOL / Y-Δ / Y-YY). Table prices are net.
  function applyMotorController(id: string, patch: Partial<LineSpecs>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const specs = { ...l.specs, ...patch };
        if (specs.motorPh === 1) specs.motorVolts = 220; // single-phase is 220 V only
        const isVfd = specs.bladeType === "Variable Frequency Drive";
        // VFD 125/150 HP are 440 V only — drop a now-invalid voltage.
        if (isVfd && specs.motorVolts != null && !vfdVolts(specs.motorHp).includes(specs.motorVolts)) {
          specs.motorVolts = null;
        }
        const net = isVfd
          ? vfdNetPrice(specs.motorVolts, specs.motorHp)
          : specs.bladeType === "Motor Starter"
            ? starterNetPrice(specs.drive, specs.motorPh, specs.motorVolts, specs.motorHp)
            : null;
        if (net != null) specs.bodyPrice = net;
        return {
          ...l,
          specs,
          descriptionSnapshot: buildMotorControllerDescription(specs.bladeType, specs.drive),
          ...(net != null ? { unitPrice: round2(net * (1 + vatRate)) } : {}),
        };
      }),
    );
  }
  // Motor Controller "Recommend?": toggling the flag is enough — the effect below
  // keeps the phase / pole / HP / volts synced from the nearest fan line above.
  function applyMcRecommend(lineId: string, checked: boolean) {
    applyMotorController(lineId, { mcRecommend: checked });
  }
  // Editing the client height/width clears the run result — the user re-runs.
  function acInput(lineId: string, patch: Partial<LineSpecs>) {
    updateSpec(lineId, patch);
    setAcCollapsed((m) => ({ ...m, [lineId]: false }));
    setAcRan((m) => ({ ...m, [lineId]: false }));
  }

  // Add a fresh, blank line item (saved on "Save changes"; available while DRAFT).
  function addLine() {
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setLines((ls) => [
      ...ls,
      {
        id,
        descriptionSnapshot: "",
        qty: 1,
        unitPrice: 0,
        lineTotal: 0,
        selectionNote: null,
        specs: {
          itemLabel: "", capacity_cfm: null, staticPressure_pa: null, inches: null,
          motorHp: null, motorPh: null, motorVolts: null, motorPole: null,
          bodyPrice: null, power_w: null, blowerModel: null,
          category: "", brand: "", type: "", bladeType: "", drive: "", material: "Black Iron Sheet", shape: "", sizeL: "", sizeW: "",
          acHeight: null, acHeightUnit: "meter", acWidth: null, acWidthUnit: "mm",
        },
        rawSpecs: {},
      },
    ]);
  }
  function removeLine(id: string) {
    setLines((ls) => ls.filter((l) => l.id !== id));
    setSel((s) => {
      const { [id]: _drop, ...rest } = s;
      return rest;
    });
  }

  // Body + motor calculator: recompute the (VAT-inclusive) unit price and the
  // combined blower+motor model in the description whenever a motor input changes.
  function applyMotor(id: string, patch: Partial<LineSpecs>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const specs = { ...l.specs, ...patch };
        // 1-phase motors are 220V only — snap voltage so the model code resolves.
        if (specs.motorPh === 1) specs.motorVolts = 220;
        // Keep the model tag in step with the type/blade/drive. Crossing product
        // families clears the model (and its stale price) — re-select to re-price.
        const retagged = retagModel(specs.blowerModel, specs.type, specs.bladeType, specs.drive, specs.category);
        if (specs.blowerModel && retagged == null) specs.bodyPrice = null;
        specs.blowerModel = retagged;
        const body = bodyPriceOf(specs);
        const hp = specs.motorHp ?? 0;
        const phase = specs.motorPh ?? 0;
        const pole = specs.motorPole ?? 4;
        const isBlower = MATERIAL_CATEGORIES.has(specs.category);
        // Only auto-price true blower lines (those with a body price).
        if (body <= 0) {
          const desc = isBlower
            ? buildBlowerDescription(
                specs.type,
                specs.bladeType,
                specs.drive,
                specs.material,
                specs.blowerModel ? effectiveBlowerModel(specs.blowerModel, specs.drive) : null,
              )
            : rewriteProductNoun(
                rewriteMaterialLine(rewriteDriveLine(l.descriptionSnapshot, specs.drive), specs.material),
                specs.type,
                specs.bladeType,
              );
          return { ...l, specs, descriptionSnapshot: desc };
        }
        const motor = hp && phase ? lookupMotor(hp, phase, pole) : undefined;
        const net = computeUnitPrice(body, motor?.price ?? 0, hp, phase);
        const gross = round2(net * (1 + vatRate));
        const mModel = motor ? motorModelCode(motor, voltageKey(specs.motorVolts)) : null;
        const combined = combinedModel(effectiveBlowerModel(specs.blowerModel, specs.drive), mModel);
        const withModel = specs.blowerModel
          ? rewriteModelLine(l.descriptionSnapshot, combined)
          : l.descriptionSnapshot;
        const descriptionSnapshot = isBlower
          ? buildBlowerDescription(specs.type, specs.bladeType, specs.drive, specs.material, specs.blowerModel ? combined : null)
          : rewriteProductNoun(
              rewriteMaterialLine(
                rewritePaintLine(rewriteDriveLine(withModel, specs.drive), specs.material),
                specs.material,
              ),
              specs.type,
              specs.bladeType,
            );
        return { ...l, specs, unitPrice: gross, descriptionSnapshot };
      }),
    );
  }

  // Run the fan selector for a line. The volume flow / static pressure are stored
  // in the quotation-header units; convert them to CFM / in-w.g. (the catalog's
  // units) before querying.
  async function runLineSelection(line: Line) {
    const flow = line.specs.capacity_cfm;
    const spVal = line.specs.staticPressure_pa;
    // Propeller wall fans (EWF/EWFDD) may be selected on flow alone — static
    // pressure defaults to the recommended 0.5" w.g. below when it isn't given.
    // Fixed-speed units (ceiling cassette) may also be selected on flow alone,
    // defaulting to free-air (0 Pa) when static pressure isn't given.
    const panel = PROPELLER_FAN_TYPES.has(line.specs.type);
    const fixedUnit = isPrebuiltUnit(line.specs);
    if (!flow || (!spVal && !panel && !fixedUnit)) {
      setSel((s) => ({ ...s, [line.id]: { loading: false, error: panel || fixedUnit ? "Enter volume flow first." : "Enter volume flow and static pressure first.", results: null } }));
      return;
    }
    const aUnit = normalizeAirflowUnit(units.capacity);
    const pUnit = normalizePressureUnit(units.pressure);
    if (!aUnit || !pUnit) {
      setSel((s) => ({ ...s, [line.id]: { loading: false, error: `Unit "${aUnit ? units.pressure : units.capacity}" isn't supported for selection — use CFM/m³/hr and in-w.g./Pa.`, results: null } }));
      return;
    }
    const cfm = convertAirflow(flow, aUnit, "cfm");
    // Shutter Series selects on volume flow only — ignore any stored static
    // pressure (e.g. left over from a previous product on this line).
    let sp = spVal && !isFlowOnlyUnit(line.specs) ? convertPressure(spVal, pUnit, "inwg") : 0;
    if (panel && sp <= 0) sp = 0.5; // Recommended 0.5" w.g. when not given.
    setSel((s) => ({ ...s, [line.id]: { loading: true, error: null, results: null } }));
    try {
      const res = await fetch("/api/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirement: { airflow: cfm, airflowUnit: "cfm", staticPressure: sp, pressureUnit: "inwg" },
          // Query only this product's catalogue (CEB / CFAB / DIDWCEB) so the
          // lists never mix; CABSISW reuses the CEB models.
          tag: selectionTag(line.specs.type, line.specs.bladeType, line.specs.drive, line.specs.category),
          // Direct-drive lines constrain selection to standard 2-/4-pole speed bands.
          directDrive: /direct/i.test(line.specs.drive),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Selection failed");
      setSel((s) => ({ ...s, [line.id]: { loading: false, error: null, results: data.results ?? [] } }));
    } catch (e) {
      setSel((s) => ({ ...s, [line.id]: { loading: false, error: e instanceof Error ? e.message : "Selection failed", results: null } }));
    }
  }

  // Apply a chosen candidate to a line: fill description, size, body price,
  // base model and suggested motor HP, then recompute the price/model.
  function applyCandidate(lineId: string, r: SelectionResult) {
    const cat = catalog[r.modelId];
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== lineId) return l;
        // KDK pre-built units: the catalogue item is the whole unit — take its
        // price as base × VAT (no motor add-on) and build the KDK description
        // (Type / KDK Brand / Model: <chosen model>).
        if (isPrebuiltUnit(l.specs)) {
          const base = cat?.basePrice ?? 0;
          const model = cat?.modelCode ?? l.specs.blowerModel;
          const specs: LineSpecs = {
            ...l.specs,
            bodyPrice: base,
            blowerModel: model,
            // Rated consumption (W) from the catalogue; single-phase, 220 V fixed.
            power_w: r.power_kw ? Math.round(r.power_kw * 10000) / 10 : l.specs.power_w,
            motorHp: r.motorHp || null,
            motorPole: null,
            motorPh: 1,
            motorVolts: 220,
            inches: null, // KDK units aren't sized in inches
          };
          return {
            ...l,
            specs,
            // KDK catalogue prices are the VAT-exclusive (net) price, like every
            // other catalogue price; store gross so the exclusive display shows
            // exactly the catalogue price (no ÷1.12 deduction).
            unitPrice: round2(base * (1 + vatRate)),
            descriptionSnapshot: buildKdkDescription(specs.type, model, specs.bladeType),
          };
        }
        const chosenModel = cat?.modelCode ?? l.specs.blowerModel;
        const specs: LineSpecs = {
          ...l.specs,
          bodyPrice: cat?.basePrice ?? l.specs.bodyPrice,
          blowerModel: chosenModel,
          inches: cat?.bladeDia ?? l.specs.inches,
          motorHp: r.motorHp,
          // A forward-curve (CFAB) pick implies the Forward Curved blade type, so
          // the ÷0.9 body factor and CFAB description follow the selection.
          bladeType:
            chosenModel && /CFAB/i.test(chosenModel) ? "Forward Curved" : l.specs.bladeType,
          // Direct-drive selections also fix the motor pole (2- or 4-pole band).
          // The client's requested CFM is kept on the quote; the selection list
          // shows the higher delivered flow for reference.
          motorPole: r.motorPole ?? l.specs.motorPole,
        };
        // Cabinet SISW reuses the CEB catalogue model, so re-tag it to CABSISW.
        specs.blowerModel = retagModel(specs.blowerModel, specs.type, specs.bladeType, specs.drive, specs.category);
        const baseDesc = cat?.description || l.descriptionSnapshot;
        const body = bodyPriceOf(specs);
        const hp = specs.motorHp ?? 0;
        const phase = specs.motorPh ?? 0;
        const pole = specs.motorPole ?? 4;
        const motor = hp && phase ? lookupMotor(hp, phase, pole) : undefined;
        const net = computeUnitPrice(body, motor?.price ?? 0, hp, phase);
        const gross = round2(net * (1 + vatRate));
        const mModel = motor ? motorModelCode(motor, voltageKey(specs.motorVolts)) : null;
        const combined = combinedModel(effectiveBlowerModel(specs.blowerModel, specs.drive), mModel);
        const descriptionSnapshot = MATERIAL_CATEGORIES.has(specs.category)
          ? buildBlowerDescription(specs.type, specs.bladeType, specs.drive, specs.material, combined)
          : rewriteProductNoun(
              rewriteMaterialLine(
                rewritePaintLine(rewriteDriveLine(rewriteModelLine(baseDesc, combined), specs.drive), specs.material),
                specs.material,
              ),
              specs.type,
              specs.bladeType,
            );
        return { ...l, specs, unitPrice: gross, descriptionSnapshot };
      }),
    );
    // Collapse the candidate list once a blower is chosen.
    setSel((s) => ({ ...s, [lineId]: { loading: false, error: null, results: null } }));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await updateQuotationLines(
        quotation.id,
        lines.map((l) => ({
          id: l.id,
          descriptionSnapshot: l.descriptionSnapshot,
          qty: l.qty,
          unitPrice: l.unitPrice,
          selectionNote: l.selectionNote,
          // merge edited flat specs back over anything nested (selection/requirement)
          specsSnapshot: { ...l.rawSpecs, ...l.specs },
        })),
        { templateId, notes, terms, validUntil: validUntil || undefined, projectName, vatMode: effectiveVatMode, discountPct, headerUnits: units },
      );
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: string) {
    setBusy(true);
    setMsg(null);
    try {
      await transitionQuotation(quotation.id, to);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  // Product selection workflow, bound to one line item's specs.
  function renderProductSelection(l: Line) {
    const c = l.specs;
    const set = (patch: Partial<LineSpecs>) => updateSpec(l.id, patch);
    // Grouped categories (Ventilation Accessories → Air Terminals / Dampers /
    // Accessories) carry an extra dropdown before Type. The group is stored in
    // the otherwise-unused brand field; older lines (saved before grouping) fall
    // back to the group implied by their already-chosen type.
    const hasGroups = groupsFor(c.category).length > 0;
    const accGroup = hasGroups ? c.brand || groupForType(c.category, c.type) : "";
    // Ventilation Accessories add a Group + Unit dropdown and two size fields,
    // so the row needs up to 7 columns to stay on one line.
    const selCols = c.category === "Ventilation Accessories" ? "md:grid-cols-7" : "md:grid-cols-6";
    return (
      <div className="space-y-1">
        <Label>Product selection</Label>
        <div className={`grid grid-cols-2 gap-2 ${selCols}`}>
          <Select
            value={c.category}
            disabled={!editable}
            onChange={(e) => set({ category: e.target.value, brand: "", type: "", bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" })}
          >
            <option value="">Category…</option>
            {PRODUCT_CATEGORIES.map((x) => (<option key={x} value={x}>{x}</option>))}
          </Select>
          {/* Make/brand level (e.g. KDK) for categories that carry brands. */}
          {brandsFor(c.category).length > 0 && (
            <Select
              value={c.brand}
              disabled={!editable || !c.category}
              onChange={(e) => {
                const brand = e.target.value;
                const reset = { brand, type: "", blowerModel: null, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" };
                // KDK lines build their own description (Type / KDK Brand / Model).
                if (brand === "KDK") applyKdk(l.id, reset);
                else set(reset);
              }}
            >
              <option value="">Brand…</option>
              {brandsFor(c.category).map((b) => (<option key={b} value={b}>{b}</option>))}
            </Select>
          )}
          {/* Group level (e.g. Ventilation Accessories → Air Terminals / Dampers). */}
          {hasGroups && (
            <Select
              value={accGroup}
              disabled={!editable || !c.category}
              onChange={(e) => set({ brand: e.target.value, type: "", bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" })}
            >
              <option value="">Group…</option>
              {groupsFor(c.category).map((g) => (<option key={g} value={g}>{g}</option>))}
            </Select>
          )}
          <Select
            value={c.type}
            disabled={!editable || !c.category || (brandsFor(c.category).length > 0 && !c.brand) || (hasGroups && !accGroup)}
            onChange={(e) => {
              const type = e.target.value;
              // Blower/fan categories route through applyMotor so the description
              // rebuilds field-by-field (and the model re-tags). Wall fans have a
              // single blade (Propeller), so pre-select it. Accessories keep set().
              if (PROPELLER_FAN_TYPES.has(type)) {
                applyMotor(l.id, { type, bladeType: "Propeller", shape: "", sizeL: "", sizeW: "" });
              } else if (MATERIAL_CATEGORIES.has(c.category)) {
                applyMotor(l.id, { type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" });
              } else if (c.brand === "KDK") {
                // KDK pre-built unit: rebuild Type / KDK Brand / Model and clear
                // any previously-picked model (the type changed).
                applyKdk(l.id, { type, blowerModel: null, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" });
              } else if (type === "Motor Controller") {
                // Simple sub-typed item (Motor Starter / VFD) — no fan fields,
                // no airflow / static pressure / size / watt rating.
                applyMotorController(l.id, {
                  type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "", blowerModel: null,
                  capacity_cfm: null, staticPressure_pa: null, inches: null, power_w: null,
                });
              } else if (type === "Spring Vibration Isolator") {
                // Seed the description with the type; mounting/capacity add to it.
                applyIsolator(l.id, { type, shape: "", sizeL: "", sizeW: "" });
              } else if (c.category === "Ventilation Accessories") {
                // Air Terminals / Dampers: reset shape/size/material/finish and
                // clear any stale auto-price (recomputes once dimensions are set).
                applyAccessory(
                  l.id,
                  { type, shape: "", sizeL: "", sizeW: "", sizeUnit: "", material: "", powderCoated: false },
                  true,
                );
              } else {
                set({ type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" });
              }
            }}
          >
            <option value="">Type…</option>
            {typesFor(
              c.category,
              brandsFor(c.category).length > 0 ? c.brand : undefined,
              hasGroups ? accGroup || undefined : undefined,
            ).map((t) => (<option key={t} value={t}>{t}</option>))}
          </Select>
          {seriesFor(c.category, c.type).length > 0 && (
            // Sub-type level — KDK series (Wall Mounted Fan → Shutter / High
            // Pressure) or Aerovent Motor Controller (Motor Starter / VFD).
            // Stored in the otherwise-unused bladeType field.
            <Select
              value={c.bladeType}
              disabled={!editable || !c.type || (isMotorController(c) && !!c.mcRecommend)}
              onChange={(e) =>
                isMotorController(c)
                  ? applyMotorController(l.id, {
                      bladeType: e.target.value, drive: "",
                      // VFD is always 3-phase; starters start unset.
                      motorPh: e.target.value === "Variable Frequency Drive" ? 3 : null,
                      motorHp: null, motorVolts: null,
                    })
                  : applyKdk(l.id, {
                      bladeType: e.target.value, blowerModel: null,
                      // Shutter Series is flow-only — drop any stale static pressure.
                      ...(e.target.value === "Shutter Series" ? { staticPressure_pa: null } : {}),
                    })
              }
            >
              <option value="">{isMotorController(c) ? "Type…" : "Series…"}</option>
              {seriesFor(c.category, c.type).map((s) => (<option key={s} value={s}>{s}</option>))}
            </Select>
          )}
          {isMotorController(c) && c.bladeType === "Motor Starter" && (
            // Motor-starter wiring: DOL / Y-Δ / Y-YY (stored in the unused drive field).
            // Auto-selected (and locked) when Recommend? is on.
            <Select
              value={c.drive}
              disabled={!editable || !!c.mcRecommend}
              onChange={(e) => {
                const starter = e.target.value;
                const patch: Partial<LineSpecs> = { drive: starter };
                // Y-Δ / Y-YY are 3-phase only — drop a stale single-phase choice.
                if ((starter === "Y/Δ" || starter === "Y/YY") && c.motorPh === 1) patch.motorPh = null;
                // Drop a voltage or HP the new starter type doesn't offer.
                if (c.motorVolts != null && !starterVolts(starter).includes(c.motorVolts)) patch.motorVolts = null;
                if (c.motorHp != null && !starterHpOptions(starter).includes(c.motorHp)) patch.motorHp = null;
                applyMotorController(l.id, patch);
              }}
            >
              <option value="">Starter type…</option>
              {MOTOR_STARTER_TYPES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </Select>
          )}
          {isMotorController(c) && (c.bladeType === "Motor Starter" || c.bladeType === "Variable Frequency Drive") && (
            // Pull phase / pole / motor HP / volts from the nearest fan line above.
            <label className="flex h-9 items-center gap-1.5 text-sm">
              <input type="checkbox" className="h-4 w-4" disabled={!editable}
                checked={!!c.mcRecommend}
                onChange={(e) => applyMcRecommend(l.id, e.target.checked)} />
              Recommend?
            </label>
          )}
          {c.category === "Ventilation Accessories" ? (
            <>
              <Select
                // Legacy lines stored "Square" before it became "Square/Rectangle".
                value={c.shape === "Square" ? "Square/Rectangle" : c.shape}
                disabled={!editable || !c.type || (isIsolator(c) && !!c.mcRecommend)}
                onChange={(e) => (isIsolator(c) ? applyIsolator(l.id, { shape: e.target.value }) : applyAccessory(l.id, { shape: e.target.value }))}
              >
                <option value="">{variantLabel(c.type)}…</option>
                {shapesFor(c.type).map((s) => (<option key={s} value={s}>{s}</option>))}
              </Select>
              {/* Unit of measurement for the dimensions (selected accessories). */}
              {UOM_TYPES.has(c.type) && (
                <Select
                  value={c.sizeUnit || ""}
                  disabled={!editable || !c.type}
                  onChange={(e) => {
                    const to = e.target.value;
                    const from = c.sizeUnit || "mm";
                    // Convert the entered dimensions to the new unit (trade ratio).
                    applyAccessory(l.id, {
                      sizeUnit: to,
                      sizeL: convertAccSize(c.sizeL, from, to),
                      sizeW: convertAccSize(c.sizeW, from, to),
                    });
                  }}
                >
                  <option value="" disabled>Unit of Measurement…</option>
                  {SIZE_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
                </Select>
              )}
              {sizeMode(c.type, c.shape) === "capacity" ? (
                <Select className="h-9" disabled={!editable || !c.type || !!c.mcRecommend} value={c.sizeL}
                  onChange={(e) => applyIsolator(l.id, { sizeL: e.target.value, sizeW: "" })}>
                  <option value="">Capacity (kg)…</option>
                  {ISO_CAPS.map((cap) => (
                    <option key={cap} value={cap}>{cap} kg</option>
                  ))}
                </Select>
              ) : sizeMode(c.type, c.shape) === "diameter" ? (
                <Input className="h-9" type="number" step="any" placeholder={`Diameter Ø (${UOM_TYPES.has(c.type) ? c.sizeUnit || "mm" : "mm"})`}
                  disabled={!editable || !c.type} value={c.sizeL}
                  onChange={(e) => applyAccessory(l.id, { sizeL: e.target.value, sizeW: "" })} />
              ) : (
                <>
                  <Input className="h-9" type="number" step="any" placeholder={`L (${UOM_TYPES.has(c.type) ? c.sizeUnit || "mm" : "mm"})`}
                    disabled={!editable || !c.type} value={c.sizeL}
                    onChange={(e) => applyAccessory(l.id, { sizeL: e.target.value })} />
                  <Input className="h-9" type="number" step="any" placeholder={`W (${UOM_TYPES.has(c.type) ? c.sizeUnit || "mm" : "mm"})`}
                    disabled={!editable || !c.type} value={c.sizeW}
                    onChange={(e) => applyAccessory(l.id, { sizeW: e.target.value })} />
                </>
              )}
              {/* Recommend the spring capacity from the motor above (HP → weight). */}
              {isIsolator(c) && (
                <label className="flex h-9 items-center gap-1.5 text-sm">
                  <input type="checkbox" className="h-4 w-4" disabled={!editable}
                    checked={!!c.mcRecommend}
                    onChange={(e) => updateSpec(l.id, { mcRecommend: e.target.checked })} />
                  Recommend?
                </label>
              )}
              {/* Material (Air Terminals / Dampers). */}
              {!isIsolator(c) && (
                <Select
                  value={ACC_MATERIALS.includes(c.material) ? c.material : ""}
                  disabled={!editable || !c.type}
                  onChange={(e) => applyAccessory(l.id, { material: e.target.value })}
                >
                  <option value="" disabled>Material…</option>
                  {ACC_MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
                </Select>
              )}
              {/* Powder-coat finish — supported types only; not for stainless steel. */}
              {POWDER_COAT_TYPES.has(c.type) && c.material !== "Stainless Steel 304" && (
                <label className="flex h-9 items-center gap-1.5 text-sm">
                  Powder Coated
                  <input type="checkbox" className="h-4 w-4" disabled={!editable}
                    checked={!!c.powderCoated}
                    onChange={(e) => applyAccessory(l.id, { powderCoated: e.target.checked })} />
                </label>
              )}
            </>
          ) : isPrebuiltUnit(c) || isMotorController(c) ? (
            // KDK pre-built units and Motor Controllers have no blade type /
            // drive and aren't material-configurable.
            null
          ) : (
            <>
              <Select
                value={c.bladeType}
                disabled={!editable || !c.type}
                onChange={(e) => {
                  const bladeType = e.target.value;
                  // Forward curve is belt-only: drop an incompatible Direct drive.
                  const patch: Partial<LineSpecs> = { bladeType };
                  if (!drivesFor(c.category, c.type, bladeType).includes(c.drive)) patch.drive = "";
                  applyMotor(l.id, patch);
                }}
              >
                <option value="">Blade type…</option>
                {(entryFor(c.category, c.type)?.bladeTypes ?? []).map((b) => (<option key={b} value={b}>{b}</option>))}
              </Select>
              <Select
                value={c.drive}
                disabled={!editable || !c.type}
                onChange={(e) => applyMotor(l.id, { drive: e.target.value })}
              >
                <option value="">Drive…</option>
                {drivesFor(c.category, c.type, c.bladeType).map((d) => (<option key={d} value={d}>{d}</option>))}
              </Select>
            </>
          )}
          {/* Material applies to blowers — not pre-built units, Motor Controllers,
              or Ventilation Accessories. */}
          {!isPrebuiltUnit(c) && !isMotorController(c) && c.category !== "Ventilation Accessories" && (
            <Select
              value={c.material || "Black Iron Sheet"}
              disabled={!editable}
              onChange={(e) => applyMotor(l.id, { material: e.target.value })}
            >
              {MATERIAL_OPTIONS.map((m) => (<option key={m} value={m}>{m}</option>))}
            </Select>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {c.category === "Ventilation Accessories"
            ? "Category · Type · Shape/Mounting · Size — Round = diameter, Square/Rectangle = L × W (mm), isolator = capacity (kg)."
            : isMotorController(c)
              ? "Category · Brand · Type · Motor Starter / Variable Frequency Drive — enter the description and price."
              : isPrebuiltUnit(c)
                ? "Category · Brand · Type — run the selection to pick a model by duty."
                : "Product Category · Type · Blade Type · Drive (more details to follow)."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {isAdmin && editingNo ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-bold">QUOT NO.</span>
              <Input className="h-9 w-72 font-mono" value={noDraft} onChange={(e) => setNoDraft(e.target.value)} />
              <Button size="sm" onClick={saveQuoteNo} disabled={noBusy || !noDraft.trim()}>{noBusy ? "Saving…" : "Save"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditingNo(false); setNoDraft(quoteNo); setNoErr(null); }} disabled={noBusy}>Cancel</Button>
              {noErr && <span className="text-xs text-destructive">{noErr}</span>}
            </div>
          ) : (
            <h1 className="text-2xl font-bold">
              QUOT NO. {quoteNo}
              {isAdmin && (
                <button type="button" onClick={() => { setNoDraft(quoteNo); setEditingNo(true); }}
                  className="ml-2 align-middle text-xs font-normal text-primary underline">edit</button>
              )}
            </h1>
          )}
          <p className="text-sm text-muted-foreground">
            {quotation.customer} · prepared by {quotation.preparedBy}
            {quotation.approvedBy ? ` · approved by ${quotation.approvedBy}` : ""}
          </p>
        </div>
        <QuotationStatusBadge status={quotation.status} />
      </div>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      {/* Header fields */}
      <Card>
        <CardHeader><CardTitle>Quotation header</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1 md:col-span-3">
            <Label>Project</Label>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} disabled={!editable} placeholder="e.g. DG Engineering & Construction Services" />
          </div>
          <div className="space-y-1 md:col-span-3">
            <Label>Table unit labels (red, editable per client)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Select value={units.capacity} disabled={!editable}
                onChange={(e) => setUnits({ ...units, capacity: e.target.value })}>
                <option value="" disabled hidden>Volume Flow</option>
                {(units.capacity && !CAPACITY_UNITS.includes(units.capacity) ? [units.capacity, ...CAPACITY_UNITS] : CAPACITY_UNITS).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
              <Select value={units.pressure} disabled={!editable}
                onChange={(e) => setUnits({ ...units, pressure: e.target.value })}>
                <option value="" disabled hidden>Static Pressure</option>
                {(units.pressure && !PRESSURE_UNITS.includes(units.pressure) ? [units.pressure, ...PRESSURE_UNITS] : PRESSURE_UNITS).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
              <Select value={units.motor} disabled={!editable}
                onChange={(e) => setUnits({ ...units, motor: e.target.value })}>
                <option value="" disabled hidden>Motor Power</option>
                {(units.motor && !POWER_UNITS.includes(units.motor) ? [units.motor, ...POWER_UNITS] : POWER_UNITS).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            </div>
          </div>
          {/* Discount (left) and VAT presentation (right), inline */}
          <div className="grid gap-4 md:col-span-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Discount %</Label>
              <Input type="number" step="0.01" min={0} max={100} value={discountPct} disabled={!editable}
                onChange={(e) => setDiscountPct(Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>VAT presentation</Label>
              <Select value={effectiveVatMode} onChange={(e) => setVatMode(e.target.value as never)} disabled={!editable}>
                <option value="INCLUSIVE">VAT inclusive</option>
                <option value="EXCLUSIVE">VAT exclusive (÷1.12)</option>
                <option value="EXCLUSIVE_PLUS">VAT exclusive (+12%)</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Template (pattern)</Label>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!editable}>
              {/* Keep a retired template visible on an existing quote that still uses it. */}
              {!templates.some((t) => t.id === templateId) && (
                <option value={templateId}>{quotation.templateName}</option>
              )}
              {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Valid until</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={!editable} />
          </div>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, idx) => (
            <div
              key={l.id}
              className={`relative rounded-lg border p-3 ${
                idx % 2 === 0
                  ? "bg-sky-50 dark:bg-sky-950/20"
                  : "bg-amber-50 dark:bg-amber-950/20"
              }`}
            >
              {editable && (
                <Button size="sm" variant="ghost"
                  className="absolute right-2 top-2 z-10 text-destructive hover:text-destructive"
                  onClick={() => removeLine(l.id)}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              )}
              {renderProductSelection(l)}
              <div className="my-3 border-t" />
              <div className="mb-1 text-xs font-medium text-muted-foreground">Item {idx + 1}</div>
              <div className="grid gap-2 md:grid-cols-12">
                <div className="md:col-span-1">
                  <Label className="text-[10px]">Item</Label>
                  <Input className="h-8" value={l.specs.itemLabel} placeholder={String(idx + 1)} disabled={!editable}
                    onChange={(e) => updateSpec(l.id, { itemLabel: e.target.value })} />
                </div>
                <div className="md:col-span-1">
                  <Label className="text-[10px]">Qty</Label>
                  {/* Isolator recommend sets Qty = number of springs (locked). */}
                  <Input className="h-8 text-right" type="number" min={1} value={l.qty}
                    disabled={!editable || (isIsolator(l.specs) && !!l.specs.mcRecommend)}
                    onChange={(e) => updateLine(l.id, { qty: Math.max(1, Number(e.target.value) || 1) })} />
                </div>
                <div className="md:col-span-9">
                  <Label className="text-[10px]">Description (one detail per line)</Label>
                  {editable ? (
                    <Textarea rows={3} value={l.descriptionSnapshot}
                      onChange={(e) => updateLine(l.id, { descriptionSnapshot: e.target.value })} />
                  ) : (
                    <div className="whitespace-pre-wrap text-sm">{l.descriptionSnapshot}</div>
                  )}
                </div>
                <div className="md:col-span-1">
                  <Label className="text-[10px]">Unit ₱ (incl. VAT)</Label>
                  <Input className="h-8 text-right" type="number" step="0.01" value={l.unitPrice} disabled={!editable}
                    onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })} />
                </div>
              </div>

              {/* Air curtain: the sales team enters the client's opening (installation
                  height + door width, each with its own unit) and the program
                  recommends a unit that covers it. Other products use the
                  Capacity / S.P. / Size columns instead. */}
              {isAirCurtain(l.specs) ? (
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-9">
                  <div className="md:col-span-2">
                    <Label className="text-[10px]">Installation height (client)</Label>
                    <Input className="h-8 text-right" type="number" step="any" disabled={!editable}
                      value={l.specs.acHeight ?? ""}
                      onChange={(e) => acInput(l.id, { acHeight: numOrNull(e.target.value) })} />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px]">Unit</Label>
                    <Select className="h-8" value={l.specs.acHeightUnit ?? "meter"} disabled={!editable}
                      onChange={(e) => acInput(l.id, { acHeightUnit: e.target.value })}>
                      {LENGTH_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px]">Door width (client)</Label>
                    <Input className="h-8 text-right" type="number" step="any" disabled={!editable}
                      value={l.specs.acWidth ?? ""}
                      onChange={(e) => acInput(l.id, { acWidth: numOrNull(e.target.value) })} />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px]">Unit</Label>
                    <Select className="h-8" value={l.specs.acWidthUnit ?? "mm"} disabled={!editable}
                      onChange={(e) => acInput(l.id, { acWidthUnit: e.target.value })}>
                      {LENGTH_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
                    </Select>
                  </div>
                </div>
              ) : isMotorController(l.specs) || isIsolator(l.specs) || isAccessory(l.specs) ? null : (
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-9">
                  <div className="md:col-span-2">
                    <Label className="text-[10px]">Volume flow</Label>
                    <Input className="h-8 text-right" type="number" step="any" disabled={!editable}
                      value={l.specs.capacity_cfm ?? ""}
                      onChange={(e) => updateSpec(l.id, { capacity_cfm: numOrNull(e.target.value) })} />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px]">Unit</Label>
                    <Select className="h-8" value={units.capacity} disabled={!editable}
                      onChange={(e) => setUnits({ ...units, capacity: e.target.value })}>
                      {(units.capacity && !CAPACITY_UNITS.includes(units.capacity) ? [units.capacity, ...CAPACITY_UNITS] : CAPACITY_UNITS).map((u) => (
                        <option key={u} value={u}>{u}</option>))}
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px]">Static pressure{isFlowOnlyUnit(l.specs) ? " (N/A)" : ""}</Label>
                    <Input className="h-8 text-right" type="number" step="any"
                      disabled={!editable || isFlowOnlyUnit(l.specs)}
                      value={isFlowOnlyUnit(l.specs) ? "" : (l.specs.staticPressure_pa ?? "")}
                      onChange={(e) => updateSpec(l.id, { staticPressure_pa: numOrNull(e.target.value) })} />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px]">Unit</Label>
                    <Select className="h-8" value={units.pressure}
                      disabled={!editable || isFlowOnlyUnit(l.specs)}
                      onChange={(e) => setUnits({ ...units, pressure: e.target.value })}>
                      {(units.pressure && !PRESSURE_UNITS.includes(units.pressure) ? [units.pressure, ...PRESSURE_UNITS] : PRESSURE_UNITS).map((u) => (
                        <option key={u} value={u}>{u}</option>))}
                    </Select>
                  </div>
                  {/* KDK units aren't sized in inches — hide the Size field. */}
                  {!isPrebuiltUnit(l.specs) && (
                    <div className="md:col-span-1">
                      <Label className="text-[10px]">Size (in)</Label>
                      <Input className="h-8 text-right" type="number" step="any" disabled={!editable}
                        value={l.specs.inches ?? ""}
                        onChange={(e) => updateSpec(l.id, { inches: numOrNull(e.target.value) })} />
                    </div>
                  )}
                </div>
              )}

              {/* Air-curtain recommendation list (replaces the duty fan selector).
                  Collapses to a one-line summary once a unit is picked. */}
              {editable && isAirCurtain(l.specs) && acCollapsed[l.id] && l.specs.blowerModel ? (
                <div className="mt-2 flex items-center justify-between rounded-md border border-dashed p-2">
                  <span className="text-xs font-medium">Selected: {l.specs.blowerModel} · {formatCurrency(round2(l.unitPrice), quotation.currency)}</span>
                  <Button size="sm" variant="outline"
                    onClick={() => { setAcCollapsed((m) => ({ ...m, [l.id]: false })); setAcRan((m) => ({ ...m, [l.id]: true })); }}>
                    <Gauge className="h-3.5 w-3.5" /> Run selection
                  </Button>
                </div>
              ) : editable && isAirCurtain(l.specs) ? (
                <div className="mt-2 rounded-md border border-dashed p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Recommended units — effective height ≥ installation height and unit width ≥ door width
                    </span>
                    <Button size="sm" variant="outline"
                      onClick={() => setAcRan((m) => ({ ...m, [l.id]: true }))}>
                      <Gauge className="h-3.5 w-3.5" /> Run selection
                    </Button>
                  </div>
                  {acRan[l.id] && (() => {
                    if (l.specs.acHeight == null || l.specs.acWidth == null)
                      return <p className="mt-1 text-xs text-muted-foreground">Enter the client&apos;s installation height and door width.</p>;
                    const picks = airCurtainPicks(l.specs);
                    if (picks.length === 0)
                      return <p className="mt-1 text-xs text-destructive">No air curtain covers this opening — check the height/width or units.</p>;
                    return (
                      <div className="mt-2 space-y-1">
                        {picks.map((c, i) => {
                          const isRec = i === 0;
                          return (
                            <button key={c.modelCode} type="button"
                              onClick={() => applyAirCurtainModel(l.id, c)}
                              className={`w-full rounded-md border p-2 text-left text-xs hover:bg-accent ${isRec ? "border-primary ring-1 ring-primary" : ""}`}>
                              <div className="flex items-center justify-between">
                                <span className="font-medium">
                                  {c.modelCode}
                                  {isRec && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">RECOMMENDED</span>}
                                </span>
                                <span className="font-medium">{formatCurrency(round2(c.basePrice), quotation.currency)}</span>
                              </div>
                              <p className="text-muted-foreground">
                                Effective height {c.heightM} m · Unit width {c.lengthMm} mm
                                {c.airVolumeCmh != null
                                  ? ` · ${fmtFlow(convertAirflow(c.airVolumeCmh, "m3hr", normalizeAirflowUnit(units.capacity) ?? "m3hr"))} ${units.capacity}`
                                  : ""}
                                {c.powerW != null ? ` · ${c.powerW} W` : ""}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              {/* Per-line fan selector — click a candidate to populate this item.
                  Air curtains and Motor Controllers aren't duty-selected. */}
              {editable && !isAirCurtain(l.specs) && !isMotorController(l.specs) && !isIsolator(l.specs) && !isAccessory(l.specs) && (
                <div className="mt-2 rounded-md border border-dashed p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Fan selector — uses {isFlowOnlyUnit(l.specs) ? "Capacity (volume flow only)" : "Capacity + S.P."} above
                    </span>
                    <Button size="sm" variant="outline" onClick={() => runLineSelection(l)} disabled={sel[l.id]?.loading}>
                      <Gauge className="h-3.5 w-3.5" /> {sel[l.id]?.loading ? "Selecting…" : "Run selection"}
                    </Button>
                  </div>
                  {sel[l.id]?.error && <p className="mt-1 text-xs text-destructive">{sel[l.id]?.error}</p>}
                  {sel[l.id]?.results?.length === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">No matching fans for this duty.</p>
                  )}
                  {(() => {
                    const results = sel[l.id]?.results ?? null;
                    // Fixed-speed units (ceiling cassette): list EVERY unit whose
                    // curve covers the duty (sorted by size) so the salesperson can
                    // pick any — not just the recommended ± a size window.
                    const w = results
                      ? isPrebuiltUnit(l.specs)
                        ? {
                            rec: results.find((r) => r.confidence === "HIGH") ?? results[0],
                            list: [...results].sort((a, b) => selSize(a) - selSize(b)),
                          }
                        : sizeWindow(results)
                      : null;
                    if (!w) return null;
                    return (
                      <div className="mt-2 space-y-1">
                        {w.list.map((r) => {
                          const cat = catalog[r.modelId];
                          const motor = lookupMotor(r.motorHp, 3, r.motorPole ?? 4);
                          const estBody = (cat?.basePrice ?? 0) * bladeFactor(l.specs) * materialFactor(l.specs);
                          // KDK catalogue prices are VAT-exclusive (net); store gross (no motor add-on).
                          const est = isPrebuiltUnit(l.specs)
                            ? round2((cat?.basePrice ?? 0) * (1 + vatRate))
                            : estBody > 0
                              ? round2(computeUnitPrice(estBody, motor?.price ?? 0, r.motorHp, 3) * (1 + vatRate))
                              : 0;
                          const isRec = r.modelId === w.rec.modelId;
                          return (
                            <button
                              key={r.modelId}
                              type="button"
                              onClick={() => applyCandidate(l.id, r)}
                              className={`w-full rounded-md border p-2 text-left text-xs hover:bg-accent ${isRec ? "border-primary ring-1 ring-primary" : ""}`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium">
                                  {r.modelCode}
                                  {isRec && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">RECOMMENDED</span>}
                                </span>
                                <span className="flex items-center gap-2">
                                  {est > 0 && <span className="font-medium">≈ {formatCurrency(est, quotation.currency)}</span>}
                                  <ConfidenceBadge confidence={r.confidence} />
                                </span>
                              </div>
                              {isPrebuiltUnit(l.specs) ? (
                                // KDK fixed-speed units are rated in watts and m³/hr,
                                // not HP / CFM. rpm / W are omitted when unknown.
                                <p className="text-muted-foreground">
                                  {r.rpm > 0 ? `${r.rpm} rpm · ` : ""}
                                  {r.power_kw > 0 ? `${Math.round(r.power_kw * 10000) / 10} W · ` : ""}
                                  delivers {Math.round(r.selectedAirflow_m3hr ?? r.dutyAirflow_m3hr)} m³/hr
                                </p>
                              ) : (
                                <p className="text-muted-foreground">
                                  {r.rpm} rpm · {r.bhp} BHP → {r.motorHp} HP{r.motorPole ? ` ${r.motorPole}-pole` : ""}
                                  {r.bladeAngle != null ? ` · ${r.bladeAngle}° blade` : ""}
                                  {` · delivers ${Math.round((r.selectedAirflow_m3hr ?? r.dutyAirflow_m3hr) / 1.6990108)} cfm`}
                                  {r.outletVelocity_fpm != null
                                    ? ` · OV ${r.outletVelocity_fpm}${r.ovLimit_fpm != null ? `/${r.ovLimit_fpm}` : ""} fpm`
                                    : ""}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Motor + price calculator */}
              {isMotorController(l.specs) ? (
                // Motor Controller: phase → motor HP → voltage; for a DOL starter
                // the unit price auto-fills from the DOL price table.
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {/* VFD is 3-phase (recommend may surface a single-phase source). */}
                  {l.specs.bladeType === "Variable Frequency Drive" ? (
                    <div>
                      <Label className="text-[10px]">Phase</Label>
                      <Select className="h-8" disabled value={l.specs.motorPh === 1 ? "1" : "3"}>
                        <option value="1">1-phase</option>
                        <option value="3">3-phase</option>
                      </Select>
                    </div>
                  ) : (
                    <div>
                      <Label className="text-[10px]">Phase</Label>
                      <Select className="h-8" disabled={!editable || !!l.specs.mcRecommend} value={l.specs.motorPh ?? ""}
                        onChange={(e) => applyMotorController(l.id, { motorPh: numOrNull(e.target.value) })}>
                        <option value="">—</option>
                        {/* Y-Δ / Y-YY are 3-phase only — single phase isn't listed. */}
                        {l.specs.drive !== "Y/Δ" && l.specs.drive !== "Y/YY" && <option value="1">1-phase</option>}
                        <option value="3">3-phase</option>
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label className="text-[10px]">Motor HP</Label>
                    <Select className="h-8" disabled={!editable || !!l.specs.mcRecommend} value={l.specs.motorHp ?? ""}
                      onChange={(e) => applyMotorController(l.id, { motorHp: numOrNull(e.target.value) })}>
                      <option value="">—</option>
                      {withVal(l.specs.bladeType === "Variable Frequency Drive" ? VFD_HP_OPTIONS : starterHpOptions(l.specs.drive), l.specs.motorHp).map((hp) => (
                        <option key={hp} value={hp}>{hp} HP</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">Voltage</Label>
                    <Select className="h-8" disabled={!editable || !!l.specs.mcRecommend} value={l.specs.motorVolts ?? ""}
                      onChange={(e) => applyMotorController(l.id, { motorVolts: numOrNull(e.target.value) })}>
                      {l.specs.motorPh === 1 && l.specs.bladeType !== "Variable Frequency Drive" ? (
                        <option value="220">220V</option>
                      ) : (
                        <>
                          <option value="">—</option>
                          {/* VFD: 220/380/440 (440-only at 125/150 HP); starters per type. */}
                          {withVal(
                            l.specs.bladeType === "Variable Frequency Drive"
                              ? vfdVolts(l.specs.motorHp)
                              : starterVolts(l.specs.drive),
                            l.specs.motorVolts,
                          ).map((v) => (
                            <option key={v} value={v}>{v}V</option>
                          ))}
                        </>
                      )}
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">Unit ₱ (incl. VAT)</Label>
                    <Input className="h-8 text-right" type="number" step="0.01" value={l.unitPrice} disabled={!editable}
                      onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })} />
                  </div>
                  {/* VFD has no single-phase output — flag a recommended single-phase source. */}
                  {l.specs.bladeType === "Variable Frequency Drive" && l.specs.mcRecommend && l.specs.motorPh === 1 && (
                    <p className="col-span-2 text-xs font-medium text-destructive md:col-span-4">No Single Phase Output Available</p>
                  )}
                </div>
              ) : isIsolator(l.specs) ? null : isPrebuiltUnit(l.specs) ? (
                // KDK pre-built units: single-phase and 220 V (both fixed), the
                // motor rating from the catalogue, and the unit price.
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div>
                    <Label className="text-[10px]">Phase</Label>
                    <Select className="h-8" disabled value="1"><option value="1">1-phase</option></Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">{normalizePowerUnit(units.motor) ?? "HP"}</Label>
                    <Input className="h-8" disabled
                      value={(() => {
                        if (l.specs.power_w == null) return "—";
                        const u = normalizePowerUnit(units.motor) ?? "HP";
                        return `${roundPower(convertPower(l.specs.power_w, "W", u), u)} ${u}`;
                      })()} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Volts</Label>
                    <Select className="h-8" disabled value="220"><option value="220">220</option></Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">Unit ₱ (incl. VAT)</Label>
                    <Input className="h-8 text-right" type="number" step="0.01" value={l.unitPrice} disabled={!editable}
                      onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              ) : isAccessory(l.specs) ? (
                // Air Terminals / Dampers: per-square-inch body price + manual override.
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="flex items-end md:col-span-3">
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        const rate = accessoryRate(l.specs.type, l.specs.shape);
                        const area = accBilledAreaSqIn(l.specs);
                        const mat = ACC_MATERIAL_FACTOR[l.specs.material];
                        if (rate == null) return "Enter the unit price manually — this type isn't auto-priced yet.";
                        if (area == null || mat == null) return "Pick shape, dimensions and material to auto-price.";
                        const minNote = area <= ACC_MIN_SQIN ? " (100 sq in min)" : "";
                        const flat = accFlatAdd(l.specs.type);
                        return `${round2(area)} sq in${minNote} × ${rate} × ${mat} (${l.specs.material})${l.specs.powderCoated ? ` × ${accPowderFactor(l.specs.type)} powder-coat` : ""}${flat ? ` + ${flat} fusible link` : ""} = auto-priced (editable).`;
                      })()}
                    </p>
                  </div>
                  <div>
                    <Label className="text-[10px]">Unit ₱ (incl. VAT)</Label>
                    <Input className="h-8 text-right" type="number" step="0.01" value={l.unitPrice} disabled={!editable}
                      onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              ) : (
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-6">
                <div>
                  <Label className="text-[10px]">Body ₱ (net)</Label>
                  <Input className="h-8 text-right" type="number" step="0.01" disabled={!editable}
                    value={l.specs.bodyPrice ?? ""}
                    onChange={(e) => applyMotor(l.id, { bodyPrice: numOrNull(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-[10px]">Phase</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorPh ?? ""}
                    onChange={(e) => applyMotor(l.id, { motorPh: numOrNull(e.target.value) })}>
                    <option value="">—</option>
                    <option value="1">1-phase</option>
                    <option value="3">3-phase</option>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Pole</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorPole ?? 4}
                    onChange={(e) => applyMotor(l.id, { motorPole: numOrNull(e.target.value) })}>
                    <option value="4">4-pole</option>
                    <option value="2">2-pole</option>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Motor HP</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorHp ?? ""}
                    onChange={(e) => applyMotor(l.id, { motorHp: numOrNull(e.target.value) })}>
                    <option value="">—</option>
                    {hpOptions(l.specs.motorPh ?? 3, l.specs.motorPole ?? 4).map((hp) => (
                      <option key={hp} value={hp}>{hp} HP</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Volts</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorVolts ?? ""}
                    onChange={(e) => applyMotor(l.id, { motorVolts: numOrNull(e.target.value) })}>
                    {l.specs.motorPh === 1 ? (
                      <option value="220">220</option>
                    ) : (
                      <>
                        <option value="">—</option>
                        <option value="220">220</option>
                        <option value="380">380</option>
                        <option value="400">400</option>
                        <option value="440">440</option>
                      </>
                    )}
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Unit ₱ (incl. VAT)</Label>
                  <Input className="h-8 text-right" type="number" step="0.01" value={l.unitPrice} disabled={!editable}
                    onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })} />
                </div>
              </div>
              )}

              {/* Calculator readout (blower motor pricing — not for KDK / Motor Controller) */}
              {!isPrebuiltUnit(l.specs) && !isMotorController(l.specs) && !isIsolator(l.specs) && !isAccessory(l.specs) && (() => {
                const hp = l.specs.motorHp ?? 0;
                const ph = l.specs.motorPh ?? 0;
                const pole = l.specs.motorPole ?? 4;
                const motor = hp && ph ? lookupMotor(hp, ph, pole) : undefined;
                const mModel = motor ? motorModelCode(motor, voltageKey(l.specs.motorVolts)) : null;
                const db = dynamicBalancingApplies(hp, ph);
                const isBlower = !!(l.specs.bodyPrice && l.specs.bodyPrice > 0);
                return (
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {isBlower &&
                      (hp && ph ? (
                        motor ? (
                          <>
                            <span>Motor {mModel ?? "—"}: {formatCurrency(motor.price, quotation.currency)}</span>
                            {db && <span className="text-amber-600">+10% dynamic balancing (3-ph &gt; 10 HP)</span>}
                            {l.specs.blowerModel && <span>Model: <b>{combinedModel(effectiveBlowerModel(l.specs.blowerModel, l.specs.drive), mModel)}</b></span>}
                          </>
                        ) : (
                          <span className="text-destructive">No motor priced for {hp} HP / {ph}-ph / {pole}-pole</span>
                        )
                      ) : (
                        <span>Body only — pick HP &amp; phase to add a motor</span>
                      ))}
                    <span className="ml-auto text-foreground">
                      Amount: <b>{formatCurrency(l.qty * l.unitPrice, quotation.currency)}</b>
                    </span>
                  </div>
                );
              })()}
            </div>
          ))}

          {editable && (
            <Button variant="outline" onClick={addLine}>
              <Plus className="h-4 w-4" /> Add item
            </Button>
          )}

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-80 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>NET AMOUNT (VAT {totals.exclusive ? "exclusive" : "inclusive"})</span>
                <span>{formatCurrency(totals.displayedNet, quotation.currency)}</span>
              </div>
              {discountPct > 0 && (
                <>
                  <div className="flex justify-between"><span>LESS {discountPct}% DISCOUNT</span><span>{formatCurrency(totals.discountAmt, quotation.currency)}</span></div>
                  <div className="flex justify-between"><span>NET AMOUNT</span><span>{formatCurrency(totals.finalNet, quotation.currency)}</span></div>
                </>
              )}
              {totals.addVat && (
                <>
                  <div className="flex justify-between"><span>ADD 12% VAT</span><span>{formatCurrency(totals.vatAmt, quotation.currency)}</span></div>
                  <div className="flex justify-between border-t pt-1 text-base font-bold"><span>TOTAL AMOUNT</span><span>{formatCurrency(totals.grandTotal, quotation.currency)}</span></div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes + terms */}
      <Card>
        <CardHeader><CardTitle>Spec note &amp; terms</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Spec note (shown under the table)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} rows={2}
              placeholder="e.g. All units are made of high quality materials. Statically and Dynamically balanced…" />
          </div>
          <div className="space-y-1">
            <Label>Terms &amp; Conditions (page 2) — defaults from the selected pattern</Label>
            <Textarea className="font-mono text-xs" value={terms} onChange={(e) => setTerms(e.target.value)} disabled={!editable} rows={10} />
          </div>
        </CardContent>
      </Card>

      {/* Bottom action bar: Save changes (left) + workflow / exports (right). */}
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <Button onClick={save} disabled={busy} size="lg">{busy ? "Saving…" : "Save changes"}</Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {quotation.status === "DRAFT" && (
            <Button onClick={() => transition("PENDING_APPROVAL")} disabled={busy}>
              <Send className="h-4 w-4" /> Submit for approval
            </Button>
          )}
          {quotation.status === "PENDING_APPROVAL" && (
            <>
              <Button onClick={() => transition("APPROVED")} disabled={busy || !canApprove}>
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button variant="outline" onClick={() => transition("DRAFT")} disabled={busy}>
                <CornerUpLeft className="h-4 w-4" /> Return to draft
              </Button>
              {!canApprove && <span className="text-xs text-muted-foreground">Approval requires Engineer/Admin.</span>}
            </>
          )}
          {quotation.status === "APPROVED" && (
            <Button onClick={() => transition("SENT")} disabled={busy}>
              <Send className="h-4 w-4" /> Mark as sent
            </Button>
          )}
          <Button asChild>
            <a href={`/api/quotations/${quotation.id}/excel`}>
              <Download className="h-4 w-4" /> Download Excel
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/quotations/${quotation.id}/pdf`} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4" /> PDF
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
