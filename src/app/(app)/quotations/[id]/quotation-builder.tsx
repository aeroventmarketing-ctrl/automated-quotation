"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  motorNetPrice,
  hasExproofPrice,
  computeUnitPrice,
  combinedModel,
  hpOptions,
  dynamicBalancingApplies,
  type Voltage,
  type MotorRow,
} from "@/lib/pricing/motors";
import { Download, Send, Check, CornerUpLeft, Trash2, Gauge, Plus, RotateCcw } from "lucide-react";
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
import { updateQuotationLines, transitionQuotation, reviseQuotation } from "../actions";
import { SalePanel } from "./sale-panel";
import { isSaleConfirmed, type SaleRecord } from "@/lib/sale";
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
  gauge?: string; // sheet gauge for duct hardware (22 / 20 / 18)
  cleatSize?: string; // length option for TDC cleat / S-clip / C-clip (6.5" / 48")
  canvassUnit?: string; // canvass connector pricing basis ("per meter" / "per box")
  powderCoated?: boolean; // accessory powder-coat finish flag
  movement?: string; // motorized damper movement (open/close, modulating, adjustable)
  // Air-curtain client inputs (installation height + door width with units).
  acHeight?: number | null;
  acHeightUnit?: string;
  acWidth?: number | null;
  acWidthUnit?: string;
  // Motor Controller: pull phase/pole/HP/volts from the nearest fan line above.
  mcRecommend?: boolean;
  // Explosion-proof motor: uses the EX price and swaps the model-code "T" for "X".
  exproof?: boolean;
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
/** A retained snapshot of a past quote revision (for reference). */
export interface RevisionSnapshot {
  rev: number;
  savedAt: string;
  savedById?: string;
  subtotal: number;
  vat: number;
  total: number;
  lines: { itemLabel: string; description: string; qty: number; unitPrice: number; lineTotal: number }[];
}

interface Quote {
  id: string;
  quoteNumber: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SENT";
  sale: SaleRecord | null;
  revision: number;
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
// KDK pre-built units (whole catalogue items) hide blade type / drive / material.
// Only the KDK brand (or the legacy "KDK - Ceiling Cassette" alias) is a prebuilt
// unit — a non-KDK "Ceiling Cassette" (e.g. AlphaAir) is a normal priced item.
const isPrebuiltUnit = (specs: { brand: string; type: string }): boolean =>
  specs.brand === "KDK" || specs.type === "KDK - Ceiling Cassette";
/** Shutter Series wall fans select on air volume only — static pressure is N/A. */
const isFlowOnlyUnit = (specs: { type: string; bladeType: string }): boolean =>
  specs.type === "Wall Mounted Fan" && specs.bladeType === "Shutter Series";
/** Propeller Type static pressure (in the header unit) exceeds the 0.5" w.g. cap. */
const propellerSpOverLimit = (
  specs: { category: string; type: string; bladeType: string; staticPressure_pa: number | null },
  pressureUnitStr: string,
): boolean => {
  if (specs.category !== "Propeller Type" || isFlowOnlyUnit(specs)) return false;
  if (specs.staticPressure_pa == null) return false;
  const pu = normalizePressureUnit(pressureUnitStr) ?? "inwg";
  return convertPressure(specs.staticPressure_pa, pu, "inwg") > 0.5 + 1e-6;
};
/** Air curtains are picked differently from the duty-selected fans. */
const isAirCurtain = (specs: { type: string }): boolean => specs.type === "Air Curtain";
/** Östberg CK Inline Duct Fan: a fixed-speed unit selected by duty (flow + SP),
 *  priced as a whole unit from the catalogue (no separate motor). */
const isInlineFan = (specs: { type: string }): boolean => specs.type === "Inline Duct Fan";
/** Description for a selected inline duct fan: type / brand / model. */
function buildInlineFanDescription(model: string | null): string {
  return ["Inline Duct Fan", "Ostberg Brand", model ? `Model: ${model}` : ""]
    .filter((l) => l.length > 0)
    .join("\n");
}
/** Motor Controller is a simple sub-typed item (Motor Starter / VFD) — no fan
 *  fields (blade/drive/material/duty/size). The sub-type lives in bladeType. */
const isMotorController = (specs: { type: string }): boolean => specs.type === "Motor Controller";
/** Spring Vibration Isolator: priced by mounting + rated capacity (no duty/motor). */
const isIsolator = (specs: { type: string }): boolean => specs.type === "Spring Vibration Isolator";
/** Isolator mounting options. */
const ISO_MOUNTINGS = ["Foot Mounted", "Ceiling Mounted", "Housed Spring"];
/** Rated capacities (kg); price by mounting (foot/ceiling). */
const ISO_CAPS = [25, 35, 50, 80, 120, 175, 225, 300, 450, 600, 825];
const ISO_PRICE: { foot: Record<number, number>; ceiling: Record<number, number> } = {
  // Foot Mounted = "Floor Mounted" table; Ceiling Mounted = "Hanger Type" table.
  foot: { 25: 1417, 35: 1478, 50: 1540, 80: 1589, 120: 1663, 175: 1724, 225: 2587, 300: 3819, 450: 4127, 600: 4805, 825: 4866 },
  ceiling: { 25: 1294, 35: 1331, 50: 1355, 80: 1417, 120: 1478, 175: 1540, 225: 1725, 300: 3696, 450: 4189, 600: 5544, 825: 5667 },
};
/** Housed Spring isolator: its own capacity (kg) range and VAT-exclusive prices. */
const HOUSED_SPRING_CAPS = [200, 300, 450, 600, 825, 1100, 1400];
const HOUSED_SPRING_PRICE: Record<number, number> = {
  200: 8594, 300: 8986, 450: 9341, 600: 9692, 825: 9939, 1100: 10172, 1400: 12208,
};
/** Capacity (kg) options for an isolator mounting. */
const isoCapsFor = (shape: string): number[] => (shape === "Housed Spring" ? HOUSED_SPRING_CAPS : ISO_CAPS);
/** Smallest rated capacity covering the load, from the mounting's own list. */
const ratedCapFor = (shape: string, capKg: number | null): number | null =>
  capKg == null ? null : isoCapsFor(shape).find((c) => c >= capKg) ?? null;
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
  const rated = ratedCapFor(shape, capKg);
  if (rated == null) return null;
  if (shape === "Housed Spring") return HOUSED_SPRING_PRICE[rated] ?? null;
  const table = shape === "Foot Mounted" ? ISO_PRICE.foot : shape === "Ceiling Mounted" ? ISO_PRICE.ceiling : null;
  return table ? table[rated] ?? null : null;
}
/**
 * Recommend a spring set from the fan/blower above: number of springs and the
 * rated capacity per spring. Load = motor weight × 9, divided per category, then
 * rounded up to the next rated capacity. Propeller types use no springs.
 *   Axial / Tubular Inline → 4 springs, ÷4
 *   Centrifugal / Square Inline blowers → 4 springs, ÷4 (same as axial)
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
  // Centrifugal Inline / Square Inline blowers use the axial spring set (4, ÷4),
  // even when catalogued under Centrifugal Type — same as Tubeaxial / Vaneaxial.
  else if (t.includes("inline")) { divisor = 4; springs = 4; }
  else if (category === "Axial Type" || category === "Tubular Inline Type") { divisor = 4; springs = 4; }
  else if (category === "Centrifugal Type") { divisor = t.includes("didw") ? 5 : 6; springs = 6; }
  else return null;
  return { springs, rated: isolatorRatedCap((motorKg * 9) / divisor), noSpring: false };
}
/** Isolator description: type / mounting / rated capacity + spring colour. */
function buildIsolatorDescription(shape: string, capKg: number | null): string {
  const rated = ratedCapFor(shape, capKg);
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
  // Östberg CK inline duct fans (fixed-speed) query the CK catalogue.
  if (type === "Inline Duct Fan") return "CK";
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
  "Pressure Relief Damper",
  "Smoke Damper",
  "Volume Damper",
  "Motorized Fire Damper",
  "Motorized Smoke Damper",
  "Motorized Volume Damper",
]);
const SIZE_UNITS = ["mm", "cm", "inches"];
/** Motorized damper types that carry an "Operation" dropdown (+ actuator). */
const MOTORIZED_DAMPER_TYPES = new Set([
  "Motorized Fire Damper",
  "Motorized Relief Damper",
  "Motorized Smoke Damper",
  "Motorized Volume Damper",
]);
const MOVEMENT_OPTIONS = ["open/close", "modulating", "adjustable"];
/**
 * Operations offered per motorized-damper type. Fire and Smoke dampers are
 * open/close only; Volume and Relief dampers also modulate / adjust. The first
 * entry is the default (spring return, 220 V) when the client doesn't indicate.
 */
const MOVEMENT_OPTIONS_BY_TYPE: Record<string, string[]> = {
  "Motorized Fire Damper": ["open/close"],
  "Motorized Smoke Damper": ["open/close"],
  "Motorized Volume Damper": ["open/close", "modulating", "adjustable"],
  "Motorized Relief Damper": ["open/close", "modulating", "adjustable"],
};
const movementOptionsFor = (type: string): string[] => MOVEMENT_OPTIONS_BY_TYPE[type] ?? MOVEMENT_OPTIONS;
/** Human label for an operation (the stored value stays terse). */
const MOVEMENT_LABEL: Record<string, string> = {
  "open/close": "open/close",
  modulating: "modulating",
  adjustable: "adjustable volume",
};
/** Material options for Ventilation Accessories (Air Terminals / Dampers). */
const ACC_MATERIALS = ["Galvanized Iron", "Aluminum", "Stainless Steel 304"];
/** Vent Cap: fixed diameters (inches) and stainless-only material options. */
const VENT_CAP_DIAMETERS = ["4", "6", "8"];
const VENT_CAP_MATERIALS = ["Stainless 201", "Stainless 304"];
const isVentCap = (specs: { category: string; type: string }): boolean =>
  specs.category === "Ventilation Accessories" && specs.type === "Vent Cap";
/** Any stainless grade — no paint/powder finish applies. */
const isStainlessMaterial = (m: string): boolean => /stainless/i.test(m);
// Vent Cap prices (VAT-EXCLUSIVE net) by diameter. Powder coated is a single
// price per size (100 pcs minimum) that replaces the plain material price.
const VENT_CAP_PRICE: Record<string, Record<string, number>> = {
  "Stainless 201": { "4": 300, "6": 500, "8": 900 },
  "Stainless 304": { "4": 400, "6": 650, "8": 1100 },
};
const VENT_CAP_POWDER_PRICE: Record<string, number> = { "4": 370, "6": 590, "8": 1010 };
/** Net (VAT-exclusive) unit price for a Vent Cap, or null until size/material set. */
function ventCapNet(specs: LineSpecs): number | null {
  const size = specs.sizeL;
  if (!size) return null;
  if (specs.powderCoated) return VENT_CAP_POWDER_PRICE[size] ?? null;
  if (!VENT_CAP_MATERIALS.includes(specs.material)) return null;
  return VENT_CAP_PRICE[specs.material]?.[size] ?? null;
}
/** Auto unit price (VAT-inclusive, as stored) for a Vent Cap, or null. */
function ventCapUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const net = ventCapNet(specs);
  return net == null ? null : round2(net * (1 + vatRate));
}
// Duct Canvass Connector: priced by material (VAT-exclusive net), either per
// meter or per box. A box is 25 m; the per-box price = per-meter × 25 − 2,500
// (box discount baked in). The line quantity is meters or boxes to match.
const CANVASS_MATERIALS = ["PVC", "Fiberglass Cloth", "Silicone"];
const CANVASS_UNITS = ["per meter", "per box"];
const CANVASS_BOX_METERS = 25;
const CANVASS_METER_NET: Record<string, number> = { PVC: 500, "Fiberglass Cloth": 600, Silicone: 700 };
const CANVASS_BOX_NET: Record<string, number> = { PVC: 10000, "Fiberglass Cloth": 12500, Silicone: 15000 };
// Matched by type — the canvass connector lives under Other Products (Aerovent).
const isCanvass = (specs: { type: string }): boolean => specs.type === "Duct Canvass Connector";
/** Net (VAT-exclusive) unit price (per meter or per box) for a canvass connector, or null. */
function canvassNet(specs: LineSpecs): number | null {
  if (!CANVASS_MATERIALS.includes(specs.material)) return null;
  const table = specs.canvassUnit === "per box" ? CANVASS_BOX_NET : CANVASS_METER_NET;
  return table[specs.material] ?? null;
}
/** Auto unit price (VAT-inclusive) for a canvass connector, or null. */
function canvassUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const net = canvassNet(specs);
  return net == null ? null : round2(net * (1 + vatRate));
}
/** Description for a canvass connector: type + material + pricing basis. */
function buildCanvassDescription(specs: LineSpecs): string {
  const lines: string[] = [];
  if (specs.type) lines.push(specs.type);
  if (CANVASS_MATERIALS.includes(specs.material)) lines.push(specs.material);
  if (specs.canvassUnit === "per box") lines.push(`Per box (${CANVASS_BOX_METERS} meters)`);
  else if (specs.canvassUnit === "per meter") lines.push("Per meter");
  return lines.join("\n");
}
// Wind Driven Roof Ventilator (Other Products / Aerovent): throat diameter (in)
// + material. Prices are VAT-EXCLUSIVE (net) per piece by material × diameter.
const WIND_VENT_DIAMETERS = ["12", "15", "24", "27", "32", "36"];
const WIND_VENT_MATERIALS = ["Galvanized Iron", "Aluminum", "Stainless Steel"];
const WIND_VENT_PRICE: Record<string, Record<string, number>> = {
  "Galvanized Iron": { "12": 5233, "15": 7475, "24": 11960, "27": 12708, "32": 14950, "36": 22425 },
  Aluminum: { "12": 8896, "15": 12708, "24": 17193, "27": 21603, "32": 21678, "36": 27658 },
  "Stainless Steel": { "12": 13082, "15": 17940, "24": 29900, "27": 31769, "32": 41860, "36": 53820 },
};
const isWindVent = (specs: { type: string }): boolean => specs.type === "Wind Driven Roof Ventilator";
/** Net (VAT-exclusive) price for a roof ventilator by material × throat diameter, or null. */
function windVentNet(specs: LineSpecs): number | null {
  if (!WIND_VENT_MATERIALS.includes(specs.material) || !specs.sizeL) return null;
  return WIND_VENT_PRICE[specs.material]?.[specs.sizeL] ?? null;
}
/** Auto unit price (VAT-inclusive, as stored) for a roof ventilator, or null. */
function windVentUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const net = windVentNet(specs);
  return net == null ? null : round2(net * (1 + vatRate));
}
/** Description for a wind-driven roof ventilator: type + throat diameter + material. */
function buildWindVentDescription(specs: LineSpecs): string {
  const lines: string[] = [];
  if (specs.type) lines.push(specs.type);
  if (specs.sizeL) lines.push(`${specs.sizeL}" Throat Diameter`);
  if (WIND_VENT_MATERIALS.includes(specs.material)) lines.push(`${accMaterialLabel(specs.material)} Material`);
  return lines.join("\n");
}
// Aluminum Duct (Other Products / Aerovent, MaxAir): sold per size × 10 m box.
// Prices are VAT-EXCLUSIVE (net) per piece. Size key = diameter in inches.
const ALU_DUCT_SIZES = ["4", "5", "6", "8"];
const ALU_DUCT_PRICE: Record<string, number> = { "4": 579, "5": 696, "6": 812, "8": 1059 };
const aluDuctSizeLabel = (n: string): string => `${n}" x 10 meters`;
const isAluDuct = (specs: { type: string }): boolean => specs.type === "Aluminum Duct";
/** Net (VAT-exclusive) price for an aluminum duct by size, or null. */
function aluDuctNet(specs: LineSpecs): number | null {
  return specs.sizeL ? ALU_DUCT_PRICE[specs.sizeL] ?? null : null;
}
/** Auto unit price (VAT-inclusive, as stored) for an aluminum duct, or null. */
function aluDuctUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const net = aluDuctNet(specs);
  return net == null ? null : round2(net * (1 + vatRate));
}
/** Description for an aluminum duct: type + size. */
function buildAluDuctDescription(specs: LineSpecs): string {
  const lines: string[] = [];
  if (specs.type) lines.push(specs.type);
  if (specs.sizeL) lines.push(aluDuctSizeLabel(specs.sizeL));
  return lines.join("\n");
}
// Portable Axial Blower family (Other Products, Pioneer): picked by fan size
// (inches) and a duct type. The standard blower and the explosion-proof (XProof)
// variant share the same sizes and mechanism but have their own price/spec tables.
// The fan config (standard "With Duct" / XProof "With-out Duct") carries the fan
// rating (capacity / speed / static pressure / motor watts / 220 V); "Flexible
// Duct" is the bare flexible-duct accessory (price only, no rating). Prices are
// VAT-EXCLUSIVE (net). The duct type is held in the otherwise-unused bladeType.
const PORTABLE_BLOWER_SIZES = ["10", "12", "14", "16", "24"];
// XProof is not offered in 14" (no price for either unit or flexible duct).
const PORTABLE_XPROOF_SIZES = ["10", "12", "16", "24"];
const PORTABLE_BLOWER_DUCT_TYPES = ["With Duct", "Flexible Duct"];
const PORTABLE_XPROOF_DUCT_TYPES = ["With-out Duct", "Flexible Duct"];
const portableBlowerSizeLabel = (n: string): string => `${n} in`;
interface PortableBlowerRow { cfm: number; rpm: number; pa: number; watt: number; volts: number; net: number }
const PORTABLE_BLOWER_WITH_DUCT: Record<string, PortableBlowerRow> = {
  "10": { cfm: 1943, rpm: 3300, pa: 450, watt: 400, volts: 220, net: 8515 },
  "12": { cfm: 2543, rpm: 3300, pa: 500, watt: 600, volts: 220, net: 9555 },
  "14": { cfm: 3532, rpm: 3300, pa: 630, watt: 1000, volts: 220, net: 13163 },
  "16": { cfm: 4238, rpm: 3300, pa: 780, watt: 1100, volts: 220, net: 24960 },
  "24": { cfm: 8476, rpm: 1720, pa: 540, watt: 2000, volts: 220, net: 49010 },
};
const PORTABLE_BLOWER_FLEX_NET: Record<string, number> = {
  "10": 2340, "12": 2470, "14": 2600, "16": 3900, "24": 5590,
};
// XProof (explosion-proof) — 14" is not offered on the price sheet (no auto-price).
const PORTABLE_XPROOF_WITH_DUCT: Record<string, PortableBlowerRow> = {
  "10": { cfm: 1943, rpm: 3300, pa: 450, watt: 400, volts: 220, net: 13728 },
  "12": { cfm: 2543, rpm: 3300, pa: 500, watt: 600, volts: 220, net: 15288 },
  "16": { cfm: 4238, rpm: 3300, pa: 780, watt: 1100, volts: 220, net: 24336 },
  "24": { cfm: 8476, rpm: 1720, pa: 540, watt: 2000, volts: 220, net: 46800 },
};
const PORTABLE_XPROOF_FLEX_NET: Record<string, number> = {
  "10": 3900, "12": 4368, "16": 5772, "24": 7800,
};
const isPortableBlower = (specs: { type: string }): boolean => specs.type === "Portable Axial Blower";
const isPortableXproof = (specs: { type: string }): boolean => specs.type === "Portable Axial Blower (XProof)";
const isPortableBlowerFamily = (specs: { type: string }): boolean =>
  isPortableBlower(specs) || isPortableXproof(specs);
const portableBlowerIsFlex = (specs: LineSpecs): boolean => specs.bladeType === "Flexible Duct";
/** Duct-type options for this variant (standard "With Duct" vs XProof "With-out Duct"). */
const portableBlowerDuctTypes = (specs: { type: string }): string[] =>
  isPortableXproof(specs) ? PORTABLE_XPROOF_DUCT_TYPES : PORTABLE_BLOWER_DUCT_TYPES;
/** Size options for this variant (XProof drops the un-priced 14"). */
const portableBlowerSizes = (specs: { type: string }): string[] =>
  isPortableXproof(specs) ? PORTABLE_XPROOF_SIZES : PORTABLE_BLOWER_SIZES;
/** Fan-config rating row (the non-flex option) for this variant × size, or null. */
function portableBlowerRow(specs: LineSpecs): PortableBlowerRow | null {
  if (!specs.sizeL) return null;
  const table = isPortableXproof(specs) ? PORTABLE_XPROOF_WITH_DUCT : PORTABLE_BLOWER_WITH_DUCT;
  return table[specs.sizeL] ?? null;
}
/** Net (VAT-exclusive) price for a portable axial blower by size × duct type, or null. */
function portableBlowerNet(specs: LineSpecs): number | null {
  if (!specs.sizeL) return null;
  if (portableBlowerIsFlex(specs)) {
    const flex = isPortableXproof(specs) ? PORTABLE_XPROOF_FLEX_NET : PORTABLE_BLOWER_FLEX_NET;
    return flex[specs.sizeL] ?? null;
  }
  return portableBlowerRow(specs)?.net ?? null;
}
/** Auto unit price (VAT-inclusive, as stored) for a portable axial blower, or null. */
function portableBlowerUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const net = portableBlowerNet(specs);
  return net == null ? null : round2(net * (1 + vatRate));
}
/** Description for a portable axial blower. Flexible Duct is a standalone accessory
 *  line (name · brand · diameter); the fan config shows type · brand · size · rpm. */
function buildPortableBlowerDescription(specs: LineSpecs): string {
  const lines: string[] = [];
  if (portableBlowerIsFlex(specs)) {
    lines.push(isPortableXproof(specs) ? "Exproof Flexible Duct" : "Flexible Duct");
    lines.push("Pioneer Brand");
    if (specs.sizeL) lines.push(`${specs.sizeL}" diameter`);
    return lines.join("\n");
  }
  if (specs.type) lines.push(specs.type);
  lines.push("Pioneer Brand");
  if (specs.sizeL) {
    const dt = specs.bladeType || portableBlowerDuctTypes(specs)[0];
    lines.push(`${specs.sizeL}" — ${dt}`);
    const row = portableBlowerRow(specs);
    if (row) lines.push(`${row.rpm} rpm`);
  }
  return lines.join("\n");
}
// Variable Air Volume (Other Products / Aerovent): a VAV box complete with a VAV
// Actuator (NSVA 0200B) and Thermostat (NEVD). Selected either "by Volume Flow"
// (the entered duty is matched to the smallest duct whose airflow range covers it)
// or "by Duct Size" (pick the duct directly). Airflow ranges are stored in every
// listed unit for the sales reference. SELLING PRICE is VAT-INCLUSIVE (gross), so
// it is stored as-is (NOT ×1.12). Select mode → bladeType, duct size → sizeL,
// entered flow → sizeW, flow unit → sizeUnit.
const VAV_SELECT_MODES = ["by Volume Flow", "by Duct Size"];
interface VavRow {
  in: string; mm: number;
  lpsMin: number; lpsMax: number; cfmMin: number; cfmMax: number; cmhMin: number; cmhMax: number;
  price: number;
}
const VAV_ROWS: VavRow[] = [
  { in: "4",  mm: 100, lpsMin: 12,   lpsMax: 106,  cfmMin: 26,   cfmMax: 225,  cmhMin: 44,   cmhMax: 382,   price: 39109 },
  { in: "6",  mm: 150, lpsMin: 29,   lpsMax: 212,  cfmMin: 62,   cfmMax: 450,  cmhMin: 105,  cmhMax: 764,   price: 40162 },
  { in: "8",  mm: 200, lpsMin: 52,   lpsMax: 378,  cfmMin: 110,  cfmMax: 800,  cmhMin: 187,  cmhMax: 1359,  price: 40207 },
  { in: "10", mm: 250, lpsMin: 85,   lpsMax: 637,  cfmMin: 180,  cfmMax: 1350, cmhMin: 306,  cmhMax: 2294,  price: 41991 },
  { in: "12", mm: 300, lpsMin: 127,  lpsMax: 991,  cfmMin: 270,  cfmMax: 2100, cmhMin: 459,  cmhMax: 3568,  price: 43500 },
  { in: "14", mm: 350, lpsMin: 189,  lpsMax: 1510, cfmMin: 400,  cfmMax: 3200, cmhMin: 679,  cmhMax: 5436,  price: 47617 },
  { in: "16", mm: 400, lpsMin: 269,  lpsMax: 1888, cfmMin: 570,  cfmMax: 4000, cmhMin: 968,  cmhMax: 6796,  price: 59144 },
  { in: "24", mm: 600, lpsMin: 1800, lpsMax: 3775, cfmMin: 2500, cfmMax: 8000, cmhMin: 4247, cmhMax: 13593, price: 89440 },
];
const VAV_ACTUATOR_NOTE = "NSVA 0200B — VAV Actuator 5Nm, 24VAC with 2× Analog input, BacNET Communication";
const VAV_THERMOSTAT_NOTE = "NEVD — HMI Thermostat for VAV actuators with Temperature Sensor and LED display, Modbus RTU";
const isVav = (specs: { type: string }): boolean => specs.type === "Variable Air Volume";
const vavDuctLabel = (r: VavRow): string => `${r.mm} mm (${r.in} in)`;
const vavRowForSize = (sizeL: string): VavRow | null => VAV_ROWS.find((r) => r.in === sizeL) ?? null;
/** Candidate ducts for a "by Volume Flow" duty — every duct that can handle the
 *  flow (flow ≤ its max), smallest first; the first is the recommended pick. */
function vavPicks(specs: LineSpecs): VavRow[] {
  const u = normalizeAirflowUnit(specs.sizeUnit) ?? "cfm";
  const val = specs.sizeW ? Number(specs.sizeW) : NaN;
  if (Number.isNaN(val) || val <= 0) return [];
  const cmh = convertAirflow(val, u, "m3hr");
  return VAV_ROWS.filter((r) => cmh <= r.cmhMax);
}
/** Description for a VAV: name + "complete with…" + duct size + airflow range. */
function buildVavDescription(specs: LineSpecs): string {
  const lines = ["Variable Air Volume", "Complete with VAV Actuator & Thermostat"];
  const row = vavRowForSize(specs.sizeL);
  if (row) {
    lines.push(`Duct Diameter: ${row.mm} mm (${row.in} in)`);
    lines.push(`Airflow Range: ${row.cmhMin} – ${row.cmhMax} CMH`);
  }
  return lines.join("\n");
}
// Induction Motor (TECO / Hyundai) sold as a standalone product: pick Phase, Pole
// and HP; the price comes from the same TECO motor tables used for blower motors
// (VAT-EXCLUSIVE net × 1.12). Single phase is always 4-pole; three phase offers
// 2/4/6-pole. Hyundai shares TECO's prices but is 3-phase 4-pole only. Phase →
// motorPh, pole → motorPole, HP → motorHp; volts default 220.
const isInductionMotor = (specs: { type: string }): boolean =>
  specs.type === "Induction Motor (TECO)" || specs.type === "Induction Motor (Hyundai)";
const isInductionHyundai = (specs: { type: string }): boolean => specs.type === "Induction Motor (Hyundai)";
/** Effective pole for the motor: single phase and Hyundai are 4-pole only. */
const inductionPole = (specs: LineSpecs): number =>
  specs.motorPh === 1 || isInductionHyundai(specs) ? 4 : specs.motorPole ?? 4;
/** Phase options — Hyundai is three-phase only. */
const inductionPhaseOptions = (specs: LineSpecs): number[] => (isInductionHyundai(specs) ? [3] : [1, 3]);
/** HP options for the current phase/pole (only priced HPs are listed). */
const inductionHpOptions = (specs: LineSpecs): number[] =>
  specs.motorPh ? hpOptions(specs.motorPh, inductionPole(specs)) : [];
/** The motor table row for the current phase/pole/HP, or undefined. */
function inductionMotorRow(specs: LineSpecs): MotorRow | undefined {
  if (!specs.motorPh || specs.motorHp == null) return undefined;
  return lookupMotor(specs.motorHp, specs.motorPh, inductionPole(specs));
}
/** Auto unit price (VAT-inclusive, as stored) for an induction-motor line, or null. */
function inductionUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const m = inductionMotorRow(specs);
  return m ? round2(m.price * (1 + vatRate)) : null;
}
/** Description for an induction motor. For now only the type name shows; the
 *  full description lines will be supplied later (HP · phase · pole / model
 *  removed at the client's request). Phase/pole/HP still drive the price. */
function buildInductionDescription(specs: LineSpecs): string {
  return specs.type;
}
// Jet Fan (Other Products, MAXAIR): pick a model; each carries its rating and a
// VAT-EXCLUSIVE (net) selling price. The model is stored in blowerModel.
const JET_FAN_MODELS = ["MA-250", "MA-300"];
const JET_FAN: Record<string, { watt: number; cmh: number; pa: number; net: number }> = {
  "MA-250": { watt: 300, cmh: 2000, pa: 24, net: 41870 },
  "MA-300": { watt: 480, cmh: 3000, pa: 39, net: 67714 },
};
const isJetFan = (specs: { type: string }): boolean => specs.type === "Jet Fan";
/** Net (VAT-exclusive) price for a jet fan by model, or null. */
function jetFanNet(specs: LineSpecs): number | null {
  return specs.blowerModel ? JET_FAN[specs.blowerModel]?.net ?? null : null;
}
/** Auto unit price (VAT-inclusive, as stored) for a jet fan, or null. */
function jetFanUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const net = jetFanNet(specs);
  return net == null ? null : round2(net * (1 + vatRate));
}
/** Description for a jet fan: type + brand + model (rating goes in the columns). */
function buildJetFanDescription(specs: LineSpecs): string {
  const lines: string[] = ["Jet Fan", "MaxAir Brand"];
  if (specs.blowerModel) lines.push(`Model: ${specs.blowerModel}`);
  return lines.join("\n");
}
/** Accessory types that offer the powder-coat finish option. */
const POWDER_COAT_TYPES = new Set([
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
  "Pressure Relief Damper",
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
const ACC_DAMPER_TYPES = new Set(["Backdraft Damper", "Fire Damper", "Gravity Shutter", "Pressure Relief Damper", "Smoke Damper", "Volume Damper"]);
const ACC_MATERIAL_FACTOR: Record<string, number> = {
  "Galvanized Iron": 1,
  Aluminum: 3,
  "Stainless Steel 304": 4,
};
/** Per-square-inch body rate for an accessory, or null if not auto-priced. */
function accessoryRate(type: string, shape: string): number | null {
  const isDamper = ACC_DAMPER_TYPES.has(type) || MOTORIZED_DAMPER_TYPES.has(type);
  const priced = ACC_GRILLE_TYPES.has(type) || isDamper || type === "OBVD" || type === "Perforated Air Grille";
  if (!priced) return null;
  if (shape === "Round") return 10.42; // round grilles / dampers / diffusers
  if (type === "Perforated Air Grille") return 6; // perforated air grilles
  if (type === "OBVD") return 5;
  if (isDamper) return 8; // square / rectangular damper / volume (incl. motorized body)
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

// --- Motorized-damper actuators --------------------------------------------
// Torque is chosen by the damper area: 310 sq inch per NM (pick the smallest NM
// that covers the area). Model/price + supply voltage come from the operation:
//   open/close        → spring return,      220 V
//   modulating        → non-spring SR model, 24 V
//   adjustable volume → non spring return,  220 V
// Voltage is a spec label only (it doesn't change the table price). A damper is
// sectioned so no piece exceeds 1.5 m (1500 mm) on a side — each dimension is
// split into equal parts (ceil(dim / 1.5 m)) — and one actuator, sized to a
// single section's area, is fitted per section.
const ACTUATOR_SQIN_PER_NM = 310;
const ACTUATOR_MAX_SECTION_MM = 1500;
const SPRING_ACTUATOR: { nm: number; std: number; sr: number }[] = [
  { nm: 2.5, std: 10502, sr: 14062 },
  { nm: 4, std: 13657, sr: 17307 },
  { nm: 10, std: 15685, sr: 19787 },
  { nm: 20, std: 21048, sr: 24518 },
  { nm: 30, std: 58769, sr: 56291 },
];
const NONSPRING_ACTUATOR: { nm: number; std: number; sr: number }[] = [
  { nm: 2, std: 6963, sr: 7883 },
  { nm: 5, std: 7842, sr: 10321 },
  { nm: 10, std: 10096, sr: 12980 },
  { nm: 20, std: 11898, sr: 12980 },
  { nm: 40, std: 19934, sr: 21356 },
];
/**
 * The actuator chosen for an operation + section area: its torque (NM) and unit
 * price. open/close → spring-return ladder; modulating / adjustable → non-spring
 * ladder, with modulating on the SR column (24 V) and adjustable on std.
 */
function actuatorPick(movement: string, areaSqIn: number): { nm: number; price: number } {
  const ladder = movement === "open/close" ? SPRING_ACTUATOR : NONSPRING_ACTUATOR;
  const reqNm = areaSqIn / ACTUATOR_SQIN_PER_NM;
  const pick = ladder.find((a) => a.nm >= reqNm - 1e-9) ?? ladder[ladder.length - 1];
  return { nm: pick.nm, price: movement === "modulating" ? pick.sr : pick.std };
}
/** Price of one actuator for the given operation + section area. */
function actuatorUnitPrice(movement: string, areaSqIn: number): number {
  return actuatorPick(movement, areaSqIn).price;
}
/** Actuator supply voltage by operation (label only — does not change price). */
const actuatorVoltage = (movement: string): string => (movement === "modulating" ? "24V" : "230V");
/** Actuator model-type name by operation (shown on the quote line). */
const actuatorModelLabel = (movement: string): string =>
  movement === "open/close" ? "Spring Return" : movement === "modulating" ? "SR Model" : "Non Spring Return";
// Actuator model codes by operation and damper area (the sheet's own breakpoints:
// ≤620 sq in and ≤1240 sq in). Voltage is fixed per operation — open/close and
// adjustable at 230 V, modulating at 24 V — so only that voltage's code is used.
// Dampers larger than 1240 sq in have no listed code (fall back to the type name).
const ACTUATOR_MODEL_CODES: Record<string, { max: number; code: string }[]> = {
  "open/close": [{ max: 620, code: "TF230" }, { max: 1240, code: "LF230" }],
  adjustable: [{ max: 620, code: "CM230" }, { max: 1240, code: "LM230A" }],
  modulating: [{ max: 620, code: "CM24-SR-R" }, { max: 1240, code: "LM24A-SR" }],
};
/** Actuator model code for an operation + damper area, or null when off the table. */
function actuatorModelCode(movement: string, areaSqIn: number): string | null {
  const table = ACTUATOR_MODEL_CODES[movement];
  return table?.find((r) => areaSqIn <= r.max + 1e-9)?.code ?? null;
}
/**
 * Section a motorized damper so no piece exceeds 1.5 m on a side: split each
 * dimension into equal parts (ceil(dim / 1.5 m)). Returns the number of sections
 * (one actuator each) and the area of a single section in trade sq in (25 mm =
 * 1 in). Round dampers aren't gridded — one actuator sized to the full area.
 */
function damperSectioning(specs: LineSpecs): { sections: number; sectionAreaSqIn: number | null } {
  const unit = specs.sizeUnit || "mm";
  const toMm = (v: string): number | null => {
    const n = parseFloat(v);
    return !v || Number.isNaN(n) ? null : n * (ACC_MM_PER_UNIT[unit] ?? 1);
  };
  const mmToIn = (mm: number) => mm / 25;
  const partsOf = (mm: number) => Math.max(1, Math.ceil(mm / ACTUATOR_MAX_SECTION_MM));
  if (specs.shape === "Round") {
    const d = toMm(specs.sizeL);
    if (d == null) return { sections: 1, sectionAreaSqIn: null };
    const din = mmToIn(d);
    return { sections: 1, sectionAreaSqIn: din * din };
  }
  const L = toMm(specs.sizeL);
  const W = toMm(specs.sizeW);
  if (L == null || W == null) return { sections: 1, sectionAreaSqIn: null };
  const pL = partsOf(L);
  const pW = partsOf(W);
  return { sections: pL * pW, sectionAreaSqIn: mmToIn(L / pL) * mmToIn(W / pW) };
}
/**
 * Total actuator cost for a motorized damper (0 when N/A): one actuator sized to
 * a single section's area — the next-higher torque that covers it — times the
 * number of sections.
 */
function accActuatorCost(specs: LineSpecs): number {
  if (!MOTORIZED_DAMPER_TYPES.has(specs.type) || !specs.movement) return 0;
  const { sections, sectionAreaSqIn } = damperSectioning(specs);
  if (sectionAreaSqIn == null) return 0;
  return round2(actuatorUnitPrice(specs.movement, sectionAreaSqIn) * sections);
}
/**
 * Actuator summary for a motorized-damper line — torque, model code (or type
 * name), voltage, per-section count and cost — for the price hint / description.
 * Null until an operation and dimensions are set.
 */
function actuatorSummary(specs: LineSpecs): {
  sections: number; nm: number; model: string; voltage: string; unit: number; total: number;
} | null {
  if (!MOTORIZED_DAMPER_TYPES.has(specs.type) || !specs.movement) return null;
  const { sections, sectionAreaSqIn } = damperSectioning(specs);
  if (sectionAreaSqIn == null) return null;
  const { nm, price } = actuatorPick(specs.movement, sectionAreaSqIn);
  const model = actuatorModelCode(specs.movement, sectionAreaSqIn) ?? actuatorModelLabel(specs.movement);
  return { sections, nm, model, voltage: actuatorVoltage(specs.movement), unit: price, total: round2(price * sections) };
}
/** Auto unit price (VAT-inclusive) for a sized accessory, or null if incomplete. */
function accessoryUnitPrice(specs: LineSpecs): number | null {
  const rate = accessoryRate(specs.type, specs.shape);
  const area = accBilledAreaSqIn(specs);
  const mat = ACC_MATERIAL_FACTOR[specs.material];
  if (rate == null || area == null || mat == null) return null;
  const body = accessoryBody(specs, area, rate, mat);
  return round2(body + accFlatAdd(specs.type) + accActuatorCost(specs));
}
/**
 * Body price. Powder coating is applied on a GI base (area × rate × 1 × powder
 * factor); aluminum adds its material premium on top (area × rate × 2), e.g. a
 * powder-coated aluminum grille = area × rate × 2 + area × rate × 1 × powder.
 * Un-coated items are simply area × rate × material factor.
 */
function accessoryBody(specs: LineSpecs, area: number, rate: number, mat: number): number {
  if (!specs.powderCoated) return area * rate * mat;
  const powder = area * rate * accPowderFactor(specs.type); // GI base × powder factor
  const aluPremium = specs.material === "Aluminum" ? area * rate * 2 : 0;
  return powder + aluPremium;
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
    lines.push(`${specs.sizeL} ${unit} x ${specs.sizeW} ${unit}`);
  }
  // Motorized dampers: the actuator (model type / voltage) sits above the
  // material, e.g. "Spring Return / 230V". The section count follows when the
  // damper splits into more than one 1.5 m section. (The specific model code
  // stays in the internal price hint, not the customer-facing description.)
  if (MOTORIZED_DAMPER_TYPES.has(specs.type) && specs.movement) {
    const { sections } = damperSectioning(specs);
    const pcs = sections > 1 ? ` (${sections} pcs)` : "";
    lines.push(`${actuatorModelLabel(specs.movement)} / ${actuatorVoltage(specs.movement)}${pcs}`);
  }
  if (ACC_MATERIALS.includes(specs.material) || VENT_CAP_MATERIALS.includes(specs.material)) {
    lines.push(`${accMaterialLabel(specs.material)} Material`);
    // Finish follows the material. Powder coating can be applied to any material
    // that offers it (incl. Vent Cap on stainless). Otherwise: air terminals
    // carry oven-baked enamel, but stainless / dampers / motorized carry none.
    const canPowder = POWDER_COAT_TYPES.has(specs.type) || specs.type === "Vent Cap";
    if (!MOTORIZED_DAMPER_TYPES.has(specs.type)) {
      if (canPowder && specs.powderCoated) {
        lines.push("Powder Coated White");
      } else if (!isStainlessMaterial(specs.material) && groupForType(specs.category, specs.type) === "Air Terminals") {
        lines.push("Painted with Oven Baked Enamel");
      }
    }
  }
  return lines.join("\n");
}

// --- Duct hardware (clips, cleats, corners): priced per piece by sheet gauge --
// Angle corner is priced by gauge alone; TDC Cleat / S-clip / C-clip also carry
// a length option (6.5" / 48"). All prices below are VAT-EXCLUSIVE (net) per pc.
const DUCT_HARDWARE_TYPES = new Set(["Duct Angle corner", "TDC Cleat", "S-clip", "C-clip"]);
const CLEAT_TYPES = new Set(["TDC Cleat", "S-clip", "C-clip"]); // gauge + length priced
const HW_MATERIALS = ["Galvanized Iron"]; // duct hardware is galvanized iron only
const HW_GAUGES = ["22", "20", "18"];
const HW_GAUGE_THICKNESS: Record<string, string> = { "22": "0.7 mm", "20": "0.9 mm", "18": "1.1 mm" };
// TDC Cleat uses a 6.5" short length; S-clip / C-clip use 6" (same price).
function cleatLengthsFor(type: string): string[] {
  return type === "TDC Cleat" ? ['6.5"', '48"'] : ['6"', '48"'];
}
const ANGLE_CORNER_PRICE: Record<string, number> = { "22": 6, "20": 7, "18": 8 };
const CLEAT_PRICE: Record<string, Record<string, number>> = {
  '6.5"': { "22": 8, "20": 9, "18": 10 },
  '6"': { "22": 8, "20": 9, "18": 10 }, // S-clip / C-clip — same price as 6.5"
  '48"': { "22": 50, "20": 55, "18": 60 },
};
const isDuctHardware = (specs: { category: string; type: string }): boolean =>
  specs.category === "Ventilation Accessories" && DUCT_HARDWARE_TYPES.has(specs.type);
/**
 * Volume discount factor on the Duct Angle corner per-piece price, by the order
 * quantity (discounts compound):
 *   up to 500 pcs     → none                (×1.00)
 *   501–5,000 pcs     → less 10%            (×0.90)
 *   5,001–10,000 pcs  → less 10% + less 10% (×0.81)
 *   10,001+ pcs       → less 10% + less 15% (×0.765)
 */
function angleCornerDiscountFactor(qty: number): number {
  if (qty >= 10001) return 0.9 * 0.85;
  if (qty >= 5001) return 0.9 * 0.9;
  if (qty >= 501) return 0.9;
  return 1;
}
/** Net (VAT-exclusive) per-piece price for a duct-hardware line, or null if incomplete. */
function ductHardwareNet(specs: LineSpecs, qty: number): number | null {
  if (specs.type === "Duct Angle corner") {
    const base = specs.gauge ? ANGLE_CORNER_PRICE[specs.gauge] ?? null : null;
    return base == null ? null : round2(base * angleCornerDiscountFactor(qty));
  }
  if (CLEAT_TYPES.has(specs.type)) {
    if (!specs.gauge || !specs.cleatSize) return null;
    return CLEAT_PRICE[specs.cleatSize]?.[specs.gauge] ?? null;
  }
  return null;
}
/** Unit price (VAT-inclusive, as stored) for a duct-hardware line, or null. */
function ductHardwareUnitPrice(specs: LineSpecs, vatRate: number, qty: number): number | null {
  const net = ductHardwareNet(specs, qty);
  return net == null ? null : round2(net * (1 + vatRate));
}
/** Description for a duct-hardware line: type, length (cleats), gauge, material. */
function buildDuctHardwareDescription(specs: LineSpecs): string {
  const lines: string[] = [];
  if (specs.type) lines.push(specs.type);
  if (CLEAT_TYPES.has(specs.type) && specs.cleatSize) lines.push(`${specs.cleatSize} Length`);
  if (specs.gauge) lines.push(`Gauge ${specs.gauge} (${HW_GAUGE_THICKNESS[specs.gauge] ?? ""})`.trim());
  if (ACC_MATERIALS.includes(specs.material)) lines.push(`${accMaterialLabel(specs.material)} Material`);
  return lines.join("\n");
}

/** Shape / variant options for a Ventilation Accessory type. */
function shapesFor(type: string): string[] {
  if (type === "Bar Grille") return ["Rectangle"];
  if (type === "Jet Nozzle Diffuser" || type === "Vent Cap") return ["Round"];
  if (type === "Spring Vibration Isolator") return ISO_MOUNTINGS;
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
  isPreparer = false,
  revisionHistory = [],
  catalog,
  propellerSpLock = true,
}: {
  quotation: Quote;
  templates: { id: string; name: string; layoutKey: string; specNote: string; terms: string }[];
  canApprove: boolean;
  isAdmin?: boolean;
  isPreparer?: boolean;
  revisionHistory?: RevisionSnapshot[];
  catalog: Record<string, CatalogEntry>;
  propellerSpLock?: boolean;
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
  // Spec note + terms always follow the selected pattern — seed them from the
  // quote's current template (not any stale saved carry-over) so the quote
  // strictly matches its chosen template. Falls back to the saved text only for
  // a retired template that is no longer in the picker.
  const initialTpl = templates.find((t) => t.id === quotation.templateId);
  const [notes, setNotes] = useState(initialTpl ? initialTpl.specNote : quotation.notes ?? "");
  const [terms, setTerms] = useState(initialTpl ? initialTpl.terms : quotation.terms ?? "");
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
  // VAV duct picks only show after the user clicks "Run selection" (per line).
  const [vavRan, setVavRan] = useState<Record<string, boolean>>({});

  // When every line is a fans-and-blowers product, prioritize the "Fans and
  // Blowers" (standard) pattern: switch to that template and reset the header
  // units to the fans-and-blowers defaults (cfm / in-w.g. / HP). Fires only when
  // the quote *becomes* all-blowers while editing — never on mount, so a saved
  // quote's chosen template/units are preserved, and the user can still override
  // afterward until the line mix changes again.
  const stdTemplateId = useMemo(
    () => templates.find((t) => t.layoutKey === "standard")?.id ?? null,
    [templates],
  );
  const allBlowers = useMemo(
    () => lines.length > 0 && lines.every((l) => BLOWER_CATEGORIES.has(l.specs.category)),
    [lines],
  );
  const prevAllBlowers = useRef(allBlowers);
  useEffect(() => {
    const became = allBlowers && !prevAllBlowers.current;
    prevAllBlowers.current = allBlowers;
    if (!became || !editable) return;
    if (stdTemplateId) setTemplateId(stdTemplateId);
    setUnits({ capacity: "cfm", pressure: "in-w.g.", motor: "HP" });
  }, [allBlowers, stdTemplateId, editable]);

  const vatRate = config.vatRate;
  // KDK products follow the quote's VAT presentation like every other product
  // (priced VAT-exclusive when the quote is in an exclusive mode); the catalogue
  // price is stored VAT-inclusive and the mode strips/adds VAT for display.
  const effectiveVatMode = vatMode;
  // Gross (VAT-inclusive) line total. Normally qty × unit price; for the Duct
  // Angle corner it's VAT applied to the NET line total — round2(netUnit × qty)
  // × 1.12 — so the net matches the per-piece sheet exactly, with no per-unit
  // gross rounding drift at large quantities.
  const lineGross = (l: Line): number => {
    if (l.specs.category === "Ventilation Accessories" && l.specs.type === "Duct Angle corner") {
      const netUnit = round2(l.unitPrice / (1 + vatRate));
      return round2(round2(netUnit * l.qty) * (1 + vatRate));
    }
    return round2(l.qty * l.unitPrice);
  };
  const totals = useMemo(() => {
    const gross = lines.reduce((a, l) => a + lineGross(l), 0); // VAT-inclusive
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
        let srcQty = 1; // the referenced fan/blower's quantity
        for (let i = idx - 1; i >= 0; i--) {
          if (BLOWER_CATEGORIES.has(ls[i].specs.category)) { src = ls[i].specs; srcQty = ls[i].qty; break; }
        }
        // Isolator: recommend a spring set from the motor above. Number of springs
        // + per-spring capacity are computed per fan category; price is always the
        // foot-mounted price for that capacity. Qty = springs-per-unit × the fan's
        // quantity (e.g. 6 springs × 4 blowers = 24). Propeller types use no springs.
        if (isIsolator(l.specs)) {
          const motorKg = src?.motorHp != null ? MOTOR_WEIGHT_KG[src.motorHp] ?? null : null;
          const rec = src ? isolatorRecommend(src.category, src.type, motorKg) : null;
          const shape = "Foot Mounted"; // recommendation always uses the foot-mounted price
          const rated = rec && !rec.noSpring ? rec.rated : null;
          const sizeL = rated != null ? String(rated) : "";
          const qty = rec && rec.springs > 0 ? rec.springs * srcQty : l.qty;
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
        // Qty = one controller per fan unit (match the fan's quantity) for every
        // fan/blower, including Power Roof Ventilator and Wall Fan.
        const mcQty = src ? srcQty : l.qty;
        if (
          l.specs.bladeType === bladeType && l.specs.drive === drive && l.specs.motorPh === ph &&
          l.specs.motorPole === pole && l.specs.motorHp === hp && l.specs.motorVolts === volts &&
          l.unitPrice === unitPrice && l.qty === mcQty
        ) return l; // already in sync
        changed = true;
        const specs = { ...l.specs, bladeType, drive, motorPh: ph, motorPole: pole, motorHp: hp, motorVolts: volts };
        if (net != null) specs.bodyPrice = net;
        return {
          ...l,
          qty: mcQty,
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
  // Set a line's quantity; for Duct Angle corner, re-apply the volume discount so
  // the unit price steps with the 500 / 5,000 / 10,000 pc tiers.
  function updateQty(id: string, qty: number) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, qty };
        if (isDuctHardware(l.specs)) {
          const price = ductHardwareUnitPrice(l.specs, vatRate, qty);
          if (price != null) next.unitPrice = price;
        }
        return next;
      }),
    );
  }
  function updateSpec(id: string, patch: Partial<LineSpecs>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, specs: { ...l.specs, ...patch } } : l)));
  }
  // A Motor Controller's Qty is auto-set (and locked) from the fan above whenever
  // Recommend? is on and there is a fan/blower above — including Power Roof
  // Ventilator and Wall Fan.
  const mcQtyRecommended = (specs: LineSpecs, idx: number): boolean => {
    if (!isMotorController(specs) || !specs.mcRecommend) return false;
    for (let i = idx - 1; i >= 0; i--) {
      if (BLOWER_CATEGORIES.has(lines[i].specs.category)) return true;
    }
    return false;
  };
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
        // Mounting changed to one that doesn't offer the current capacity → clear it
        // (Housed Spring has a different kg range than Foot/Ceiling Mounted).
        if (patch.shape !== undefined && specs.sizeL && !isoCapsFor(specs.shape).includes(Number(specs.sizeL))) {
          specs.sizeL = "";
        }
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
        // Duct hardware (clips, cleats, corners): per-piece price by gauge (+ length),
        // with the Duct Angle corner volume discount applied by line quantity.
        if (isDuctHardware(specs)) {
          const price = ductHardwareUnitPrice(specs, vatRate, l.qty);
          return {
            ...l,
            specs,
            descriptionSnapshot: buildDuctHardwareDescription(specs),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Vent Cap: price by diameter + material; powder-coated shows its own price.
        if (isVentCap(specs)) {
          const price = ventCapUnitPrice(specs, vatRate);
          return {
            ...l,
            specs,
            descriptionSnapshot: buildAccessoryDescription(specs),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Duct Canvass Connector: per-meter price by material (box discount is
        // applied to the line total, not the unit).
        if (isCanvass(specs)) {
          const price = canvassUnitPrice(specs, vatRate);
          return {
            ...l,
            specs,
            descriptionSnapshot: buildCanvassDescription(specs),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Wind Driven Roof Ventilator: price by throat diameter × material.
        if (isWindVent(specs)) {
          const price = windVentUnitPrice(specs, vatRate);
          return {
            ...l,
            specs,
            descriptionSnapshot: buildWindVentDescription(specs),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Aluminum Duct: price by size (4/5/6/8 in × 10 m).
        if (isAluDuct(specs)) {
          const price = aluDuctUnitPrice(specs, vatRate);
          return {
            ...l,
            specs,
            descriptionSnapshot: buildAluDuctDescription(specs),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Portable Axial Blower / XProof: price by size × duct type. The fan config
        // carries the rating (capacity / static pressure / motor watts / 220 V),
        // filling the Capacity / S.P. / Motor columns; "Flexible Duct" is a bare
        // accessory (no rating). The size sets the Size column.
        if (isPortableBlowerFamily(specs)) {
          const flex = portableBlowerIsFlex(specs);
          const row = portableBlowerRow(specs);
          const withRating = !flex && row;
          const capUnit = normalizeAirflowUnit(units.capacity) ?? "cfm";
          const pUnit = normalizePressureUnit(units.pressure) ?? "pa";
          const s2: LineSpecs = {
            ...specs,
            inches: specs.sizeL ? Number(specs.sizeL) : null,
            capacity_cfm: withRating ? fmtFlow(convertAirflow(row!.cfm, "cfm", capUnit)) : null,
            staticPressure_pa: withRating ? Math.round(convertPressure(row!.pa, "pa", pUnit) * 100) / 100 : null,
            power_w: withRating ? row!.watt : null,
            motorHp: null,
            motorPole: null,
            motorPh: withRating ? 1 : null, // single-phase, 220 V
            motorVolts: withRating ? row!.volts : null,
          };
          const price = portableBlowerUnitPrice(s2, vatRate);
          return {
            ...l,
            specs: s2,
            descriptionSnapshot: buildPortableBlowerDescription(s2),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Variable Air Volume: price by the chosen duct (picked directly in "by Duct
        // Size" mode, or via Run selection in "by Volume Flow" mode). The SELLING
        // PRICE is already VAT-INCLUSIVE, so it is stored as-is. Fan columns stay
        // blank (VAV is described textually).
        if (isVav(specs)) {
          const s2: LineSpecs = { ...specs };
          s2.capacity_cfm = null;
          s2.staticPressure_pa = null;
          s2.inches = null;
          s2.power_w = null;
          s2.motorHp = null;
          s2.motorPole = null;
          s2.motorPh = 1; // single-phase, 220 V (VAV actuator supply reference)
          s2.motorVolts = 220;
          const row = vavRowForSize(s2.sizeL);
          const price = row ? row.price : null; // VAT-inclusive — stored as-is
          return {
            ...l,
            specs: s2,
            descriptionSnapshot: buildVavDescription(s2),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Induction Motor (TECO / Hyundai): price by phase × pole × HP from the
        // motor tables. Single phase and Hyundai are 4-pole only; drop an HP that
        // isn't valid for the resolved phase/pole. The motor's HP/phase/volts fill
        // the Motor columns; capacity / S.P. / size stay blank.
        if (isInductionMotor(specs)) {
          const s2: LineSpecs = { ...specs };
          if (isInductionHyundai(s2)) s2.motorPh = 3; // Hyundai is three-phase
          s2.motorPole = inductionPole(s2); // single / Hyundai → 4-pole
          if (s2.motorHp != null && !inductionHpOptions(s2).includes(s2.motorHp)) s2.motorHp = null;
          s2.motorVolts = 220;
          s2.capacity_cfm = null;
          s2.staticPressure_pa = null;
          s2.inches = null;
          s2.power_w = null;
          s2.bodyPrice = null;
          const price = inductionUnitPrice(s2, vatRate);
          return {
            ...l,
            specs: s2,
            descriptionSnapshot: buildInductionDescription(s2),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Jet Fan: price by model (MA-250 / MA-300). The model's rating fills the
        // Capacity / Static pressure / Motor columns (converted to the header
        // units); the description carries only type / brand / model.
        if (isJetFan(specs)) {
          const m = specs.blowerModel ? JET_FAN[specs.blowerModel] : null;
          let s2 = specs;
          if (m) {
            const capUnit = normalizeAirflowUnit(units.capacity) ?? "m3hr";
            const pUnit = normalizePressureUnit(units.pressure) ?? "pa";
            s2 = {
              ...specs,
              capacity_cfm: fmtFlow(convertAirflow(m.cmh, "m3hr", capUnit)),
              staticPressure_pa: Math.round(convertPressure(m.pa, "pa", pUnit) * 100) / 100,
              power_w: m.watt,
              motorHp: null,
              motorPole: null,
              motorPh: 1, // MAXAIR jet fans are single-phase, 220 V
              motorVolts: 220,
              inches: null,
            };
          }
          const price = jetFanUnitPrice(s2, vatRate);
          return {
            ...l,
            specs: s2,
            descriptionSnapshot: buildJetFanDescription(s2),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Motorized dampers: keep a valid operation — default to the first one
        // offered (open/close = spring return, 220 V) when unset or not available
        // for this type. Non-motorized accessories carry no operation.
        if (MOTORIZED_DAMPER_TYPES.has(specs.type)) {
          const opts = movementOptionsFor(specs.type);
          if (!specs.movement || !opts.includes(specs.movement)) specs.movement = opts[0];
        } else {
          specs.movement = undefined;
        }
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

  // Build a fresh, blank line item.
  function blankLine(): Line {
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
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
    };
  }
  // Add a fresh, blank line item at the end (saved on "Save changes"; DRAFT only).
  function addLine() {
    setLines((ls) => [...ls, blankLine()]);
  }
  // Insert a fresh, blank line item at a given position (between existing items).
  function insertLineAt(index: number) {
    setLines((ls) => [...ls.slice(0, index), blankLine(), ...ls.slice(index)]);
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
        const exp = specs.exproof === true;
        const net = computeUnitPrice(body, motor ? motorNetPrice(motor, exp) : 0, hp, phase);
        const gross = round2(net * (1 + vatRate));
        const mModel = motor ? motorModelCode(motor, voltageKey(specs.motorVolts), exp) : null;
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
        // Inline Duct Fan (Östberg CK): a whole unit selected by duty — take the
        // catalogue price (× VAT, no motor add-on), record its watts (single-phase,
        // 220 V), and build the Ostberg description. The entered flow / SP stay on
        // the line as the duty point.
        if (isInlineFan(l.specs)) {
          const base = cat?.basePrice ?? 0;
          const model = cat?.modelCode ?? l.specs.blowerModel;
          const specs: LineSpecs = {
            ...l.specs,
            bodyPrice: base,
            blowerModel: model,
            power_w: r.power_kw ? Math.round(r.power_kw * 10000) / 10 : l.specs.power_w,
            motorHp: null,
            motorPole: null,
            motorPh: 1,
            motorVolts: 220,
            inches: null,
          };
          return {
            ...l,
            specs,
            unitPrice: round2(base * (1 + vatRate)),
            descriptionSnapshot: buildInlineFanDescription(model),
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
        const exp = specs.exproof === true;
        const net = computeUnitPrice(body, motor ? motorNetPrice(motor, exp) : 0, hp, phase);
        const gross = round2(net * (1 + vatRate));
        const mModel = motor ? motorModelCode(motor, voltageKey(specs.motorVolts), exp) : null;
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
          lineTotal: lineGross(l),
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

  // Open a new revision: bump "rev. N" and reopen for editing.
  async function revise() {
    setBusy(true);
    setMsg(null);
    try {
      await reviseQuotation(quotation.id);
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
              } else if (type === "Portable Axial Blower" || type === "Portable Axial Blower (XProof)") {
                // Portable Axial Blower / XProof: size + duct type dropdowns, no
                // blade/drive/material. Duct type defaults to the fan config (held
                // in bladeType): standard "With Duct", XProof "With-out Duct".
                applyAccessory(
                  l.id,
                  { type, shape: "", sizeUnit: "", sizeL: "", sizeW: "", bladeType: portableBlowerDuctTypes({ type })[0], drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false },
                  true,
                );
              } else if (type === "Variable Air Volume") {
                // VAV: select by volume flow (value + unit) or by duct size. No
                // blade/drive/material. Defaults to selecting by volume flow in CFM.
                applyAccessory(
                  l.id,
                  { type, bladeType: "by Volume Flow", sizeUnit: "cfm", sizeL: "", sizeW: "", shape: "", drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false },
                  true,
                );
              } else if (type === "Induction Motor (TECO)" || type === "Induction Motor (Hyundai)") {
                // Induction Motor: Phase / Pole / HP selectors, priced from the
                // motor table. Defaults to three-phase, 4-pole (Hyundai is fixed
                // three-phase 4-pole); no blade/drive/material.
                applyAccessory(
                  l.id,
                  { type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "", sizeUnit: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false, motorPh: 3, motorPole: 4, motorHp: null, motorVolts: 220 },
                  true,
                );
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
              } else if (DUCT_HARDWARE_TYPES.has(type)) {
                // Clips / cleats / corners: priced per piece by gauge (+ length),
                // galvanized iron by default; clear any area-based selections.
                applyAccessory(
                  l.id,
                  { type, gauge: "", cleatSize: "", shape: "", sizeL: "", sizeW: "", sizeUnit: "", material: "Galvanized Iron", powderCoated: false },
                  true,
                );
              } else if (type === "Vent Cap") {
                // Vent Cap: fixed round diameters (inches) + stainless material.
                applyAccessory(
                  l.id,
                  { type, shape: "Round", sizeUnit: "inches", sizeL: "", sizeW: "", material: "", powderCoated: false },
                  true,
                );
              } else if (type === "Duct Canvass Connector") {
                // Canvass connector: material + per meter / per box pricing basis.
                applyAccessory(
                  l.id,
                  { type, shape: "", sizeL: "", sizeW: "", sizeUnit: "", gauge: "", cleatSize: "", material: "", canvassUnit: "per meter", powderCoated: false },
                  true,
                );
              } else if (type === "Wind Driven Roof Ventilator") {
                // Roof ventilator: throat diameter + material (manual price).
                applyAccessory(
                  l.id,
                  { type, shape: "Round", sizeUnit: "inches", sizeL: "", sizeW: "", bladeType: "", drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false },
                  true,
                );
              } else if (type === "Aluminum Duct") {
                // Aluminum duct: size dropdown, priced per size.
                applyAccessory(
                  l.id,
                  { type, shape: "", sizeUnit: "", sizeL: "", sizeW: "", bladeType: "", drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false },
                  true,
                );
              } else if (type === "Jet Fan") {
                // Jet fan: model dropdown (MAXAIR), priced per model.
                applyAccessory(
                  l.id,
                  { type, blowerModel: null, shape: "", sizeUnit: "", sizeL: "", sizeW: "", bladeType: "", drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false },
                  true,
                );
              } else if (type === "Inline Duct Fan") {
                // Seed the description now (type + brand); the model line is added
                // when a CK model is chosen via Run selection.
                setLines((ls) =>
                  ls.map((x) =>
                    x.id === l.id
                      ? {
                          ...x,
                          specs: { ...x.specs, type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "", blowerModel: null },
                          descriptionSnapshot: buildInlineFanDescription(null),
                        }
                      : x,
                  ),
                );
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
          {c.category === "Ventilation Accessories" && isDuctHardware(c) ? (
            // Duct hardware: gauge (+ length for cleats/clips) + material.
            <>
              <Select value={c.gauge || ""} disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { gauge: e.target.value })}>
                <option value="" disabled>Gauge…</option>
                {HW_GAUGES.map((g) => (
                  <option key={g} value={g}>Gauge {g} ({HW_GAUGE_THICKNESS[g]})</option>
                ))}
              </Select>
              {CLEAT_TYPES.has(c.type) && (
                <Select value={c.cleatSize || ""} disabled={!editable || !c.type}
                  onChange={(e) => applyAccessory(l.id, { cleatSize: e.target.value })}>
                  <option value="" disabled>Length…</option>
                  {cleatLengthsFor(c.type).map((s) => (<option key={s} value={s}>{s}</option>))}
                </Select>
              )}
              <Select
                value={HW_MATERIALS.includes(c.material) ? c.material : ""}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { material: e.target.value })}
              >
                <option value="" disabled>Material…</option>
                {HW_MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </Select>
            </>
          ) : c.category === "Ventilation Accessories" && isVentCap(c) ? (
            // Vent Cap: fixed round diameter + stainless material (no shape/L/W).
            <>
              <Select
                value={c.sizeL || ""}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { shape: "Round", sizeUnit: "inches", sizeL: e.target.value, sizeW: "" })}
              >
                <option value="" disabled>Diameter…</option>
                {VENT_CAP_DIAMETERS.map((d) => (<option key={d} value={d}>{d} in. diameter</option>))}
              </Select>
              <Select
                value={VENT_CAP_MATERIALS.includes(c.material) ? c.material : ""}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { material: e.target.value })}
              >
                <option value="" disabled>Material…</option>
                {VENT_CAP_MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </Select>
              <label className="flex h-9 items-center gap-1.5 text-sm">
                Powder Coated
                <input type="checkbox" className="h-4 w-4" disabled={!editable}
                  checked={!!c.powderCoated}
                  onChange={(e) => applyAccessory(l.id, { powderCoated: e.target.checked })} />
              </label>
            </>
          ) : isCanvass(c) ? (
            // Duct Canvass Connector: material + per meter / per box pricing basis.
            <>
              <Select
                value={CANVASS_MATERIALS.includes(c.material) ? c.material : ""}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { material: e.target.value })}
              >
                <option value="" disabled>Material…</option>
                {CANVASS_MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </Select>
              <Select
                value={CANVASS_UNITS.includes(c.canvassUnit ?? "") ? c.canvassUnit : ""}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { canvassUnit: e.target.value })}
              >
                <option value="" disabled>Unit…</option>
                {CANVASS_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
              </Select>
            </>
          ) : isWindVent(c) ? (
            // Wind Driven Roof Ventilator: throat diameter + material.
            <>
              <Select
                value={c.sizeL || ""}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { shape: "Round", sizeUnit: "inches", sizeL: e.target.value, sizeW: "" })}
              >
                <option value="" disabled>Throat Diameter…</option>
                {WIND_VENT_DIAMETERS.map((d) => (<option key={d} value={d}>{d} in</option>))}
              </Select>
              <Select
                value={WIND_VENT_MATERIALS.includes(c.material) ? c.material : ""}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { material: e.target.value })}
              >
                <option value="" disabled>Material…</option>
                {WIND_VENT_MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </Select>
            </>
          ) : isAluDuct(c) ? (
            // Aluminum Duct: size dropdown (per size × 10 m).
            <Select
              value={c.sizeL || ""}
              disabled={!editable || !c.type}
              onChange={(e) => applyAccessory(l.id, { sizeL: e.target.value, sizeW: "" })}
            >
              <option value="" disabled>Size…</option>
              {ALU_DUCT_SIZES.map((s) => (<option key={s} value={s}>{aluDuctSizeLabel(s)}</option>))}
            </Select>
          ) : isPortableBlowerFamily(c) ? (
            // Portable Axial Blower / XProof: fan-size dropdown (inches) + duct type.
            <>
              <Select
                value={c.sizeL || ""}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { sizeL: e.target.value, sizeW: "" })}
              >
                <option value="" disabled>Size…</option>
                {portableBlowerSizes(c).map((s) => (<option key={s} value={s}>{portableBlowerSizeLabel(s)}</option>))}
              </Select>
              <Select
                value={portableBlowerDuctTypes(c).includes(c.bladeType) ? c.bladeType : portableBlowerDuctTypes(c)[0]}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { bladeType: e.target.value })}
              >
                {portableBlowerDuctTypes(c).map((d) => (<option key={d} value={d}>{d}</option>))}
              </Select>
            </>
          ) : isVav(c) ? (
            // Variable Air Volume: select by volume flow (value + unit) or by duct size.
            <>
              <Select
                value={VAV_SELECT_MODES.includes(c.bladeType) ? c.bladeType : "by Volume Flow"}
                disabled={!editable || !c.type}
                onChange={(e) => applyAccessory(l.id, { bladeType: e.target.value })}
              >
                {VAV_SELECT_MODES.map((m) => (<option key={m} value={m}>{m}</option>))}
              </Select>
              {c.bladeType === "by Duct Size" ? (
                <Select
                  value={c.sizeL || ""}
                  disabled={!editable || !c.type}
                  onChange={(e) => applyAccessory(l.id, { sizeL: e.target.value })}
                >
                  <option value="" disabled>Duct size…</option>
                  {VAV_ROWS.map((r) => (<option key={r.in} value={r.in}>{vavDuctLabel(r)}</option>))}
                </Select>
              ) : (
                <>
                  <Input type="number" step="any" placeholder="Volume flow…"
                    disabled={!editable || !c.type} value={c.sizeW}
                    onChange={(e) => applyAccessory(l.id, { sizeW: e.target.value })} />
                  <Select
                    value={c.sizeUnit || "cfm"}
                    disabled={!editable || !c.type}
                    onChange={(e) => applyAccessory(l.id, { sizeUnit: e.target.value })}
                  >
                    {CAPACITY_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
                  </Select>
                </>
              )}
            </>
          ) : isInductionMotor(c) ? (
            // Induction Motor: Phase, Pole (hidden when single-phase / Hyundai), HP.
            <>
              <Select
                value={c.motorPh ?? 3}
                disabled={!editable || !c.type || isInductionHyundai(c)}
                onChange={(e) => applyAccessory(l.id, { motorPh: numOrNull(e.target.value) })}
              >
                {inductionPhaseOptions(c).map((p) => (
                  <option key={p} value={p}>{p === 1 ? "Single phase" : "Three phase"}</option>
                ))}
              </Select>
              {c.motorPh === 3 && !isInductionHyundai(c) ? (
                <Select
                  value={c.motorPole ?? 4}
                  disabled={!editable || !c.type}
                  onChange={(e) => applyAccessory(l.id, { motorPole: numOrNull(e.target.value) })}
                >
                  {[2, 4, 6].map((p) => (<option key={p} value={p}>{p}-pole</option>))}
                </Select>
              ) : (
                // Single phase / Hyundai are 4-pole only — a disabled dropdown
                // (matching the phase select) reads better than bare text.
                <Select value={4} disabled>
                  <option value={4}>4-pole</option>
                </Select>
              )}
              <Select
                value={c.motorHp ?? ""}
                disabled={!editable || !c.type || !c.motorPh}
                onChange={(e) => applyAccessory(l.id, { motorHp: numOrNull(e.target.value) })}
              >
                <option value="" disabled>HP…</option>
                {inductionHpOptions(c).map((hp) => (<option key={hp} value={hp}>{hp} HP</option>))}
              </Select>
            </>
          ) : isJetFan(c) ? (
            // Jet Fan: model dropdown (MAXAIR MA series).
            <Select
              value={c.blowerModel || ""}
              disabled={!editable || !c.type}
              onChange={(e) => applyAccessory(l.id, { blowerModel: e.target.value || null })}
            >
              <option value="" disabled>Model…</option>
              {JET_FAN_MODELS.map((m) => (<option key={m} value={m}>{m}</option>))}
            </Select>
          ) : c.category === "Ventilation Accessories" ? (
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
                  {isoCapsFor(c.shape).map((cap) => (
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
              {/* Operation — motorized dampers only (options vary by type). */}
              {MOTORIZED_DAMPER_TYPES.has(c.type) && (
                <Select
                  value={c.movement || ""}
                  disabled={!editable || !c.type}
                  onChange={(e) => applyAccessory(l.id, { movement: e.target.value })}
                >
                  <option value="" disabled>Operation…</option>
                  {movementOptionsFor(c.type).map((m) => (
                    <option key={m} value={m}>{MOVEMENT_LABEL[m] ?? m}</option>
                  ))}
                </Select>
              )}
            </>
          ) : isPrebuiltUnit(c) || isMotorController(c) || isInlineFan(c) ? (
            // KDK pre-built units, Motor Controllers, and the Inline Duct Fan
            // (selected by duty) have no blade type / drive / material.
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
              Ventilation Accessories, or the canvass connector (its own material). */}
          {!isPrebuiltUnit(c) && !isMotorController(c) && !isCanvass(c) && !isWindVent(c) && !isAluDuct(c) && !isPortableBlowerFamily(c) && !isVav(c) && !isInductionMotor(c) && !isInlineFan(c) && !isJetFan(c) && c.category !== "Ventilation Accessories" && (
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
                : isPortableBlowerFamily(c)
                  ? "Category · Brand · Type · Size (inches) · Duct type — auto-priced (editable)."
                  : isVav(c)
                    ? "Category · Brand · Type · select by volume flow or by duct size — auto-priced (VAT incl., editable)."
                    : isInductionMotor(c)
                      ? "Category · Brand · Type · Phase · Pole · HP — auto-priced (editable)."
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
              {quotation.revision > 0 && (
                <span className="ml-2 align-middle text-base font-semibold text-muted-foreground">rev. {quotation.revision}</span>
              )}
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
            <Select
              value={templateId}
              onChange={(e) => {
                const id = e.target.value;
                setTemplateId(id);
                // Switching pattern always resets the spec note + terms to the
                // chosen pattern's own text, clearing any prior carry-over so the
                // quote strictly follows the selected template.
                const t = templates.find((tpl) => tpl.id === id);
                if (t) {
                  setNotes(t.specNote);
                  setTerms(t.terms);
                }
              }}
              disabled={!editable}
            >
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
              {editable && idx > 0 && (
                // Small insert control floating in the gap above this card, so it
                // adds a line here without changing the cards' spacing.
                <button
                  type="button"
                  title="Insert an item here"
                  onClick={() => insertLineAt(idx)}
                  className="absolute -top-3 left-1/2 z-20 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
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
                  {/* Recommend? sets Qty from the fan above (isolator = springs × fan qty,
                      motor controller = fan qty), so it is locked while recommend is on. */}
                  <Input className="h-8 text-right" type="number" min={1} value={l.qty}
                    disabled={!editable || (isIsolator(l.specs) && !!l.specs.mcRecommend) || mcQtyRecommended(l.specs, idx)}
                    onChange={(e) => updateQty(l.id, Math.max(1, Number(e.target.value) || 1))} />
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
              ) : isMotorController(l.specs) || isIsolator(l.specs) || isAccessory(l.specs) || isCanvass(l.specs) || isWindVent(l.specs) || isAluDuct(l.specs) || isPortableBlowerFamily(l.specs) || isVav(l.specs) || isInductionMotor(l.specs) || isJetFan(l.specs) ? null : (
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

              {/* Propeller Type is a low-pressure fan — when the admin lock is on,
                  cap static pressure at 0.5" w.g. (converted to the chosen unit) and
                  warn when the entry exceeds it. */}
              {propellerSpLock && propellerSpOverLimit(l.specs, units.pressure) && (() => {
                const pu = normalizePressureUnit(units.pressure) ?? "inwg";
                const maxInUnit = Math.round(convertPressure(0.5, "inwg", pu) * 100) / 100;
                const label = pu === "inwg" ? "0.5 in-w.g." : `${maxInUnit} ${units.pressure} (0.5 in-w.g.)`;
                return (
                  <p className="mt-1 text-xs text-destructive">
                    Maximum static pressure for Propeller Type is {label}. Lower it to run the selection.
                  </p>
                );
              })()}

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

              {/* VAV duct selector (by-Volume-Flow mode) — Run selection lists the
                  ducts whose airflow range covers the entered flow; the sales picks
                  which model to quote. Collapses to a one-line summary once picked. */}
              {editable && isVav(l.specs) && l.specs.bladeType === "by Volume Flow" && (() => {
                const sel = vavRowForSize(l.specs.sizeL);
                // Collapsed summary once a duct is picked (until Run selection re-opens it).
                if (sel && !vavRan[l.id]) {
                  return (
                    <div className="mt-2 flex items-center justify-between rounded-md border border-dashed p-2">
                      <span className="text-xs font-medium">
                        Selected: Ø {sel.mm} mm ({sel.in} in) · {formatCurrency(round2(sel.price), quotation.currency)}
                      </span>
                      <Button size="sm" variant="outline"
                        onClick={() => setVavRan((m) => ({ ...m, [l.id]: true }))}>
                        <Gauge className="h-3.5 w-3.5" /> Run selection
                      </Button>
                    </div>
                  );
                }
                return (
                  <div className="mt-2 rounded-md border border-dashed p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        VAV duct selector — units that can handle the entered volume flow
                      </span>
                      <Button size="sm" variant="outline"
                        onClick={() => setVavRan((m) => ({ ...m, [l.id]: true }))}>
                        <Gauge className="h-3.5 w-3.5" /> Run selection
                      </Button>
                    </div>
                    {vavRan[l.id] && (() => {
                      const val = l.specs.sizeW ? Number(l.specs.sizeW) : NaN;
                      if (Number.isNaN(val) || val <= 0)
                        return <p className="mt-1 text-xs text-muted-foreground">Enter a volume flow above.</p>;
                      const picks = vavPicks(l.specs);
                      if (picks.length === 0)
                        return <p className="mt-1 text-xs text-destructive">Volume flow exceeds the largest duct (24 in).</p>;
                      return (
                        <div className="mt-2 space-y-1">
                          {picks.map((r, i) => {
                            const isRec = i === 0;
                            const isSel = l.specs.sizeL === r.in;
                            return (
                              <button key={r.in} type="button"
                                onClick={() => { applyAccessory(l.id, { sizeL: r.in }); setVavRan((m) => ({ ...m, [l.id]: false })); }}
                                className={`w-full rounded-md border p-2 text-left text-xs hover:bg-accent ${isSel ? "border-primary ring-1 ring-primary" : isRec ? "border-primary/50" : ""}`}>
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">
                                    Ø {r.mm} mm ({r.in} in)
                                    {isRec && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">RECOMMENDED</span>}
                                    {isSel && <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">SELECTED</span>}
                                  </span>
                                  <span className="font-medium">{formatCurrency(round2(r.price), quotation.currency)}</span>
                                </div>
                                <p className="text-muted-foreground">
                                  Airflow {r.lpsMin}–{r.lpsMax} L/s · {r.cfmMin}–{r.cfmMax} CFM · {r.cmhMin}–{r.cmhMax} CMH
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* Per-line fan selector — click a candidate to populate this item.
                  Air curtains and Motor Controllers aren't duty-selected. */}
              {editable && !isAirCurtain(l.specs) && !isMotorController(l.specs) && !isIsolator(l.specs) && !isAccessory(l.specs) && !isCanvass(l.specs) && !isWindVent(l.specs) && !isAluDuct(l.specs) && !isPortableBlowerFamily(l.specs) && !isVav(l.specs) && !isInductionMotor(l.specs) && !isJetFan(l.specs) && (
                <div className="mt-2 rounded-md border border-dashed p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Fan selector — uses {isFlowOnlyUnit(l.specs) ? "Capacity (volume flow only)" : "Capacity + S.P."} above
                    </span>
                    <Button size="sm" variant="outline" onClick={() => runLineSelection(l)}
                      disabled={sel[l.id]?.loading || (propellerSpLock && propellerSpOverLimit(l.specs, units.pressure))}>
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
              ) : isAccessory(l.specs) || isCanvass(l.specs) || isWindVent(l.specs) || isAluDuct(l.specs) || isPortableBlowerFamily(l.specs) || isVav(l.specs) || isInductionMotor(l.specs) || isJetFan(l.specs) ? (
                // Air Terminals / Dampers: per-square-inch body price + manual override.
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="flex flex-col justify-end gap-1 md:col-span-3">
                    {isJetFan(l.specs) && l.specs.blowerModel && JET_FAN[l.specs.blowerModel] && (
                      <p className="text-xs font-medium text-foreground">
                        Volume flow {JET_FAN[l.specs.blowerModel].cmh} CMH · Static pressure {JET_FAN[l.specs.blowerModel].pa} Pa · {JET_FAN[l.specs.blowerModel].watt} W
                      </p>
                    )}
                    {isPortableBlowerFamily(l.specs) && !portableBlowerIsFlex(l.specs) && portableBlowerRow(l.specs) && (() => {
                      const r = portableBlowerRow(l.specs)!;
                      return (
                        <p className="text-xs font-medium text-foreground">
                          Volume flow {r.cfm} cfm · Static pressure {r.pa} Pa · {r.watt} W · {r.rpm} rpm · 220 V
                        </p>
                      );
                    })()}
                    {isVav(l.specs) && (() => {
                      const r = vavRowForSize(l.specs.sizeL);
                      return (
                        <>
                          {r && (
                            <p className="text-xs font-medium text-foreground">
                              Duct Ø {r.mm} mm ({r.in} in) · Airflow {r.lpsMin}–{r.lpsMax} L/s · {r.cfmMin}–{r.cfmMax} CFM · {r.cmhMin}–{r.cmhMax} CMH
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground">{VAV_ACTUATOR_NOTE}</p>
                          <p className="text-[11px] text-muted-foreground">{VAV_THERMOSTAT_NOTE}</p>
                        </>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        if (isWindVent(l.specs)) {
                          const net = windVentNet(l.specs);
                          if (net == null) return "Pick throat diameter and material to auto-price.";
                          return `₱${net.toLocaleString()} / pc (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isAluDuct(l.specs)) {
                          const net = aluDuctNet(l.specs);
                          if (net == null) return "Pick a size to auto-price.";
                          return `₱${net.toLocaleString()} / ${aluDuctSizeLabel(l.specs.sizeL)} (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isPortableBlowerFamily(l.specs)) {
                          const net = portableBlowerNet(l.specs);
                          if (net == null)
                            return l.specs.sizeL
                              ? "No list price for this size — enter it manually."
                              : "Pick a size to auto-price.";
                          const dt = (l.specs.bladeType || "").toLowerCase() || (portableBlowerIsFlex(l.specs) ? "flexible duct" : "with duct");
                          return `₱${net.toLocaleString()} / pc (${dt}, VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isVav(l.specs)) {
                          const row = vavRowForSize(l.specs.sizeL);
                          if (row == null)
                            return l.specs.bladeType === "by Duct Size"
                              ? "Pick a duct size to auto-price."
                              : "Enter a volume flow, then Run selection to choose a duct.";
                          return `₱${row.price.toLocaleString()} / unit — ${row.mm} mm (${row.in} in), VAT incl. = auto-priced (editable).`;
                        }
                        if (isInductionMotor(l.specs)) {
                          const m = inductionMotorRow(l.specs);
                          if (m == null) return "Pick phase, pole and HP to auto-price.";
                          return `₱${m.price.toLocaleString()} / unit (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isJetFan(l.specs)) {
                          const net = jetFanNet(l.specs);
                          if (net == null) return "Pick a model to auto-price.";
                          return `₱${net.toLocaleString()} / pc (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isCanvass(l.specs)) {
                          const net = canvassNet(l.specs);
                          if (net == null) return "Pick a material and unit to auto-price.";
                          const perBox = l.specs.canvassUnit === "per box";
                          const basis = perBox ? `box (${CANVASS_BOX_METERS} m, less 2,500)` : "meter";
                          const qtyNote = perBox ? "boxes" : "meters";
                          return `₱${net} / ${basis} (VAT ex) × 1.12 = auto-priced (editable). Qty = ${qtyNote}.`;
                        }
                        if (isVentCap(l.specs)) {
                          const net = ventCapNet(l.specs);
                          if (net == null)
                            return l.specs.powderCoated
                              ? "Pick a diameter to auto-price."
                              : "Pick a diameter and material to auto-price.";
                          const min = l.specs.powderCoated ? " (powder coated, 100 pcs min)" : "";
                          return `₱${net} / pc${min} (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isDuctHardware(l.specs)) {
                          const net = ductHardwareNet(l.specs, l.qty);
                          if (net == null)
                            return CLEAT_TYPES.has(l.specs.type)
                              ? "Pick gauge and length to auto-price."
                              : "Pick a gauge to auto-price.";
                          let discNote = "";
                          if (l.specs.type === "Duct Angle corner") {
                            const f = angleCornerDiscountFactor(l.qty);
                            if (f < 1) discNote = ` (−${+((1 - f) * 100).toFixed(1)}% at ${l.qty} pcs)`;
                          }
                          return `₱${net} / pc${discNote} (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        const rate = accessoryRate(l.specs.type, l.specs.shape);
                        const area = accBilledAreaSqIn(l.specs);
                        const mat = ACC_MATERIAL_FACTOR[l.specs.material];
                        if (rate == null) return "Enter the unit price manually — this type isn't auto-priced yet.";
                        if (area == null || mat == null) return "Pick shape, dimensions and material to auto-price.";
                        const minNote = area <= ACC_MIN_SQIN ? " (100 sq in min)" : "";
                        const flat = accFlatAdd(l.specs.type);
                        const isMotor = MOTORIZED_DAMPER_TYPES.has(l.specs.type);
                        const act = actuatorSummary(l.specs);
                        const actNote = isMotor
                          ? l.specs.movement
                            ? act
                              ? ` + actuator ${act.total} (${act.nm}NM ${act.model}, ${act.voltage}, ×${act.sections})`
                              : ""
                            : " — pick Operation to add the actuator"
                          : "";
                        const pf = accPowderFactor(l.specs.type);
                        const bodyDesc = l.specs.powderCoated
                          ? `${round2(area)} sq in${minNote} × ${rate} × ${pf} powder-coat (GI base)${l.specs.material === "Aluminum" ? ` + area × ${rate} × 2 aluminum` : ""}`
                          : `${round2(area)} sq in${minNote} × ${rate} × ${mat} (${l.specs.material})`;
                        return `${bodyDesc}${flat ? ` + ${flat} fusible link` : ""}${actNote} = auto-priced (editable).`;
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
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-7">
                <div>
                  <Label className="text-[10px]">Body ₱ (net)</Label>
                  <Input className="h-8 text-right" type="number" step="0.01" disabled={!editable}
                    value={l.specs.bodyPrice ?? ""}
                    onChange={(e) => applyMotor(l.id, { bodyPrice: numOrNull(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-[10px]">Phase</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorPh ?? ""}
                    onChange={(e) => {
                      const ph = numOrNull(e.target.value);
                      // Explosion-proof is 3-phase only — drop the EX flag off 3-phase.
                      applyMotor(l.id, { motorPh: ph, ...(ph !== 3 ? { exproof: false } : {}) });
                    }}>
                    <option value="">—</option>
                    <option value="1">1-phase</option>
                    <option value="3">3-phase</option>
                  </Select>
                </div>
                <div>
                  {/* Pole defaults to 4 and is auto-set from the fan rpm on selection
                      (belt = 4-pole); the sales only changes it when necessary. */}
                  <Label className="text-[10px]">Pole</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorPole ?? 4}
                    onChange={(e) => {
                      const p = numOrNull(e.target.value);
                      // Explosion-proof is 4-pole only — drop the EX flag off 4-pole.
                      applyMotor(l.id, { motorPole: p, ...(p !== 4 ? { exproof: false } : {}) });
                    }}>
                    <option value="4">4-pole</option>
                    <option value="2">2-pole</option>
                    <option value="6">6-pole</option>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Explosion proof</Label>
                  {l.specs.motorPh === 3 && (l.specs.motorPole ?? 4) === 4 ? (
                    <label className="flex h-8 items-center gap-1.5 text-xs">
                      <input type="checkbox" className="h-4 w-4" disabled={!editable}
                        checked={!!l.specs.exproof}
                        onChange={(e) => {
                          const on = e.target.checked;
                          // EX only lists HPs with a published EX price — drop a non-EX HP.
                          const dropHp = on && l.specs.motorHp != null && !hasExproofPrice(l.specs.motorHp);
                          applyMotor(l.id, { exproof: on, ...(dropHp ? { motorHp: null } : {}) });
                        }} />
                      EX motor
                    </label>
                  ) : (
                    <div className="flex h-8 items-center text-[11px] text-muted-foreground">4-pole 3-ph only</div>
                  )}
                </div>
                <div>
                  <Label className="text-[10px]">Motor HP</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorHp ?? ""}
                    onChange={(e) => applyMotor(l.id, { motorHp: numOrNull(e.target.value) })}>
                    <option value="">—</option>
                    {(l.specs.exproof
                      ? hpOptions(l.specs.motorPh ?? 3, 4).filter(hasExproofPrice)
                      : hpOptions(l.specs.motorPh ?? 3, l.specs.motorPole ?? 4)
                    ).map((hp) => (
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
              {!isPrebuiltUnit(l.specs) && !isMotorController(l.specs) && !isIsolator(l.specs) && !isAccessory(l.specs) && !isCanvass(l.specs) && !isWindVent(l.specs) && !isAluDuct(l.specs) && !isPortableBlowerFamily(l.specs) && !isVav(l.specs) && !isInductionMotor(l.specs) && !isJetFan(l.specs) && (() => {
                const hp = l.specs.motorHp ?? 0;
                const ph = l.specs.motorPh ?? 0;
                const pole = l.specs.motorPole ?? 4;
                const exp = l.specs.exproof === true;
                const motor = hp && ph ? lookupMotor(hp, ph, pole) : undefined;
                const mModel = motor ? motorModelCode(motor, voltageKey(l.specs.motorVolts), exp) : null;
                const db = dynamicBalancingApplies(hp, ph);
                const isBlower = !!(l.specs.bodyPrice && l.specs.bodyPrice > 0);
                return (
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {isBlower &&
                      (hp && ph ? (
                        motor ? (
                          <>
                            <span>Motor {mModel ?? "—"}{exp ? " (EX)" : ""}: {formatCurrency(motorNetPrice(motor, exp), quotation.currency)}</span>
                            {exp && !hasExproofPrice(hp) && <span className="text-amber-600">EX price N/A for {hp} HP — using standard</span>}
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
                      Amount: <b>{formatCurrency(lineGross(l), quotation.currency)}</b>
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

      {/* Sale & payment — record the PO, payments collected, and proofs. */}
      {(quotation.status === "APPROVED" || quotation.status === "SENT" || isSaleConfirmed(quotation.sale) || !!quotation.sale) && (
        <SalePanel
          quotationId={quotation.id}
          currency={quotation.currency}
          dealTotal={totals.grandTotal}
          initialSale={quotation.sale}
          canEdit={(isPreparer || isAdmin) && quotation.status !== "DRAFT" && quotation.status !== "PENDING_APPROVAL"}
        />
      )}

      {/* Revision history — retained snapshots of superseded versions. */}
      {revisionHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Revision history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...revisionHistory].reverse().map((r) => (
              <details key={r.rev} className="rounded-md border">
                <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium">
                  rev. {r.rev} · {new Date(r.savedAt).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {formatCurrency(round2(r.total), quotation.currency)}
                </summary>
                <div className="border-t px-3 py-2">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-1 pr-2 font-medium">#</th>
                        <th className="py-1 pr-2 font-medium">Description</th>
                        <th className="py-1 pr-2 text-right font-medium">Qty</th>
                        <th className="py-1 pr-2 text-right font-medium">Unit ₱</th>
                        <th className="py-1 text-right font-medium">Total ₱</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.lines.map((ln, i) => (
                        <tr key={i} className="border-t align-top">
                          <td className="py-1 pr-2">{ln.itemLabel || i + 1}</td>
                          <td className="py-1 pr-2 whitespace-pre-wrap">{ln.description}</td>
                          <td className="py-1 pr-2 text-right">{ln.qty}</td>
                          <td className="py-1 pr-2 text-right">{formatCurrency(round2(ln.unitPrice), quotation.currency)}</td>
                          <td className="py-1 text-right">{formatCurrency(round2(ln.lineTotal), quotation.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      )}

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
          {/* Revise a finalized quote: bump rev. N and reopen for editing.
              The preparer or an admin may revise it. */}
          {(isPreparer || isAdmin) && (quotation.status === "APPROVED" || quotation.status === "SENT") && (
            <Button variant="outline" onClick={revise} disabled={busy}>
              <RotateCcw className="h-4 w-4" /> Revise
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
