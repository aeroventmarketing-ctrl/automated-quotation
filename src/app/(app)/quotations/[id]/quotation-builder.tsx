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
import { applyPricing, DEFAULT_PRICING, type PricingAdjust, type AdjustMode } from "@/lib/quote";
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
import { TECO_MOTOR_DATA, TECO_KW_BY_HP } from "@/lib/teco-motor-data";
import { Download, Send, Check, CornerUpLeft, Trash2, Gauge, Plus, RotateCcw, Search, AlertTriangle } from "lucide-react";
import { PRODUCT_CATEGORIES, PRODUCT_TAXONOMY, typesFor, entryFor, bladeTypesFor, brandsFor, seriesFor, groupsFor, groupForType } from "@/lib/product-taxonomy";
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
import {
  GI_SHEET_PRICE,
  BLACK_IRON_SHEET_PRICE,
  STAINLESS_SHEET_PRICE,
  AIR_DUCT_LABOR_PER_SHEET,
} from "@/lib/air-duct-pricing-reference";
import { updateQuotationLines, transitionQuotation, reviseQuotation, checkDuplicateQuote } from "../actions";
import type { DuplicateMatch } from "@/lib/quote-duplicates";
import { SimilarQuotes } from "./similar-quotes";
import { SalePanel } from "./sale-panel";
import { isSaleConfirmed, type SaleRecord } from "@/lib/sale";
import { updateQuoteNumber } from "../../admin/actions";

// --- Product search -----------------------------------------------------------
// A flat, searchable index of every product (one per taxonomy entry). Selecting a
// result pre-fills the leading dropdowns: category, then the brand/group field
// (grouped categories store the group in `brand`; branded categories store the
// brand there), then the Type — after which the remaining dropdowns are chosen
// as usual.
interface ProductSearchItem {
  category: string;
  brandField: string; // value for the `brand` spec field (group or brand, else "")
  type: string;
  label: string;
  sublabel: string;
  search: string;
}
const PRODUCT_SEARCH_INDEX: ProductSearchItem[] = PRODUCT_TAXONOMY.map((e) => {
  const brandField = e.group ?? e.brand ?? "";
  const context = [e.category, e.group, e.brand].filter(Boolean).join(" › ");
  return {
    category: e.category,
    brandField,
    type: e.type,
    label: e.type,
    sublabel: context,
    search: `${e.type} ${e.category} ${e.group ?? ""} ${e.brand ?? ""}`.toLowerCase(),
  };
});

/** Type-ahead product search. Calls onSelect with the chosen taxonomy entry. */
function ProductSearch({ disabled, onSelect }: { disabled?: boolean; onSelect: (item: ProductSearchItem) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const terms = query.split(/\s+/);
    return PRODUCT_SEARCH_INDEX.filter((it) => terms.every((t) => it.search.includes(t))).slice(0, 12);
  }, [q]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        disabled={disabled}
        placeholder="Search a product to auto-fill the selection…"
        className="pl-8"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-background shadow-lg">
          {results.map((it, i) => (
            <button
              key={`${it.category}|${it.brandField}|${it.type}|${i}`}
              type="button"
              className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left last:border-b-0 hover:bg-muted"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(it); setQ(""); setOpen(false); }}
            >
              <span className="text-sm font-medium">{it.label}</span>
              <span className="text-xs text-muted-foreground">{it.sublabel}</span>
            </button>
          ))}
        </div>
      )}
      {open && q.trim() && results.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground shadow-lg">
          No product matches “{q.trim()}”.
        </div>
      )}
    </div>
  );
}

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
  // Straight Duct price calculator: the flat sheet blank dimensions (inches).
  ductCalcLength?: string;
  ductCalcWidth?: string;
  ductCalcHeight?: string; // Duct Reducer: reducer height "H" (standard 4"; material scales H ÷ 4)
  ductCalcOffset?: string; // Offset Duct: the offset "O" (4th dimension)
  ductNoFlange?: boolean; // Straight Duct: no angle-iron flange (drops the 15×8 corner cost; body 1.2 m vs flanged 1.1 m)
  ductPainted?: boolean; // Duct calc (Black Iron only): painted finish, +30% on the duct price
  fabricMaterial?: string; // Duct Connector: canvas fabric (Fiberglass Cloth / PVC / Silicone), priced per meter
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
  // Customized (bespoke) unit: body priced ×1.2 (a +20% uplift on the base body).
  customizedUnit?: boolean;
  // Separate blade material: when off the blade is standard Black Iron Sheet;
  // when on, `bladeMaterial` scales the blade half of the body.
  bladeMaterialOn?: boolean;
  bladeMaterial?: string;
  // Paint upgrade: adds a black-iron-base charge (Powder Coat ×1.5 / High Temp ×1.3).
  upgradePaint?: boolean;
  paintType?: string;
}
/** Fan/blower categories a Motor Controller can take its motor details from. */
const BLOWER_CATEGORIES = new Set([
  "Centrifugal Type",
  "Axial Type",
  "Propeller Type",
  "Tubular Inline Type",
  "Cabinet Type",
]);
// --- Auto template selection by product hierarchy ---------------------------
// A quote's template follows the highest-priority product family present:
// Standard Fans & Blowers > KDK > Air Terminals & Ducts. The mapping is by
// product category (per the client's template↔product list):
//   • Standard      → the five blower categories (Centrifugal / Axial /
//                      Propeller / Tubular Inline / Cabinet).
//   • Air Terminals → the whole Ventilation Accessories category + Aluminum Duct.
//   • KDK           → the whole Other Products category except Aluminum Duct
//                      (Aerovent "Other Products" + AlphaAir + KDK-brand units).
// The Power Roof Ventilator / Wind Driven Roof Vent / Services patterns are
// installation-service quotes with no product trigger, so they stay manual-only.
const TEMPLATE_FAMILY_PRIORITY = ["standard", "kdk", "air_terminals"] as const;
/** The template family a single line belongs to (null = no product match). */
function templateFamilyForLine(specs: { category: string; type: string }): string | null {
  const { category, type } = specs;
  // Aluminum Duct is catalogued under Other Products but quotes under Air Terminals.
  if (type === "Aluminum Duct") return "air_terminals";
  if (category === "Ventilation Accessories") return "air_terminals";
  if (category === "Other Products") return "kdk";
  if (BLOWER_CATEGORIES.has(category)) return "standard";
  return null;
}
/** Highest-priority template layoutKey implied by the line mix (null if none). */
function autoTemplateLayoutKey(specsList: { category: string; type: string }[]): string | null {
  const present = new Set(specsList.map(templateFamilyForLine).filter(Boolean) as string[]);
  return TEMPLATE_FAMILY_PRIORITY.find((k) => present.has(k)) ?? null;
}
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
  pricing: PricingAdjust;
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
/** Customized Jet Fan reuses the Tubeaxial (TAF) catalogue but is badged "JF". */
const isCustomJetFan = (specs: { type: string }): boolean => specs.type === "Customized Jet Fan";
/**
 * Sellable model code. Backplate Paddle Wheel is stored internally as …CMB so its
 * selection list stays separate from Paddle Wheel's …CMH catalogue, but it shares
 * AeroVent's real "CMH" model number — so show CMH wherever the code is
 * user-facing (selection list, description, quote). CMB is unique to backplate,
 * so the swap never touches another catalogue's code.
 */
const sellableModelCode = (code: string): string => code.replace(/CMB/i, "CMH");
/** Displayed model code — swaps the "TAF" tag for "JF" on a Customized Jet Fan. */
function displayBlowerModel(specs: { blowerModel: string | null; drive: string; type: string }): string {
  const m = effectiveBlowerModel(specs.blowerModel, specs.drive);
  return sellableModelCode(isCustomJetFan(specs) ? m.replace(/TAF/i, "JF") : m);
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
const AXIAL_FAN_TYPES = new Set(["Tubeaxial", "Vaneaxial", "Customized Jet Fan"]);
// KDK pre-built units: selected by model (no blade type / drive / material).
// They follow the quote's VAT presentation like any other product. The
// "KDK - Ceiling Cassette" alias covers quotes saved during the brief window
// the brand was part of the type name.
const KDK_TYPES = new Set(["Ceiling Cassette", "KDK - Ceiling Cassette"]);
// Pre-built units (whole catalogue items) hide blade type / drive / material and
// are chosen by duty via the fan selector. This covers the KDK brand and every
// Ceiling Cassette (KDK and AlphaAir share the same selection flow; only their
// catalogue models / ratings / prices differ).
const isPrebuiltUnit = (specs: { brand: string; type: string }): boolean =>
  specs.brand === "KDK" || specs.type === "Ceiling Cassette" || specs.type === "KDK - Ceiling Cassette";
/** Shutter Series wall fans select on air volume only — static pressure is N/A. */
const isFlowOnlyUnit = (specs: { type: string; bladeType: string }): boolean =>
  specs.type === "Wall Mounted Fan" && specs.bladeType === "Shutter Series";
// Static-pressure caps (in-w.g.) for the low-pressure fan types, each governed by
// an admin toggle: Propeller Type → 0.5, Tubeaxial → 1.5, Vaneaxial → 4. Axial caps
// apply by type (both Axial Type and Tubular Inline Type Tubeaxial/Vaneaxial).
const spCapInWg = (specs: { category: string; type: string }): number | null => {
  if (specs.category === "Propeller Type") return 0.5;
  if (specs.type === "Tubeaxial") return 1.5;
  if (specs.type === "Vaneaxial") return 4;
  return null;
};
/** Which admin lock governs this type's SP cap. */
const spLockGroup = (specs: { category: string; type: string }): "propeller" | "axial" | null => {
  if (specs.category === "Propeller Type") return "propeller";
  if (specs.type === "Tubeaxial" || specs.type === "Vaneaxial") return "axial";
  return null;
};
/** True when this line's static pressure (in the header unit) exceeds its type's cap. */
const spOverCap = (
  specs: { category: string; type: string; bladeType: string; staticPressure_pa: number | null },
  pressureUnitStr: string,
): boolean => {
  const cap = spCapInWg(specs);
  if (cap == null || isFlowOnlyUnit(specs) || specs.staticPressure_pa == null) return false;
  const pu = normalizePressureUnit(pressureUnitStr) ?? "inwg";
  return convertPressure(specs.staticPressure_pa, pu, "inwg") > cap + 1e-6;
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
  // Propeller types and the Customized Jet Fan aren't spring-mounted — no isolator.
  if (category === "Propeller Type" || type === "Customized Jet Fan")
    return { springs: 0, rated: null, noSpring: true };
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
  // High Pressure and Radial Blowers run heavier / higher-vibration — ×1.5 spring
  // capacity, then rounded up to the next rated capacity by isolatorRatedCap.
  const loadFactor = t.includes("high pressure") || t.includes("radial blower") ? 1.5 : 1;
  return { springs, rated: isolatorRatedCap((motorKg * 9 * loadFactor) / divisor), noSpring: false };
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
  bladeMaterial?: string | null,
  paint: string = PAINT_PHRASE,
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
      : `${paint}${model ? ` / Model: ${model}` : ""}`,
  ];
  // Separate blade material (when chosen) prints just after the Model line.
  if (bladeMaterial && bladeMaterial !== "Black Iron Sheet") {
    lines.push(`Blade made of ${materialPhrase(bladeMaterial)}`);
  }
  return lines.filter((l) => l.length > 0).join("\n");
}
/**
 * Pre-built unit description, built from the selections (no blade/drive/
 * material/paint lines):
 *   line 1  <type>                  e.g. "Ceiling Cassette"
 *   line 2  <brand> Brand           e.g. "KDK Brand" / "AlphaAir Brand"
 *   line 3  Model: <model>          once the salesperson picks a model
 */
function buildKdkDescription(type: string, model?: string | null, series?: string | null, brand = "KDK"): string {
  return [series ? `${type} - ${series}` : type, `${brand || "KDK"} Brand`, model ? `Model: ${model}` : ""]
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
  "Heavy Gauge Material": "Heavy Gauge Material",
  "Stainless 304 Material": "Stainless Steel 304",
  "Stainless 316 Material": "Stainless Steel 316",
  // legacy spellings kept so existing quotes render the same phrase:
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
/** Dropdown options, in display order (exact capitalizations). */
const MATERIAL_OPTIONS = [
  "Black Iron Sheet",
  "Heavy Gauge Material",
  "Aluminum Material",
  "Fiberglas Reinforced Metal",
  "Stainless 304 Material",
  "Stainless 316 Material",
  "Boiler Plate",
];
/**
 * Material -> body-price multiplier (applied to the catalogue body price).
 * Legacy label spellings are kept as aliases so older saved quotes still price.
 */
const MATERIAL_FACTORS: Record<string, number> = {
  "Black Iron Sheet": 1,
  "Heavy Gauge Material": 1.25,
  "Aluminum Material": 3,
  "Fiberglas Reinforced Metal": 5.5,
  "Stainless 304 Material": 4,
  "Stainless 316 Material": 6,
  "Boiler Plate": 8,
  // legacy labels (pre-rename) — keep pricing correct on existing quotes:
  "Heavy gauge material": 1.25,
  "Fiberglass reinforced metal": 5.5,
  "Stainless 304 material": 4,
  "Stainless 316 material": 6,
};
/** Categories whose body price is scaled by the material multiplier. */
const MATERIAL_CATEGORIES = new Set([
  "Centrifugal Type",
  "Axial Type",
  "Propeller Type",
  "Tubular Inline Type",
  "Cabinet Type",
]);

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
  // Customized Jet Fan reuses the Tubeaxial (TAF) catalogue/selection but is
  // priced ×3 and badged "JF" — its own pricing tag.
  if (category === "Axial Type")
    return type === "Vaneaxial" ? "VAF" : type === "Customized Jet Fan" ? "JF" : "TAF";
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
  // High Pressure Blower: own catalogue (HPB); price = CEB × 2.5 (÷0.4) via TAG_FACTORS.
  if (type === "High Pressure Blower") return "HPB";
  // Radial Blower blade catalogues, each priced from the client's Radial-Blower
  // price list (stored price is final, TAG_FACTORS ×1): Paddle Wheel = CMH,
  // Ring Paddle Wheel = CMA, Backplate Paddle Wheel = CMB.
  if (type === "Radial Blower" && bladeType === "Paddle Wheel") return "CMH";
  if (type === "Radial Blower" && bladeType === "Ring Paddle Wheel") return "CMA";
  if (type === "Radial Blower" && bladeType === "Backplate Paddle Wheel") return "CMB";
  // Plug Fan is a backward-curved centrifugal impeller (no scroll housing): its
  // own performance catalogue (CPF), priced the same as CEB (TAG_FACTORS ×1).
  if (type === "Plug Fan") return "CPF";
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
  // Customized Jet Fan = Tubeaxial (TAF) body × 2.
  JF: 2,
  // High Pressure Blower = its own catalogue, priced at CEB × 2.5 (÷0.4).
  HPB: 1 / 0.4,
  // Radial Blower blade catalogues. The stored catalogue price is the client's
  // final Radial-Blower selling price (shared across the three blade types by
  // size), so the body factor is ×1: Paddle Wheel (CMH), Ring Paddle Wheel
  // (CMA), Backplate Paddle Wheel (CMB).
  CMH: 1,
  CMA: 1,
  CMB: 1,
  // Plug Fan (CPF) — own catalogue, priced the same as CEB (×1).
  CPF: 1,
  CFAB: 1 / 0.9,
  CABSISW: 1 / 0.54,
  DIDWCEB: 1 / 0.57,
  DIDWCFAB: 1 / (0.9 * 0.57),
  CEBCAB: 1 / (0.57 * 0.54),
  CFABCAB: 1 / (0.9 * 0.57 * 0.9),
};
const tagFactor = (tag: string): number => TAG_FACTORS[tag] ?? 1;
/**
 * Motor pole options for a blower line. Single-phase motors are 4-pole only.
 * Direct drive locks to the pole set by the selected fan (rpm ↔ pole is fixed);
 * belt drive offers all poles.
 */
const poleOptions = (specs: LineSpecs): number[] => {
  if (specs.motorPh === 1) return [4];
  if (/direct/i.test(specs.drive) && specs.blowerModel && specs.motorPole != null) return [specs.motorPole];
  return [4, 2, 6];
};
const bladeFactor = (specs: LineSpecs): number => tagFactor(resolveTag(specs.type, specs.bladeType, specs.category));
/** Net body price after the tag (blade/type) factor and material factor. */
/**
 * Net body price. For the material-scaled fan categories the body splits into
 * a housing half (top Material dropdown) and a blade half (blade material, or
 * Black Iron when off): Body×0.5×bodyMat + Body×0.5×bladeMat. A customized unit
 * adds a +20% uplift on the base body (×1.2). "Body" here is the catalogue body
 * after its model-code (tag) factor. Other categories keep the plain factor.
 */
/** Paint upgrade -> black-iron-base multiplier (added on top of the body). */
const PAINT_FACTORS: Record<string, number> = { "Powder Coated Finish": 1.5, "High Temperature Paint": 0.3 };
const BOTH_PAINTS = ["Powder Coated Finish", "High Temperature Paint"];
/** Description line for the chosen paint (replaces the standard epoxy line). */
const PAINT_DESC: Record<string, string> = {
  "Powder Coated Finish": "Powder Coated Finish",
  "High Temperature Paint": "Painted with High Temperature Paint",
};
const paintDescLine = (specs: LineSpecs): string =>
  (specs.upgradePaint && PAINT_DESC[specs.paintType ?? ""]) || PAINT_PHRASE;
/** Which paint upgrades a body material allows (empty = no upgrade offered). */
const PAINT_BY_MATERIAL: Record<string, string[]> = {
  "Black Iron Sheet": BOTH_PAINTS,
  "Heavy Gauge Material": BOTH_PAINTS,
  "Aluminum Material": BOTH_PAINTS,
  "Fiberglas Reinforced Metal": ["High Temperature Paint"],
  "Stainless 304 Material": [],
  "Stainless 316 Material": [],
  "Boiler Plate": BOTH_PAINTS,
};
const paintOptionsFor = (material: string): string[] => PAINT_BY_MATERIAL[material] ?? BOTH_PAINTS;
const paintFactor = (specs: LineSpecs): number => {
  if (!specs.upgradePaint || !paintOptionsFor(specs.material).includes(specs.paintType ?? "")) return 0;
  return PAINT_FACTORS[specs.paintType ?? ""] ?? 0;
};

/**
 * Apply material + customized to a model-adjusted base body. Each half carries
 * ONE material factor (base = Black Iron): the housing half the body material,
 * the blade half the blade material — never compounded together.
 *  - Blade material OFF: base × bodyMat.
 *  - Blade material ON:  base×0.5×bodyMat + base×0.5×bladeMat.
 *  - Customized: multiplies the material body × 1.2.
 *  - Upgrade paint: adds base × paintFactor (black-iron base, independent of material).
 */
const bodyNetFrom = (base: number, specs: LineSpecs): number => {
  if (!MATERIAL_CATEGORIES.has(specs.category)) return base;
  const bodyMat = MATERIAL_FACTORS[specs.material] ?? 1;
  let core: number;
  if (specs.bladeMaterialOn) {
    const bladeMat = MATERIAL_FACTORS[specs.bladeMaterial ?? ""] ?? 1;
    core = base * 0.5 * bodyMat + base * 0.5 * bladeMat;
  } else {
    core = base * bodyMat;
  }
  if (specs.customizedUnit) core *= 1.2;
  return core + base * paintFactor(specs);
};
/** Reversible-blade propellers and Airfoil blades both cost ×1.5 of the body. */
const SPECIAL_BLADE_FACTOR: Record<string, number> = { "Reversible Blade": 1.5, Airfoil: 1.5 };
const specialBladeFactor = (specs: LineSpecs): number => SPECIAL_BLADE_FACTOR[specs.bladeType] ?? 1;
/** Model-adjusted base body (catalogue price × tag factor × special-blade factor). */
const baseBodyOf = (bodyPrice: number, specs: LineSpecs): number =>
  bodyPrice * bladeFactor(specs) * specialBladeFactor(specs);
const bodyPriceOf = (specs: LineSpecs): number =>
  bodyNetFrom(baseBodyOf(specs.bodyPrice ?? 0, specs), specs);

/** Plain number with thousands separators (up to 2 decimals). */
const fmtNum = (n: number): string => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });

/**
 * Human-readable body computation showing the factors used, so the price
 * change from each tick box is visible. E.g.
 *   47,654 × 3 (Aluminum) = 142,962
 *   47,654×0.5×1 (Black Iron Sheet) + 47,654×0.5×3 (blade Aluminum) + 47,654×0.2 (customized) = …
 */
const bodyComputation = (specs: LineSpecs): string => {
  const B = specs.bodyPrice ?? 0;
  if (!B) return "";
  // Show the resolved base body (catalogue price × model/special factors already
  // applied) rather than the long "(price×factor)" expression.
  const base = round2(baseBodyOf(B, specs));
  const baseStr = fmtNum(base);
  const total = bodyPriceOf(specs);
  if (!MATERIAL_CATEGORIES.has(specs.category)) return fmtNum(base);
  const bodyMat = MATERIAL_FACTORS[specs.material] ?? 1;
  const bodyName = materialPhrase(specs.material || "Black Iron Sheet");
  let core: string;
  if (specs.bladeMaterialOn) {
    const bladeMat = MATERIAL_FACTORS[specs.bladeMaterial ?? ""] ?? 1;
    const bladeName = materialPhrase(specs.bladeMaterial || "Black Iron Sheet");
    core = `${baseStr}×0.5×${fmtNum(bodyMat)} (${bodyName}) + ${baseStr}×0.5×${fmtNum(bladeMat)} (blade ${bladeName})`;
  } else {
    core = `${baseStr} × ${fmtNum(bodyMat)} (${bodyName})`;
  }
  let expr = specs.customizedUnit ? `(${core}) × 1.2 (customized)` : core;
  const paint = paintFactor(specs);
  if (paint > 0) expr = `${expr} + ${baseStr}×${fmtNum(paint)} (${specs.paintType})`;
  return `${expr} = ${fmtNum(total)}`;
};
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
  "Duct Connector",
  "Duct Reducer",
  "Elbow Duct",
  "Offset Duct",
  "Straight Duct",
  "Square to Round Duct",
  "Y-Duct",
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
/** Air Duct group: its own type set + material options (shown right after Type). */
const AIR_DUCT_TYPES = new Set([
  "Duct Connector",
  "Duct Reducer",
  "Elbow Duct",
  "Offset Duct",
  "Straight Duct",
  "Square to Round Duct",
  "Y-Duct",
]);
const AIR_DUCT_MATERIALS = ["Galvanized Iron", "Black Iron", "Stainless Steel"];
/** Air Duct sealant/gasket brand (stored in the otherwise-unused bladeType). */
const AIR_DUCT_SEALANTS = ["APO", "Nihonbond"];
const isAirDuct = (specs: { category: string; type: string }): boolean =>
  specs.category === "Ventilation Accessories" && AIR_DUCT_TYPES.has(specs.type);
// Air Duct types that use the sheet-metal "duct calculator" (A × B cross-section
// → sheets → auto price), with their own illustration. Straight Duct and Duct
// Connector share the same calculator and pricing.
const DUCT_CALC_TYPES = new Set(["Straight Duct", "Duct Connector", "Duct Reducer", "Square to Round Duct", "Elbow Duct", "Offset Duct"]);
const DUCT_CALC_IMAGE: Record<string, string> = {
  "Straight Duct": "/straight-duct.png",
  "Duct Connector": "/duct-connector.jpg",
  "Duct Reducer": "/reducer.jpg",
  "Square to Round Duct": "/square-to-round.jpg",
  "Elbow Duct": "/elbow.jpg",
  "Offset Duct": "/offset-duct.jpg",
};
// Reducer-like types: priced from a developed-blank material area ÷ 4608 sheet,
// with double labour. Square to Round mirrors the Duct Reducer; Elbow and Offset
// carry their own material formulas and dimension fields.
const REDUCER_LIKE_TYPES = new Set(["Duct Reducer", "Square to Round Duct", "Elbow Duct", "Offset Duct"]);
const isReducerType = (type?: string): boolean => REDUCER_LIKE_TYPES.has(type ?? "");
const isDuctCalc = (specs: { category: string; type: string }): boolean =>
  specs.category === "Ventilation Accessories" && DUCT_CALC_TYPES.has(specs.type);
// Straight Duct: one duct wraps a strip of the 48 × 96 in sheet, so Number of
// Sheets Used = ((A + B) × 2 + 2) ÷ 96, where A/B are the cross-section sides in
// trade inches (the calculator inputs are entered in the chosen unit and
// converted here) and the +2 is the lock-seam allowance. (A = B = 0 → 2/96 ≈
// 0.021.) The material basis is fixed; the flanged/non-flanged standard length
// below is shown for reference only and does not change the sheet count.
function straightDuctStdLengthM(specs: { ductNoFlange?: boolean }): number {
  return specs.ductNoFlange ? 1.2 : 1.1;
}
/** Calculator A/B (entered in sizeUnit) → mm (for the gauge) and trade inches (for
 *  sheets). A Round duct carries a single diameter (stored in ductCalcWidth) that
 *  fills BOTH sides, so the gauge (longest side) and reducer size (√(a·b)) both
 *  resolve to the diameter; the circumference is handled by ductPerimeterIn. */
function ductCalcSides(specs: { ductCalcLength?: string; ductCalcWidth?: string; sizeUnit?: string; shape?: string }): {
  aMm: number;
  bMm: number;
  aIn: number;
  bIn: number;
} {
  const perMm = ACC_MM_PER_UNIT[specs.sizeUnit || "inches"] ?? 25; // mm per 1 entered unit
  if (specs.shape === "Round") {
    const dMm = (parseFloat(specs.ductCalcWidth ?? "") || 0) * perMm;
    return { aMm: dMm, bMm: dMm, aIn: dMm / 25, bIn: dMm / 25 };
  }
  const aMm = (parseFloat(specs.ductCalcLength ?? "") || 0) * perMm;
  const bMm = (parseFloat(specs.ductCalcWidth ?? "") || 0) * perMm;
  return { aMm, bMm, aIn: aMm / 25, bIn: bMm / 25 };
}
/** Duct perimeter/circumference (trade inches): Round = π·diameter, else 2·(A+B). */
function ductPerimeterIn(specs: { ductCalcLength?: string; ductCalcWidth?: string; sizeUnit?: string; shape?: string }): number {
  const { aIn, bIn } = ductCalcSides(specs);
  if (specs.shape === "Round") return Math.PI * aIn; // aIn === diameter for round
  return (aIn + bIn) * 2;
}
/** Smallest even number ≥ x (0 for non-positive). */
function nextEvenUp(x: number): number {
  return x > 0 ? Math.ceil(x / 2) * 2 : 0;
}
/** Convert a duct cross-section between Square/Rectangle and Round by EQUAL area,
 *  rounding the result UP to the next even number (e.g. 20×20 → Ø24, Ø24 → 22×22).
 *  `w` = width (or diameter when round), `l` = length (empty when round). */
function convertDuctShape(oldShape: string | undefined, newShape: string | undefined, w?: string, l?: string): { w: string; l: string } {
  const num = (v?: string) => parseFloat(v ?? "") || 0;
  const fmt = (n: number) => (n > 0 ? String(n) : "");
  const wasRound = oldShape === "Round";
  const isRound = newShape === "Round";
  if (isRound && !wasRound) {
    const area = num(w) * num(l); // L × W
    return { w: fmt(nextEvenUp(2 * Math.sqrt(area / Math.PI))), l: "" }; // Ø of equal area
  }
  if (!isRound && wasRound) {
    const side = nextEvenUp(num(w) * Math.sqrt(Math.PI) / 2); // square of equal area
    return { w: fmt(side), l: fmt(side) };
  }
  return { w: w ?? "", l: l ?? "" };
}
/** Seam allowance (trade inches) added to the developed perimeter: Galvanized
 *  Iron is lock-seamed (+2" overlap); Black Iron / Stainless are welded (none). */
function ductSeamAllowanceIn(specs: { material?: string }): number {
  return specs.material === "Galvanized Iron" ? 2 : 0;
}
// Duct Reducer material used (square inches) by opening size (A = B, inches),
// from AeroVent's reducer development table.
const REDUCER_MATERIAL_TABLE: ReadonlyArray<readonly [number, number]> = [
  [4, 94], [6, 211], [8, 374], [10, 584], [12, 841], [14, 1144],
  [16, 1494], [18, 1891], [20, 2337], [22, 2825], [24, 3369], [26, 3945],
  [28, 4576], [30, 5251], [32, 5975], [34, 6745], [36, 7561],
];
/** Smallest tabulated reducer size (inches) ≥ the given size — rounds UP (never
 *  interpolated); the next even size beyond the table. */
function reducerTabSize(size: number): number {
  if (!(size > 0)) return 0;
  for (const [s] of REDUCER_MATERIAL_TABLE) if (size <= s) return s;
  return Math.ceil(size / 2) * 2; // beyond the table
}
/** Base reducer material (sq in) at a tabulated size — table value, or the top
 *  row scaled quadratically (material ∝ size²) above the table. */
function reducerMaterialAtSize(tabSize: number): number {
  if (!(tabSize > 0)) return 0;
  for (const [s, v] of REDUCER_MATERIAL_TABLE) if (tabSize <= s) return v;
  const [lastSize, lastVal] = REDUCER_MATERIAL_TABLE[REDUCER_MATERIAL_TABLE.length - 1];
  return (lastVal * tabSize * tabSize) / (lastSize * lastSize);
}
/** Standard reducer height (inches) for a tabulated size — H_std = 1.5·size
 *  (matches the pricelist: 4→6, 6→9, 8→12, … 36→54). */
function reducerStandardHeightForSize(tabSize: number): number {
  return tabSize > 0 ? 1.5 * tabSize : 0;
}
/** The reducer's equivalent tabulated (square) size (inches) for its A × B
 *  opening — a rectangular one uses √(A × B), rounded up to the table. */
function reducerEquivSize(specs: { ductCalcLength?: string; ductCalcWidth?: string; sizeUnit?: string; shape?: string }): number {
  const { aIn, bIn } = ductCalcSides(specs);
  if (!(aIn > 0) || !(bIn > 0)) return 0;
  return reducerTabSize(Math.sqrt(aIn * bIn)); // round: aIn = bIn = diameter → size = diameter
}
/** Actual reducer height "H" in inches (0 when unset → treated as standard). */
function reducerHeightIn(specs: { ductCalcHeight?: string; sizeUnit?: string }): number {
  const perMm = ACC_MM_PER_UNIT[specs.sizeUnit || "inches"] ?? 25;
  const h = ((parseFloat(specs.ductCalcHeight ?? "") || 0) * perMm) / 25;
  return h > 0 ? h : 0;
}
/** Standard height (inches) for the reducer's current A × B opening (0 if unsized). */
function reducerStandardHeightIn(specs: { ductCalcLength?: string; ductCalcWidth?: string; sizeUnit?: string }): number {
  return reducerStandardHeightForSize(reducerEquivSize(specs));
}
/** Standard height in the line's current unit (null if the opening isn't sized). */
function reducerStandardHeightInUnit(specs: { ductCalcLength?: string; ductCalcWidth?: string; sizeUnit?: string }): number | null {
  const stdIn = reducerStandardHeightIn(specs);
  if (!(stdIn > 0)) return null;
  const perMm = ACC_MM_PER_UNIT[specs.sizeUnit || "inches"] ?? 25;
  return Math.round(((stdIn * 25) / perMm) * 100) / 100; // inches → current unit
}
/** Duct Reducer material used (sq in) for an A × B opening at height H. The table
 *  is keyed by a square opening, so a rectangular one uses √(A × B) — e.g.
 *  10 × 12 → √120 = 10.95 → the 12" row (841 sq in). Each size has a standard
 *  height (2·size − 6); if the actual H exceeds it, the material is doubled. */
function reducerMaterialSqIn(specs: { ductCalcLength?: string; ductCalcWidth?: string; ductCalcHeight?: string; sizeUnit?: string }): number {
  const size = reducerEquivSize(specs);
  if (!(size > 0)) return 0;
  const base = reducerMaterialAtSize(size);
  const overStandard = reducerHeightIn(specs) > reducerStandardHeightForSize(size);
  return base * (overStandard ? 2 : 1);
}
/** Elbow duct A (width), B (length) and R (radius) in trade inches. The third
 *  calculator field (ductCalcHeight) holds the radius R. A Round elbow has a
 *  single diameter (ductCalcWidth) that fills both A and B. */
function elbowDims(specs: { ductCalcLength?: string; ductCalcWidth?: string; ductCalcHeight?: string; sizeUnit?: string; shape?: string }): {
  aIn: number;
  bIn: number;
  rIn: number;
} {
  const perMm = ACC_MM_PER_UNIT[specs.sizeUnit || "inches"] ?? 25;
  const toIn = (v?: string) => ((parseFloat(v ?? "") || 0) * perMm) / 25;
  const rIn = toIn(specs.ductCalcHeight);
  if (specs.shape === "Round") {
    const dIn = toIn(specs.ductCalcWidth); // single diameter → both A and B
    return { aIn: dIn, bIn: dIn, rIn };
  }
  return { aIn: toIn(specs.ductCalcWidth), bIn: toIn(specs.ductCalcLength), rIn };
}
/** Elbow Duct material used (sq in):
 *  2·(B + R)² + 2R·0.7854·A + 2·(R + B)·0.7854·A. Needs A, B and R all set.
 *  The ×1.2 GI overlap allowance is applied by ductMaterialWasteFactor (GI only;
 *  welded Black Iron / Stainless keep the plain computation — no ×1.2). */
function elbowMaterialSqIn(specs: { ductCalcLength?: string; ductCalcWidth?: string; ductCalcHeight?: string; sizeUnit?: string }): number {
  const { aIn, bIn, rIn } = elbowDims(specs); // aIn = A (Width), bIn = B (Length), rIn = R
  if (!(aIn > 0) || !(bIn > 0) || !(rIn > 0)) return 0;
  const k = 0.7854; // 3.1416 × 0.25 (π/4)
  const cheeks = Math.pow(bIn + rIn, 2) * 2; // 2·(B + R)²
  const throat = 2 * rIn * k * aIn; // 2R · 0.7854 · A
  const back = 2 * (rIn + bIn) * k * aIn; // 2·(R + B) · 0.7854 · A
  return cheeks + throat + back;
}
/** Offset Duct A (width), B (cross-section height), L (length) and O (offset) in
 *  trade inches. Fields: A = ductCalcWidth, B = ductCalcLength (so the gauge uses
 *  the A × B cross-section), L = ductCalcHeight, O = ductCalcOffset. */
function offsetDims(specs: { ductCalcLength?: string; ductCalcWidth?: string; ductCalcHeight?: string; ductCalcOffset?: string; sizeUnit?: string; shape?: string }): {
  aIn: number;
  bIn: number;
  lIn: number;
  oIn: number;
} {
  const perMm = ACC_MM_PER_UNIT[specs.sizeUnit || "inches"] ?? 25;
  const toIn = (v?: string) => ((parseFloat(v ?? "") || 0) * perMm) / 25;
  const lIn = toIn(specs.ductCalcHeight);
  const oIn = toIn(specs.ductCalcOffset);
  if (specs.shape === "Round") {
    // Round: the diameter (ductCalcWidth) becomes the equal-area square side, so a
    // round and a square/rectangle of the same cross-section give the same result.
    const side = (toIn(specs.ductCalcWidth) * Math.sqrt(Math.PI)) / 2; // √(πD²/4)
    return { aIn: side, bIn: side, lIn, oIn };
  }
  return { aIn: toIn(specs.ductCalcWidth), bIn: toIn(specs.ductCalcLength), lIn, oIn };
}
/** Offset Duct material used (sq in): (B + O)·L·2 + L·A·2·1.5. Needs A, B and L
 *  (the offset O may be 0). GI overlap allowance (×1.2) is applied separately. */
function offsetMaterialSqIn(specs: { ductCalcLength?: string; ductCalcWidth?: string; ductCalcHeight?: string; ductCalcOffset?: string; sizeUnit?: string }): number {
  const { aIn, bIn, lIn, oIn } = offsetDims(specs);
  if (!(aIn > 0) || !(bIn > 0) || !(lIn > 0)) return 0;
  return (bIn + oIn) * lIn * 2 + lIn * aIn * 2 * 1.5;
}
/** Material used (sq in) for a reducer-like type — Elbow and Offset use their own
 *  formulas; Duct Reducer and Square to Round use the reducer table. */
function reducerLikeMaterialSqIn(specs: { type?: string; ductCalcLength?: string; ductCalcWidth?: string; ductCalcHeight?: string; ductCalcOffset?: string; sizeUnit?: string }): number {
  if (specs.type === "Elbow Duct") return elbowMaterialSqIn(specs);
  if (specs.type === "Offset Duct") return offsetMaterialSqIn(specs);
  return reducerMaterialSqIn(specs);
}
// Number of Sheets Used, from the A × B cross-section (trade inches):
//   Straight Duct   = ((A + B) × 2 + 2) ÷ 96          (48" strip + lock seam)
//   Duct Connector  = ((A + B) × 2 × 12) ÷ 4608       (12" collar, no seam)
//   Duct Reducer    = material(A, B) ÷ 4608           (developed blank area)
// where 4608 = 48 × 96 in² (one sheet).
function ductRawSheetsUsed(specs: { ductCalcLength?: string; ductCalcWidth?: string; ductCalcHeight?: string; sizeUnit?: string; type?: string; shape?: string; material?: string }): number {
  const perimeter = ductPerimeterIn(specs);
  if (specs.type === "Duct Connector") return (perimeter * 12) / (48 * 96);
  if (isReducerType(specs.type)) return reducerLikeMaterialSqIn(specs) / (48 * 96);
  return (perimeter + ductSeamAllowanceIn(specs)) / 96;
}
// Galvanized Iron carries a 20% material allowance (overlap/waste) on the metal
// used; Black Iron and Stainless Steel keep the plain computation.
const GI_MATERIAL_WASTE = 0.2;
function ductMaterialWasteFactor(specs: { material?: string }): number {
  return specs.material === "Galvanized Iron" ? 1 + GI_MATERIAL_WASTE : 1;
}
/** Material (sheets) used — the metal quantity that drives material cost and the
 *  "Number of Sheets Used" / "Material Used" display (GI +10%). Labour uses the
 *  raw count (ductLaborSheetCount), not this factored one. */
function ductSheetsUsed(specs: { ductCalcLength?: string; ductCalcWidth?: string; ductCalcHeight?: string; sizeUnit?: string; type?: string; shape?: string; material?: string }): number {
  return ductRawSheetsUsed(specs) * ductMaterialWasteFactor(specs);
}
// Straight-duct sheet count (labour basis) — the full ((A + B) × 2 + 2) ÷ 96
// wrap of the cross-section. A Duct Connector uses less metal for its 12"
// collar (see ductSheetsUsed), but its production labour is billed like a full
// straight-duct section, so labour is always computed from this count.
function straightDuctSheetCount(specs: { ductCalcLength?: string; ductCalcWidth?: string; sizeUnit?: string; shape?: string; material?: string }): number {
  return (ductPerimeterIn(specs) + ductSeamAllowanceIn(specs)) / 96;
}
// Sheet count that production labour is billed from. Straight Duct and Duct
// Connector both bill labour like a full duct section (the straight-duct wrap);
// a Duct Reducer bills labour from its own developed-blank sheet count.
function ductLaborSheetCount(specs: { ductCalcLength?: string; ductCalcWidth?: string; ductCalcHeight?: string; sizeUnit?: string; type?: string; shape?: string; material?: string }): number {
  // Labour is billed from the raw material count (no GI +10% material allowance).
  if (isReducerType(specs.type)) return ductRawSheetsUsed(specs);
  return straightDuctSheetCount(specs);
}
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
// --- AlphaAir Ceiling Cassette (BPT series) — inline prebuilt catalogue --------
// VAT-INCLUSIVE selling prices. Duty-based selection off the published fan curves
// (static pressure Pa vs airflow m³/h). Only the stocked models are listed.
interface AlphaCassette {
  model: string;
  duct: string; // e.g. '4" Ø duct'
  price: number; // VAT-inclusive selling price
  powerW: number;
  airM3hr: number; // rated (max) air volume, m³/h
  cfm: number;
  rpm: number;
  curve: [number, number][]; // [airflow m³/h, static pressure Pa], ascending flow
}
const ALPHAAIR_CASSETTES: AlphaCassette[] = [
  { model: "BPT10-11", duct: '4" Ø duct', price: 3700, powerW: 15, airM3hr: 120, cfm: 71, rpm: 772,
    curve: [[0, 65], [34, 55], [51, 44], [68, 41], [85, 37], [102, 31], [119, 26]] },
  { model: "BPT12-34", duct: '5" Ø duct', price: 6100, powerW: 38, airM3hr: 270, cfm: 159, rpm: 804,
    curve: [[0, 138], [70, 128], [140, 118], [175, 110], [210, 100], [245, 82], [280, 68]] },
  { model: "BPT15-44B", duct: '6" Ø duct', price: 8200, powerW: 70, airM3hr: 500, cfm: 294, rpm: 1063,
    curve: [[0, 186], [140, 178], [280, 165], [350, 150], [420, 130], [490, 100], [525, 78]] },
  { model: "BPT20-54B", duct: '6" Ø duct', price: 12630, powerW: 205, airM3hr: 800, cfm: 471, rpm: 1003,
    curve: [[0, 185], [180, 172], [360, 150], [450, 130], [540, 110], [630, 90], [720, 70], [810, 27]] },
  { model: "BPT20-64B", duct: '6" Ø duct', price: 17000, powerW: 235, airM3hr: 1200, cfm: 706, rpm: 1089,
    curve: [[0, 220], [240, 200], [480, 175], [600, 155], [720, 130], [840, 105], [960, 80], [1080, 55], [1200, 30]] },
];
const isAlphaAirCassette = (specs: { brand: string; type: string }): boolean =>
  specs.type === "Ceiling Cassette" && specs.brand === "AlphaAir";
/** Static pressure (Pa) a model delivers at airflow q (m³/h); null if q is beyond its curve. */
function alphaCurveSpAt(curve: [number, number][], q: number): number | null {
  if (q <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (q <= curve[i][0]) {
      const [f0, s0] = curve[i - 1];
      const [f1, s1] = curve[i];
      return s0 + ((s1 - s0) * (q - f0)) / (f1 - f0);
    }
  }
  return null; // beyond the model's max airflow
}
/** BPT models meeting the duty (deliver ≥ required SP at the required flow), smallest first. */
function alphaAirCassettePicks(qM3hr: number, pPa: number): { c: AlphaCassette; sp: number }[] {
  return ALPHAAIR_CASSETTES.map((c) => ({ c, sp: alphaCurveSpAt(c.curve, qM3hr) }))
    .filter((x): x is { c: AlphaCassette; sp: number } => x.sp != null && x.sp >= pPa - 1e-6)
    .sort((a, b) => a.c.airM3hr - b.c.airM3hr);
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
/** Explosion-proof is offered for 3-phase 4-pole induction motors only. */
const inductionExEligible = (specs: LineSpecs): boolean =>
  specs.motorPh === 3 && inductionPole(specs) === 4;
/** HP options for the current phase/pole (only priced HPs; EX filters to EX-priced). */
const inductionHpOptions = (specs: LineSpecs): number[] => {
  if (!specs.motorPh) return [];
  const opts = hpOptions(specs.motorPh, inductionPole(specs));
  return specs.exproof && inductionExEligible(specs) ? opts.filter(hasExproofPrice) : opts;
};
/** The motor table row for the current phase/pole/HP, or undefined. */
function inductionMotorRow(specs: LineSpecs): MotorRow | undefined {
  if (!specs.motorPh || specs.motorHp == null) return undefined;
  return lookupMotor(specs.motorHp, specs.motorPh, inductionPole(specs));
}
/** Auto unit price (VAT-inclusive, as stored) for an induction-motor line, or null. */
function inductionUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const m = inductionMotorRow(specs);
  return m ? round2(motorNetPrice(m, specs.exproof === true) * (1 + vatRate)) : null;
}
/** Description for an induction motor, built from the TECO spec data by the
 *  selected phase / pole / HP (and Xproof). kW / RPM / frame come from the file;
 *  the type name shows until a phase + HP are picked. */
function buildInductionDescription(specs: LineSpecs): string {
  const ph = specs.motorPh;
  const hp = specs.motorHp;
  if (!ph || hp == null) return specs.type; // nothing selected yet
  const pole = inductionPole(specs);
  const exp = specs.exproof === true && inductionExEligible(specs);
  const section = ph === 1 ? "single" : exp ? "ex" : "three";
  const row = TECO_MOTOR_DATA[`${section}|${hp}|${pole}`];
  const kw = row?.kw ?? TECO_KW_BY_HP[String(hp)] ?? null;
  const brand = isInductionHyundai(specs) ? "HYUNDAI" : "TECO";
  const lines: string[] = [];
  lines.push("Induction Motor");
  lines.push(exp ? "Explosion Proof" : "TEFC");
  lines.push(`${hp} Hp${kw != null ? `, ${kw} Kw` : ""}, ${ph === 1 ? "Single Phase" : "Three Phase"}`);
  lines.push(`${ph === 1 ? "220v" : "220/380/440v"}, 60 Hz`);
  lines.push(`${pole} Pole${row?.rpm ? ` - ${row.rpm} rpm` : ""}`);
  if (row?.frame) lines.push(`Foot mounted - ${row.frame} Frame`);
  lines.push(`${brand} Brand`);
  return lines.join("\n");
}
// Jet Fan (Other Products): pick a model; each carries its rating and a
// VAT-EXCLUSIVE (net) selling price. The model is stored in blowerModel. Models
// differ by brand — MaxAir (MA series) vs AlphaAir (AJF series). Jet fans push
// air with ~no static pressure (rated by air velocity), so AJF pa = 0.
const JET_FAN: Record<string, { watt: number; cmh: number; pa: number; net: number; brand: string }> = {
  "MA-250": { watt: 300, cmh: 2000, pa: 24, net: 41870, brand: "MaxAir" },
  "MA-300": { watt: 480, cmh: 3000, pa: 39, net: 67714, brand: "MaxAir" },
  "AJF-200": { watt: 190, cmh: 1400, pa: 0, net: 23000, brand: "AlphaAir" },
  "AJF-250": { watt: 300, cmh: 2338, pa: 0, net: 29000, brand: "AlphaAir" },
  "AJF-300": { watt: 480, cmh: 3624, pa: 0, net: 47000, brand: "AlphaAir" },
};
const jetFanModelsFor = (brand: string): string[] =>
  brand === "AlphaAir" ? ["AJF-200", "AJF-250", "AJF-300"] : ["MA-250", "MA-300"];
const isJetFan = (specs: { type: string }): boolean => specs.type === "Jet Fan";
// Poultry Fan (Other Products / AlphaAir, ADH series — SS exhaust fan). Pick a
// model; each carries its rating and a VAT-EXCLUSIVE (net) selling price. The
// pricelist model number is the fan's height (mm); the spec sheet labels it by
// blade diameter, e.g. pricelist "ADH-900" = spec "ADH-750 (30")".
const POULTRY_FAN: Record<string, { net: number; cmh: number; pa: number; watt: number; size: string; inch: number; bladeMm: number; h: number; w: number; t: number }> = {
  "ADH-500": { net: 11500, cmh: 5000, pa: 70, watt: 250, size: '16"', inch: 16, bladeMm: 400, h: 500, w: 500, t: 300 },
  "ADH-600": { net: 13500, cmh: 8000, pa: 70, watt: 250, size: '20"', inch: 20, bladeMm: 500, h: 600, w: 600, t: 300 },
  "ADH-700": { net: 16500, cmh: 10000, pa: 56, watt: 250, size: '24"', inch: 24, bladeMm: 600, h: 700, w: 700, t: 300 },
  "ADH-900": { net: 25000, cmh: 27000, pa: 70, watt: 370, size: '30"', inch: 30, bladeMm: 750, h: 900, w: 900, t: 400 },
  "ADH-1060": { net: 27000, cmh: 30000, pa: 70, watt: 550, size: '36"', inch: 36, bladeMm: 900, h: 1060, w: 1060, t: 400 },
  "ADH-1380": { net: 32000, cmh: 44500, pa: 56, watt: 1100, size: '50"', inch: 50, bladeMm: 1250, h: 1380, w: 1380, t: 400 },
};
const POULTRY_FAN_MODELS = Object.keys(POULTRY_FAN);
const isPoultryFan = (specs: { type: string }): boolean =>
  specs.type === "Commercial Type Exhaust Fan" || specs.type === "Poultry Fan";
/** Net (VAT-exclusive) price for a poultry fan by model, or null. */
function poultryFanNet(specs: LineSpecs): number | null {
  return specs.blowerModel ? POULTRY_FAN[specs.blowerModel]?.net ?? null : null;
}
/** Auto unit price (VAT-inclusive, as stored) for a poultry fan, or null. */
function poultryFanUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const net = poultryFanNet(specs);
  return net == null ? null : round2(net * (1 + vatRate));
}
/** Description for a poultry fan: type + brand + model. Size goes in the Inches column. */
function buildPoultryFanDescription(specs: LineSpecs): string {
  const lines: string[] = ["Commercial Type Exhaust Fan", "AlphaAir Brand"];
  if (specs.blowerModel) lines.push(`Model: ${specs.blowerModel}`);
  return lines.join("\n");
}
// HVLS (Other Products / AlphaAir, AAHVPM series — high-volume low-speed ceiling
// fan). Pick a model; each carries its spec and a VAT-EXCLUSIVE (net) selling
// price. PMSM motor, 220 V single phase, 50/60 Hz. No standard rating columns
// fit, so the spec goes in the description.
const HVLS_FAN: Record<string, { net: number; ft: number; dia: number; blades: number; kw: number; rpm: number; weight: number; airMin: number }> = {
  "AAHVPM-6-25": { net: 115000, ft: 8, dia: 2500, blades: 6, kw: 0.3, rpm: 135, weight: 37, airMin: 6000 },
  "AAHVPM-6-30": { net: 125000, ft: 10, dia: 3000, blades: 6, kw: 0.5, rpm: 120, weight: 46, airMin: 6800 },
  "AAHVPM-6-36": { net: 135000, ft: 12, dia: 3600, blades: 6, kw: 0.5, rpm: 110, weight: 48, airMin: 7500 },
  "AAHVPM-6-42": { net: 145000, ft: 14, dia: 4200, blades: 6, kw: 0.5, rpm: 95, weight: 50, airMin: 8800 },
  "AAHVPM-6-49": { net: 160000, ft: 16, dia: 4900, blades: 6, kw: 1.1, rpm: 75, weight: 92, airMin: 13200 },
  "AAHVPM-6-55": { net: 175000, ft: 18, dia: 5500, blades: 6, kw: 1.1, rpm: 65, weight: 90, airMin: 13800 },
  "AAHVPM-6-61": { net: 200000, ft: 20, dia: 6100, blades: 6, kw: 1.1, rpm: 62, weight: 105, airMin: 14400 },
  "AAHVPM-6-73": { net: 225000, ft: 24, dia: 7300, blades: 6, kw: 1.5, rpm: 60, weight: 118, airMin: 15800 },
  "AAHVPM-5-79": { net: 250000, ft: 26, dia: 7900, blades: 5, kw: 1.8, rpm: 50, weight: 125, airMin: 17500 },
};
const HVLS_MODELS = Object.keys(HVLS_FAN);
const isHvls = (specs: { type: string }): boolean => specs.type === "HVLS";
/** Net (VAT-exclusive) price for an HVLS by model, or null. */
function hvlsNet(specs: LineSpecs): number | null {
  return specs.blowerModel ? HVLS_FAN[specs.blowerModel]?.net ?? null : null;
}
/** Auto unit price (VAT-inclusive, as stored) for an HVLS, or null. */
function hvlsUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const net = hvlsNet(specs);
  return net == null ? null : round2(net * (1 + vatRate));
}
/** Description for an HVLS: type / brand / model. Air volume, size, power, phase
 *  and volts populate the quote columns, so they're not repeated here. */
function buildHvlsDescription(specs: LineSpecs): string {
  const lines: string[] = ["HVLS", "AlphaAir Brand"];
  const m = specs.blowerModel ? HVLS_FAN[specs.blowerModel] : null;
  if (specs.blowerModel) lines.push(`Model: ${specs.blowerModel}`);
  if (m) lines.push(`${m.blades} blades · PMSM motor`);
  return lines.join("\n");
}
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
  const brand =
    (specs.blowerModel && JET_FAN[specs.blowerModel]?.brand) || (specs.brand === "AlphaAir" ? "AlphaAir" : "MaxAir");
  const lines: string[] = ["Jet Fan", `${brand} Brand`];
  if (specs.blowerModel) lines.push(`Model: ${specs.blowerModel}`);
  return lines.join("\n");
}
// Dust Collector (Other Products / Aerovent, META Taiwan): pick a model; each
// carries the full spec description and a VAT-EXCLUSIVE (net) selling price (the
// "mark up" price). The model is stored in blowerModel; the description is the
// model's spec block verbatim (no price line). No rating columns are populated.
const DUST_COLLECTOR_MODELS = ["CT-50GP", "CT-105A", "CT-201"];
const DUST_COLLECTOR: Record<string, { net: number; desc: string }> = {
  "CT-50GP": {
    net: 28457,
    desc: [
      "Air flow - 750 cfm",
      "Static pressure - 6.2 InH2O",
      "Motor specs - 1 Hp, 1 Ph, 220v",
      "Filter bag - 30 microns",
      "Inlet diameter - 4 inches",
      "Bag capacity - 68 liters",
      "Hose length - 4 inches x 1.8 meters",
      "Dust hood size - 10 x 4.5 inches",
      "Impeller material - Steel",
      "Weight - 23 kgs",
      "Overall dimension - 1000 x 400 x 880mm",
    ].join("\n"),
  },
  "CT-105A": {
    net: 47333,
    desc: [
      "Air flow - 1250 cfm",
      "Static pressure - 12 InH2O",
      "Motor specs - 1.5 Hp, 1 Ph, 220v",
      "Filter bag - 30 microns",
      "Inlet diameter - 4 inches",
      "Bag capacity - 191 liters @ 500mm diameter",
      "Impeller material - Steel",
      "Sound Rating - 75-85 db",
      "Overall dimension - 1000 x 800 x 2000mm",
    ].join("\n"),
  },
  "CT-201": {
    net: 73645,
    desc: [
      "Air flow - 2300 cfm",
      "Static pressure - 18.5 InH2O",
      "Motor specs - 3 Hp, 1 Ph, 220v",
      "Filter bag - 30 microns",
      'Inlet diameter - 6" x 4" x 3',
      'Bag capacity - 83 gallon @ 19 5/8" diameter',
      "Impeller material - Steel",
      "Sound Rating - 75-85 db",
      "Overall dimension - 1550 x 550 x 2000mm",
    ].join("\n"),
  },
};
const isDustCollector = (specs: { type: string }): boolean => specs.type === "Dust Collector";
/** Net (VAT-exclusive) price for a dust collector by model, or null. */
function dustCollectorNet(specs: LineSpecs): number | null {
  return specs.blowerModel ? DUST_COLLECTOR[specs.blowerModel]?.net ?? null : null;
}
/** Auto unit price (VAT-inclusive, as stored) for a dust collector, or null. */
function dustCollectorUnitPrice(specs: LineSpecs, vatRate: number): number | null {
  const net = dustCollectorNet(specs);
  return net == null ? null : round2(net * (1 + vatRate));
}
/** Description for a dust collector: "Dust Collector" + the model's spec block. */
function buildDustCollectorDescription(specs: LineSpecs): string {
  const m = specs.blowerModel ? DUST_COLLECTOR[specs.blowerModel] : null;
  return m ? `Dust Collector\n${m.desc}` : "Dust Collector";
}
/** Accessory types that offer the powder-coat finish option. (Air Duct types
 *  don't — they have no powder-coat checkbox.) */
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

// Recommended sheet gauge for a rectangular/round duct by its longest side
// (Low-Pressure HVAC schedule): ≤300mm → 24ga, ≤750 → 24ga, ≤1370 → 22ga,
// ≤2250 → 20ga, above → 18ga. The 20 ga band ends at 2250 mm (= 90 trade inches)
// so that 91 inches (2275 mm) and above fall to 18 ga. (The client fabricates
// the ≤300 mm band in 24 ga rather than 26, so the schedule aligns with the
// sheet-price tables, which only carry 24/22/20/18/16.)
const DUCT_GAUGE_SCHEDULE: Array<[number, string]> = [
  [300, "24"],
  [750, "24"],
  [1370, "22"],
  [2250, "20"],
];
// Standard round-duct thickness by diameter (mm) → gauge (else 18 ga above 2400).
// The standard's 26 ga (≤300 mm) is upgraded to 24 ga — we never use 26 ga for
// round or rectangular ducts.
const ROUND_DUCT_GAUGE_SCHEDULE: Array<[number, string]> = [
  [300, "24"],
  [750, "24"],
  [1500, "22"],
  [2400, "20"],
];
/** Longest duct side (mm) → recommended gauge, or null if the size isn't set. */
function recommendedDuctGauge(specs: LineSpecs): string | null {
  const unit = specs.sizeUnit || "mm";
  const toMm = (v: string): number | null => {
    const n = parseFloat(v);
    return !v || Number.isNaN(n) ? null : n * (ACC_MM_PER_UNIT[unit] ?? 1);
  };
  const l = toMm(specs.sizeL);
  // Round = diameter (sizeL only); otherwise the longest of L × W.
  const longest =
    specs.shape === "Round"
      ? l
      : (() => {
          const w = toMm(specs.sizeW);
          return l != null && w != null ? Math.max(l, w) : null;
        })();
  if (longest == null) return null;
  for (const [maxMm, ga] of DUCT_GAUGE_SCHEDULE) if (longest <= maxMm) return ga;
  return "18";
}

// --- Straight Duct auto-pricing (Air Duct group) -----------------------------
// The calculator's A × B cross-section drives both the sheet count and the gauge
// (longest side in mm → the gauge schedule). Duct Price is quoted
// VAT-EXCLUSIVE and equals:
//   sheetPrice × 1.3 markup × sheets  +  ₱15 corner angle × 8 pieces (flange)
//                                     +  labor-sheets × labor-per-sheet.
// A "No Flange" duct drops the ₱15 × 8 angle-iron flange cost.
const STRAIGHT_DUCT_MARKUP = 1.3;
const STRAIGHT_DUCT_ANGLE_PRICE = 15; // ₱ per corner-angle piece (Air Duct only)
const STRAIGHT_DUCT_ANGLE_COUNT = 8; // corner angles per flanged duct
// Selectable sheet gauges (match the sheet-price tables). Thicker = smaller number.
const STRAIGHT_DUCT_GAUGES = ["24", "22", "20", "18", "16"];

// Labor is billed by "labor sheets" at a per-material rate (GI 450 / BI 900 /
// SS 1350 per sheet). It carries a one-sheet minimum: anything under 1 sheet is
// still charged as 1 sheet (GI 450). Beyond 1 sheet it rounds UP to the next
// half sheet — e.g. 1.2 → 1.5 sheets, 1.6 → 2 sheets — so the labor steps
// 1 → 1.5 → 2 (for GI: 450 → 675 → 900).
function straightDuctLaborSheets(sheets: number): number {
  return Math.max(1, Math.ceil(sheets * 2) / 2);
}

/** Gauge from the calculator's A/B cross-section (longest side in mm → schedule).
 *  Round: both sides equal the diameter, so the schedule uses the diameter. */
function straightDuctGauge(specs: { ductCalcLength?: string; ductCalcWidth?: string; sizeUnit?: string; shape?: string }): string | null {
  const { aMm, bMm } = ductCalcSides(specs);
  if (!(aMm > 0) || !(bMm > 0)) return null;
  // Round uses the round-duct thickness schedule (by diameter); rectangular uses
  // the longest side. Both sides equal the diameter for a round duct.
  const schedule = specs.shape === "Round" ? ROUND_DUCT_GAUGE_SCHEDULE : DUCT_GAUGE_SCHEDULE;
  const longestMm = Math.max(aMm, bMm);
  for (const [maxMm, ga] of schedule) if (longestMm <= maxMm) return ga;
  return "18";
}

/** Sheet price (PHP, VAT-ex) by material, gauge, and — for GI — brand. */
function straightDuctSheetPrice(material: string, gauge: string, brand: string): number | null {
  if (material === "Galvanized Iron") {
    const row = GI_SHEET_PRICE[gauge];
    if (!row || (brand !== "APO" && brand !== "Nihonbond")) return null;
    return brand === "APO" ? row.APO : row.Nihonbond;
  }
  if (material === "Black Iron") return BLACK_IRON_SHEET_PRICE[gauge] ?? null;
  if (material === "Stainless Steel") return STAINLESS_SHEET_PRICE[gauge] ?? null;
  return null;
}

// Duct Connector fabric (canvas) material — length used = 2A + 2B + 2 in, priced
// per meter using the Duct Canvass Connector rates (Fiberglass 600 / PVC 500 /
// Silicone 700 PHP/m, VAT-ex). Shown in the user's order.
const DUCT_CONNECTOR_FABRICS = ["Fiberglass Cloth", "PVC", "Silicone"];
/** Fabric length used (metres) for a Duct Connector, from its A × B cross-section. */
function ductConnectorFabricMeters(specs: { ductCalcLength?: string; ductCalcWidth?: string; sizeUnit?: string; shape?: string }): number {
  const meters = ((ductPerimeterIn(specs) + 2) * 25) / 1000; // perimeter + 2 in → metres (25 mm = 1 in)
  // Fabric is sold whole-metre only — round up (min 1 m when any is needed).
  return meters > 0 ? Math.ceil(meters) : 0;
}
/** Fabric material cost (VAT-ex) for a Duct Connector, or null if none selected. */
function ductConnectorFabricCost(specs: LineSpecs): number | null {
  const price = CANVASS_METER_NET[specs.fabricMaterial ?? ""];
  if (price == null) return null;
  return ductConnectorFabricMeters(specs) * price;
}

// Painted finish (Black Iron only) adds 30% to the duct price.
const DUCT_PAINT_SURCHARGE = 0.3;
/** Whether the painted-finish surcharge applies (Black Iron with Painted ticked). */
function ductCalcPainted(specs: { material?: string; ductPainted?: boolean }): boolean {
  return specs.material === "Black Iron" && !!specs.ductPainted;
}
/** Straight Duct / Duct Connector price (VAT-EXCLUSIVE), or null when incomplete.
 *  Uses the line's effective gauge; Duct Connector adds the canvas fabric cost. */
function straightDuctPriceVatEx(specs: LineSpecs): number | null {
  const gauge = specs.gauge;
  if (!gauge) return null;
  const { aMm, bMm } = ductCalcSides(specs);
  if (!(aMm > 0) || !(bMm > 0)) return null; // need the A × B cross-section entered
  // An Elbow needs its radius R too (its material formula uses A, B and R).
  if (specs.type === "Elbow Duct" && !(elbowMaterialSqIn(specs) > 0)) return null;
  // An Offset needs A, B and L (its material formula uses A, B, L and O).
  if (specs.type === "Offset Duct" && !(offsetMaterialSqIn(specs) > 0)) return null;
  const sheetPrice = straightDuctSheetPrice(specs.material, gauge, specs.bladeType);
  if (sheetPrice == null) return null;
  const laborBase = AIR_DUCT_LABOR_PER_SHEET[specs.material];
  if (laborBase == null) return null;
  // A Duct Reducer takes twice the labour per sheet of a straight duct.
  const labor = isReducerType(specs.type) ? laborBase * 2 : laborBase;
  const sheets = ductSheetsUsed(specs);
  // Labour is billed from the labour sheet count for the type (Duct Connector
  // matches a full duct section; Duct Reducer uses its own blank sheet count).
  const laborSheets = straightDuctLaborSheets(ductLaborSheetCount(specs));
  // Angle-iron flange corners apply only to a flanged duct.
  const angleCost = specs.ductNoFlange ? 0 : STRAIGHT_DUCT_ANGLE_PRICE * STRAIGHT_DUCT_ANGLE_COUNT;
  // Duct Connector also carries the canvas fabric (per-meter) cost, if chosen.
  const fabricCost = specs.type === "Duct Connector" ? ductConnectorFabricCost(specs) ?? 0 : 0;
  const subtotal = sheetPrice * STRAIGHT_DUCT_MARKUP * sheets + angleCost + laborSheets * labor + fabricCost;
  // Painted Black Iron adds 30% to the whole duct price.
  return ductCalcPainted(specs) ? subtotal * (1 + DUCT_PAINT_SURCHARGE) : subtotal;
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
// --- Weather hood (GA20) ----------------------------------------------------
// Priced by size (square side, inches) from a VAT-inclusive list. For an L×W
// entry we take √(area) and round UP to the next listed size (10–36 in).
const WEATHERHOOD_PRICE: Record<number, number> = {
  10: 3419, 11: 3965, 12: 4513, 13: 5056, 14: 5585, 15: 6090, 16: 6565,
  17: 6999, 18: 7385, 19: 7714, 20: 8548, 21: 9424, 22: 9653, 23: 9797,
  24: 9847, 25: 10240, 26: 10834, 27: 11424, 28: 11728, 29: 11981,
  30: 10257, 31: 10953, 32: 11306, 33: 11636, 34: 11940, 35: 12216, 36: 12001,
};
const WEATHERHOOD_MIN = 10;
const WEATHERHOOD_MAX = 36;
/** Over-36" Weather hoods: this NET rate per square inch, then × VAT. */
const WEATHERHOOD_OVER_RATE = 8.5;
/** Powder-coated Weather hood: this finish factor on the Galvanized base. */
const WEATHERHOOD_POWDER_FACTOR = 2.12;
/** The size (next size ≥ √area, floored to 10) chosen for a Weather hood, or null. */
function weatherhoodSize(specs: LineSpecs): number | null {
  if (specs.type !== "Weather hood") return null;
  const area = accAreaSqIn(specs); // trade sq inches (Round = D×D, else L×W)
  if (area == null || area <= 0) return null;
  return Math.max(Math.ceil(Math.sqrt(area)), WEATHERHOOD_MIN);
}
/**
 * VAT-inclusive Weather hood price. Base (Galvanized) is the list price ≤36",
 * else area × net rate × VAT. Material scales the base (GI×1 / Aluminum×3 /
 * Stainless×4). Powder-coated ADDS a ×2.12 charge on the Galvanized base on top
 * of the material price, so changing material never changes the powder portion:
 *   base × material + base × 2.12.
 */
function weatherhoodUnitPrice(specs: LineSpecs): number | null {
  const size = weatherhoodSize(specs);
  if (size == null) return null;
  let base: number | null;
  if (size > WEATHERHOOD_MAX) {
    const area = accAreaSqIn(specs);
    base = area == null ? null : area * WEATHERHOOD_OVER_RATE * (1 + config.vatRate);
  } else {
    base = WEATHERHOOD_PRICE[size] ?? null;
  }
  if (base == null) return null;
  let price = base * (ACC_MATERIAL_FACTOR[specs.material] ?? 1);
  if (specs.powderCoated) price += base * WEATHERHOOD_POWDER_FACTOR;
  return round2(price);
}

/** Auto unit price (VAT-inclusive) for a sized accessory, or null if incomplete. */
function accessoryUnitPrice(specs: LineSpecs): number | null {
  if (specs.type === "Weather hood") return weatherhoodUnitPrice(specs);
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
  // Straight Duct uses a fixed line order:
  //   1 type · 2 dimensions (A × B) · 3 material · 4 gauge · 5 brand (if any).
  if (isDuctCalc(specs)) {
    const dl: string[] = [specs.type || "Straight Duct"];
    const unit = specs.sizeUnit || "inches";
    const unitAbbr = unit === "inches" ? "in" : unit;
    if (specs.shape === "Round") {
      if (specs.ductCalcWidth) dl.push(`Ø${specs.ductCalcWidth} ${unitAbbr}`);
    } else {
      const a = specs.ductCalcLength;
      const b = specs.ductCalcWidth;
      if (a && b) dl.push(`${a} ${unitAbbr} x ${b} ${unitAbbr}`);
    }
    if (AIR_DUCT_MATERIALS.includes(specs.material)) dl.push(`${accMaterialLabel(specs.material)} Material`);
    if (specs.gauge) dl.push(`Gauge ${specs.gauge}`);
    if (specs.material === "Galvanized Iron" && AIR_DUCT_SEALANTS.includes(specs.bladeType)) {
      dl.push(`${specs.bladeType} Brand`);
    }
    if (specs.type === "Duct Connector" && DUCT_CONNECTOR_FABRICS.includes(specs.fabricMaterial ?? "")) {
      dl.push(`${specs.fabricMaterial} Fabric`);
    }
    if (ductCalcPainted(specs)) dl.push("Painted");
    return dl.join("\n");
  }
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
  if (
    ACC_MATERIALS.includes(specs.material) ||
    VENT_CAP_MATERIALS.includes(specs.material) ||
    AIR_DUCT_MATERIALS.includes(specs.material)
  ) {
    lines.push(`${accMaterialLabel(specs.material)} Material`);
    // Finish follows the material. Powder coating can be applied to any material
    // that offers it (incl. Vent Cap on stainless). Otherwise: air terminals
    // carry oven-baked enamel, but stainless / dampers / motorized carry none.
    const canPowder = POWDER_COAT_TYPES.has(specs.type) || specs.type === "Vent Cap";
    if (!MOTORIZED_DAMPER_TYPES.has(specs.type)) {
      if (canPowder && specs.powderCoated) {
        lines.push("Powder Coated Finish");
      } else if (
        !isStainlessMaterial(specs.material) &&
        specs.type !== "Weather hood" &&
        groupForType(specs.category, specs.type) === "Air Terminals"
      ) {
        lines.push("Painted with Oven Baked Enamel");
      }
    }
  }
  // Air Duct sealant brand (stored in bladeType) — Galvanized Iron only; Black
  // Iron and Stainless Steel use a single, brand-independent price.
  if (isAirDuct(specs) && specs.material === "Galvanized Iron" && AIR_DUCT_SEALANTS.includes(specs.bladeType)) {
    lines.push(`${specs.bladeType} Brand`);
  }
  // Air Duct recommended sheet gauge (from the longest-side thickness schedule).
  if (isAirDuct(specs) && specs.gauge) {
    lines.push(`${specs.gauge} ga`);
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
 *   up to 499 pcs      → none                (×1.00)
 *   500–4,999 pcs      → less 10%            (×0.90)
 *   5,000–9,999 pcs    → less 10% + less 10% (×0.81)
 *   10,000+ pcs        → less 10% + less 15% (×0.765)
 */
function angleCornerDiscountFactor(qty: number): number {
  if (qty >= 10000) return 0.9 * 0.85;
  if (qty >= 5000) return 0.9 * 0.9;
  if (qty >= 500) return 0.9;
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
  axialSpLock = true,
}: {
  quotation: Quote;
  templates: { id: string; name: string; layoutKey: string; specNote: string; terms: string }[];
  canApprove: boolean;
  isAdmin?: boolean;
  isPreparer?: boolean;
  revisionHistory?: RevisionSnapshot[];
  catalog: Record<string, CatalogEntry>;
  propellerSpLock?: boolean;
  axialSpLock?: boolean;
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
  // Live duplicate detection: existing quotes with the identical current item set.
  const [dupMatches, setDupMatches] = useState<DuplicateMatch[]>([]);
  const [templateId, setTemplateId] = useState(quotation.templateId);
  const [projectName, setProjectName] = useState(quotation.projectName);
  const [vatMode, setVatMode] = useState(quotation.vatMode);
  const [pricing, setPricing] = useState<PricingAdjust>(quotation.pricing);
  const setPricingField = <K extends keyof PricingAdjust>(k: K, v: PricingAdjust[K]) =>
    setPricing((p) => ({ ...p, [k]: v }));
  const [units, setUnits] = useState(() => ({
    capacity: quotation.headerUnits.capacity || "cfm",
    pressure: quotation.headerUnits.pressure || "in-w.g.",
    motor: quotation.headerUnits.motor || "HP",
  }));
  // Static-pressure lock: the line's SP exceeds its type's cap AND the governing
  // admin toggle (propeller / axial) is on. Blocks Run selection and shows a warning.
  const isSpBlocked = (specs: LineSpecs): boolean => {
    const group = spLockGroup(specs);
    if (!group) return false;
    const lockOn = group === "propeller" ? propellerSpLock : axialSpLock;
    return lockOn && spOverCap(specs, units.pressure);
  };
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
  const [alphaRan, setAlphaRan] = useState<Record<string, boolean>>({});

  // The quote's template follows the highest-priority product family present
  // (Standard Fans & Blowers > KDK > Air Terminals & Ducts) — "the top product
  // decides". This applies on load and whenever the product mix changes, and it
  // overrides any current template (including a manually chosen Power Roof
  // Ventilator / Wind Driven / Services), because those manual-only patterns are
  // only meant to stand when NO fan / KDK / air-terminal product is present.
  // Switching resets the terms/note to the new pattern, and the header units to
  // the blower defaults for a Standard switch. The salesperson can still override
  // in the dropdown; that override holds until the product family changes again.
  const autoLayoutKey = useMemo(() => autoTemplateLayoutKey(lines.map((l) => l.specs)), [lines]);
  const templateManual = useRef(false);
  const prevAutoKey = useRef<string | null>(null);
  useEffect(() => {
    if (autoLayoutKey !== prevAutoKey.current) {
      prevAutoKey.current = autoLayoutKey;
      templateManual.current = false; // product family changed → auto re-asserts
    }
    if (!editable || templateManual.current || !autoLayoutKey) return;
    const currentKey = templates.find((t) => t.id === templateId)?.layoutKey ?? null;
    if (currentKey === autoLayoutKey) return; // already on the right pattern
    const t = templates.find((x) => x.layoutKey === autoLayoutKey);
    if (!t) return;
    setTemplateId(t.id);
    setNotes(t.specNote);
    setTerms(t.terms);
    if (autoLayoutKey === "standard") setUnits({ capacity: "cfm", pressure: "in-w.g.", motor: "HP" });
  }, [autoLayoutKey, editable, templates, templateId]);

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
    const { markupAmt, afterMarkup, discountAmt, finalNet } = applyPricing(displayedNet, pricing);
    const addVat = effectiveVatMode === "EXCLUSIVE_PLUS";
    const vatAmt = addVat ? finalNet * vatRate : 0;
    const grandTotal = finalNet + vatAmt;
    return { net, vat: gross - net, gross, exclusive, displayedNet, markupAmt, afterMarkup, discountAmt, finalNet, addVat, vatAmt, grandTotal };
  }, [lines, vatRate, effectiveVatMode, pricing]);

  // Live "duplicate quote" check: as the line items change, look for existing
  // quotes with the identical item set (debounced; DRAFT only).
  useEffect(() => {
    if (!editable) { setDupMatches([]); return; }
    const items = lines
      .filter((l) => l.specs.type)
      .map((l) => ({
        specsSnapshot: { ...l.rawSpecs, ...l.specs } as Record<string, unknown>,
        qty: l.qty,
        catalogueItemId: null,
        unitPrice: l.unitPrice,
        lineTotal: lineGross(l),
      }));
    if (!items.length) { setDupMatches([]); return; }
    const t = setTimeout(() => {
      checkDuplicateQuote(items, quotation.id).then(setDupMatches).catch(() => setDupMatches([]));
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, editable]);

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
            ? "Spring Vibration Isolator\nNo spring required (not spring-mounted)"
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
  // Change the header pressure unit and re-lock any Customized Jet Fan line's
  // static pressure to 0.5" w.g. expressed in the new unit.
  function setPressureUnit(u: string) {
    const pu = normalizePressureUnit(u) ?? "inwg";
    const sp05 = Math.round(convertPressure(0.5, "inwg", pu) * 100) / 100;
    setUnits((prev) => ({ ...prev, pressure: u }));
    setLines((ls) => ls.map((l) => (isCustomJetFan(l.specs) ? { ...l, specs: { ...l.specs, staticPressure_pa: sp05 } } : l)));
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
        return { ...l, specs, descriptionSnapshot: buildKdkDescription(specs.type, specs.blowerModel, specs.bladeType, specs.brand) };
      }),
    );
  }
  // Apply a chosen AlphaAir cassette: VAT-inclusive selling price, model + duct in
  // the description, rated power; single-phase 220 V like other prebuilt units.
  function applyAlphaCassette(lineId: string, c: AlphaCassette) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== lineId) return l;
        const specs: LineSpecs = {
          ...l.specs,
          blowerModel: `${c.model} (${c.duct})`,
          bodyPrice: round2(c.price / (1 + vatRate)),
          power_w: c.powerW,
          motorHp: null, motorPole: null, motorPh: 1, motorVolts: 220, inches: null,
        };
        return {
          ...l,
          specs,
          unitPrice: round2(c.price), // pricelist is VAT-inclusive
          descriptionSnapshot: buildKdkDescription(specs.type, specs.blowerModel, specs.bladeType, specs.brand),
        };
      }),
    );
    setAlphaRan((m) => ({ ...m, [lineId]: false }));
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
        // Air Duct brand (APO/Nihonbond) only applies to Galvanized Iron; drop a
        // stale brand when the material is Black Iron / Stainless Steel.
        if (isAirDuct(specs) && specs.material !== "Galvanized Iron") specs.bladeType = "";
        // Straight Duct in Black Iron / Stainless Steel is fabricated flange-less,
        // so No Flange is forced on (the checkbox is locked in the UI). Only
        // Galvanized Iron can be flanged.
        if (isDuctCalc(specs) && (specs.material === "Black Iron" || specs.material === "Stainless Steel")) {
          specs.ductNoFlange = true;
        }
        // Painted finish is a Black Iron option only — drop a stale flag otherwise.
        if (specs.material !== "Black Iron") specs.ductPainted = false;
        // Air Duct: switching shape (Round ↔ Square/Rectangle) converts the cross
        // section by equal area, rounding UP to the next even number (20×20 → Ø24;
        // Ø24 → 22×22). The calc types use the A/B fields; other air ducts use the
        // box L/W. The reducer/elbow height (H/R) is left unchanged.
        if ("shape" in patch && isAirDuct(specs)) {
          if (isDuctCalc(specs)) {
            const r = convertDuctShape(l.specs.shape, specs.shape, specs.ductCalcWidth, specs.ductCalcLength);
            specs.ductCalcWidth = r.w;
            specs.ductCalcLength = r.l;
          } else {
            const r = convertDuctShape(l.specs.shape, specs.shape, specs.sizeL, specs.sizeW);
            specs.sizeL = r.w;
            specs.sizeW = r.l;
          }
        }
        // A Duct Connector always carries a canvas fabric — if none is set yet,
        // default to the first fabric so its per-meter cost is always charged.
        if (specs.type === "Duct Connector" && !DUCT_CONNECTOR_FABRICS.includes(specs.fabricMaterial ?? "")) {
          specs.fabricMaterial = DUCT_CONNECTOR_FABRICS[0];
        }
        // Air Duct "Recommend": auto-pick the sheet gauge from the duct's longest
        // side, recomputed on any dimension / shape / unit change (cleared when
        // off). Straight Duct manages its own gauge (manual dropdown + Recommend)
        // in its branch below, so it's excluded here.
        if (isAirDuct(specs) && !isDuctCalc(specs)) {
          specs.gauge = specs.mcRecommend ? recommendedDuctGauge(specs) ?? "" : "";
        }
        // Straight Duct: auto-priced from the calculator's A × B cross-section.
        // The gauge is either recommended (ticking "Recommend" picks it from the
        // A/B inputs and locks the dropdown) or chosen manually from the Gauge
        // dropdown; that gauge drives the Duct Price and the description. Price
        // is VAT-ex → store VAT-inclusive.
        if (isDuctCalc(specs)) {
          // Duct Reducer: the Height field shows the size's standard height by
          // default. Refresh it to the new standard whenever the A/B opening
          // changes (so changing dimensions always shows the current standard),
          // and fill it in when it's blank. A custom height the user types while
          // the size is unchanged is kept (to raise H above standard → doubles).
          if (isReducerType(specs.type) && specs.type !== "Elbow Duct" && specs.type !== "Offset Duct") {
            const dimsChanged =
              ("ductCalcLength" in patch || "ductCalcWidth" in patch) && !("sizeUnit" in patch);
            const newStd = reducerStandardHeightInUnit(specs);
            const curH = parseFloat(specs.ductCalcHeight ?? "");
            if (newStd != null && (dimsChanged || !(curH > 0))) {
              specs.ductCalcHeight = String(newStd);
            }
          }
          const gauge = specs.mcRecommend ? straightDuctGauge(specs) ?? "" : specs.gauge ?? "";
          const s2: LineSpecs = { ...specs, gauge };
          const priceVatEx = gauge ? straightDuctPriceVatEx(s2) : null;
          return {
            ...l,
            specs: s2,
            descriptionSnapshot: buildAccessoryDescription(s2),
            ...(priceVatEx != null
              ? { unitPrice: round2(priceVatEx * (1 + vatRate)) }
              : resetPrice
                ? { unitPrice: 0 }
                : {}),
          };
        }
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
          // Explosion-proof is 3-phase 4-pole only — drop the flag otherwise.
          if (s2.exproof && !inductionExEligible(s2)) s2.exproof = false;
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
            s2 = { ...specs, motorHp: null, motorPole: null, motorPh: 1, motorVolts: 220, inches: null };
            // Fill the rating columns only when the model publishes a rating.
            if (m.cmh > 0) {
              s2 = {
                ...s2,
                capacity_cfm: fmtFlow(convertAirflow(m.cmh, "m3hr", capUnit)),
                staticPressure_pa: Math.round(convertPressure(m.pa, "pa", pUnit) * 100) / 100,
                power_w: m.watt,
              };
            }
          }
          const price = jetFanUnitPrice(s2, vatRate);
          return {
            ...l,
            specs: s2,
            descriptionSnapshot: buildJetFanDescription(s2),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Poultry Fan (ADH): price by model; the model rating fills the Capacity /
        // Static pressure / Motor columns. Single-phase, 220 V.
        if (isPoultryFan(specs)) {
          const m = specs.blowerModel ? POULTRY_FAN[specs.blowerModel] : null;
          let s2 = specs;
          if (m) {
            const capUnit = normalizeAirflowUnit(units.capacity) ?? "m3hr";
            const pUnit = normalizePressureUnit(units.pressure) ?? "pa";
            s2 = {
              ...specs,
              capacity_cfm: fmtFlow(convertAirflow(m.cmh, "m3hr", capUnit)),
              staticPressure_pa: Math.round(convertPressure(m.pa, "pa", pUnit) * 100) / 100,
              power_w: m.watt,
              inches: m.inch, // fan size (in) → Size column, not the description
              motorHp: null, motorPole: null, motorPh: 1, motorVolts: 220,
            };
          }
          const price = poultryFanUnitPrice(s2, vatRate);
          return {
            ...l,
            specs: s2,
            descriptionSnapshot: buildPoultryFanDescription(s2),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // HVLS (AAHVPM): price by model; spec lives in the description (no columns
        // fit). PMSM motor, single-phase 220 V; power stored from the kW rating.
        if (isHvls(specs)) {
          const m = specs.blowerModel ? HVLS_FAN[specs.blowerModel] : null;
          let s2 = specs;
          if (m) {
            const capUnit = normalizeAirflowUnit(units.capacity) ?? "m3hr";
            s2 = {
              ...specs,
              capacity_cfm: fmtFlow(convertAirflow(m.airMin, "m3min", capUnit)), // air volume → Capacity column
              staticPressure_pa: null,
              inches: m.ft, // fan diameter (ft) → Size column
              power_w: Math.round(m.kw * 1000), // → motor column (W)
              motorHp: null, motorPole: null, motorPh: 1, motorVolts: 220,
            };
          }
          const price = hvlsUnitPrice(s2, vatRate);
          return {
            ...l,
            specs: s2,
            descriptionSnapshot: buildHvlsDescription(s2),
            ...(price != null ? { unitPrice: price } : resetPrice ? { unitPrice: 0 } : {}),
          };
        }
        // Dust Collector: price by model; the description is the model's full spec
        // block. No rating columns are populated (all specs live in the text).
        if (isDustCollector(specs)) {
          const s2: LineSpecs = {
            ...specs,
            capacity_cfm: null,
            staticPressure_pa: null,
            inches: null,
            power_w: null,
            motorHp: null,
            motorPole: null,
            motorPh: null,
            motorVolts: null,
          };
          const price = dustCollectorUnitPrice(s2, vatRate);
          return {
            ...l,
            specs: s2,
            descriptionSnapshot: buildDustCollectorDescription(s2),
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
        // 1-phase motors are 220V, 4-pole only — snap so the model code resolves.
        if (specs.motorPh === 1) {
          specs.motorVolts = 220;
          specs.motorPole = 4;
        }
        // Blade material can't repeat the body material (the body factor already
        // covers the whole body) — pick the first different option when it would.
        if (specs.bladeMaterialOn && (!specs.bladeMaterial || specs.bladeMaterial === specs.material)) {
          specs.bladeMaterial = MATERIAL_OPTIONS.find((m) => m !== specs.material) ?? specs.bladeMaterial;
        }
        // Keep the paint upgrade valid for the current material: drop it when the
        // material allows none (stainless), else snap to an allowed paint type.
        if (specs.upgradePaint) {
          const allowed = paintOptionsFor(specs.material);
          if (allowed.length === 0) {
            specs.upgradePaint = false;
            specs.paintType = "";
          } else if (!allowed.includes(specs.paintType ?? "")) {
            specs.paintType = allowed[0];
          }
        }
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
                specs.blowerModel ? displayBlowerModel(specs) : null,
                specs.bladeMaterialOn ? specs.bladeMaterial : null,
                paintDescLine(specs),
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
        const combined = combinedModel(displayBlowerModel(specs), mModel);
        const withModel = specs.blowerModel
          ? rewriteModelLine(l.descriptionSnapshot, combined)
          : l.descriptionSnapshot;
        const descriptionSnapshot = isBlower
          ? buildBlowerDescription(specs.type, specs.bladeType, specs.drive, specs.material, specs.blowerModel ? combined : null, specs.bladeMaterialOn ? specs.bladeMaterial : null, paintDescLine(specs))
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
    if (isCustomJetFan(line.specs)) sp = 0.5; // Customized Jet Fan is locked to 0.5" w.g.
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
            descriptionSnapshot: buildKdkDescription(specs.type, model, specs.bladeType, specs.brand),
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
        const combined = combinedModel(displayBlowerModel(specs), mModel);
        const descriptionSnapshot = MATERIAL_CATEGORIES.has(specs.category)
          ? buildBlowerDescription(specs.type, specs.bladeType, specs.drive, specs.material, combined, specs.bladeMaterialOn ? specs.bladeMaterial : null, paintDescLine(specs))
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
        {
          templateId,
          notes,
          terms,
          validUntil: validUntil || undefined,
          projectName,
          vatMode: effectiveVatMode,
          // Legacy column kept in sync for older readers: a percent discount maps
          // through; an amount discount can't be expressed as a %, so store 0.
          discountPct: pricing.discountMode === "percent" ? pricing.discountValue : 0,
          pricing,
          headerUnits: units,
        },
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

  // Apply a Type selection to a line, running the per-type initialisation (reset
  // fields, seed the description, route to the right pricing handler). Category
  // and the brand/group field are passed in, so this is driven both by the Type
  // dropdown and by the product search (which pre-fills category + brand first).
  function selectProductType(lineId: string, category: string, brand: string, type: string) {
    if (PROPELLER_FAN_TYPES.has(type)) {
      applyMotor(lineId, { type, bladeType: "Propeller", shape: "", sizeL: "", sizeW: "" });
    } else if (type === "Customized Jet Fan") {
      const pUnit = normalizePressureUnit(units.pressure) ?? "inwg";
      const sp05 = Math.round(convertPressure(0.5, "inwg", pUnit) * 100) / 100;
      applyMotor(lineId, { type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "", staticPressure_pa: sp05 });
    } else if (type === "Portable Axial Blower" || type === "Portable Axial Blower (XProof)") {
      applyAccessory(lineId, { type, shape: "", sizeUnit: "", sizeL: "", sizeW: "", bladeType: portableBlowerDuctTypes({ type })[0], drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false }, true);
    } else if (type === "Variable Air Volume") {
      applyAccessory(lineId, { type, bladeType: "by Volume Flow", sizeUnit: "cfm", sizeL: "", sizeW: "", shape: "", drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false }, true);
    } else if (type === "Induction Motor (TECO)" || type === "Induction Motor (Hyundai)") {
      applyAccessory(lineId, { type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "", sizeUnit: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false, motorPh: 3, motorPole: 4, motorHp: null, motorVolts: 220 }, true);
    } else if (MATERIAL_CATEGORIES.has(category)) {
      applyMotor(lineId, { type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" });
    } else if (brand === "KDK" || type === "Ceiling Cassette") {
      applyKdk(lineId, { type, blowerModel: null, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" });
    } else if (type === "Motor Controller") {
      applyMotorController(lineId, { type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "", blowerModel: null, capacity_cfm: null, staticPressure_pa: null, inches: null, power_w: null });
    } else if (type === "Spring Vibration Isolator") {
      applyIsolator(lineId, { type, shape: "", sizeL: "", sizeW: "" });
    } else if (DUCT_HARDWARE_TYPES.has(type)) {
      applyAccessory(lineId, { type, gauge: "", cleatSize: "", shape: "", sizeL: "", sizeW: "", sizeUnit: "", material: "Galvanized Iron", powderCoated: false }, true);
    } else if (type === "Vent Cap") {
      applyAccessory(lineId, { type, shape: "Round", sizeUnit: "inches", sizeL: "", sizeW: "", material: "", powderCoated: false }, true);
    } else if (type === "Duct Canvass Connector") {
      applyAccessory(lineId, { type, shape: "", sizeL: "", sizeW: "", sizeUnit: "", gauge: "", cleatSize: "", material: "", canvassUnit: "per meter", powderCoated: false }, true);
    } else if (type === "Wind Driven Roof Ventilator") {
      applyAccessory(lineId, { type, shape: "Round", sizeUnit: "inches", sizeL: "", sizeW: "", bladeType: "", drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false }, true);
    } else if (type === "Aluminum Duct") {
      applyAccessory(lineId, { type, shape: "", sizeUnit: "", sizeL: "", sizeW: "", bladeType: "", drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false }, true);
    } else if (type === "Jet Fan" || type === "Commercial Type Exhaust Fan" || type === "HVLS" || type === "Dust Collector") {
      applyAccessory(lineId, { type, blowerModel: null, shape: "", sizeUnit: "", sizeL: "", sizeW: "", bladeType: "", drive: "", gauge: "", cleatSize: "", canvassUnit: "", material: "", powderCoated: false }, true);
    } else if (type === "Inline Duct Fan") {
      setLines((ls) =>
        ls.map((x) =>
          x.id === lineId
            ? {
                ...x,
                specs: { ...x.specs, type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "", blowerModel: null },
                descriptionSnapshot: buildInlineFanDescription(null),
              }
            : x,
        ),
      );
    } else if (category === "Ventilation Accessories") {
      // Duct Connector always carries a canvas fabric, so default to the first
      // fabric (Fiberglass Cloth) — its per-meter cost is charged straight away
      // and the user can switch fabrics from the dropdown.
      applyAccessory(lineId, { type, shape: "", sizeL: "", sizeW: "", sizeUnit: DUCT_CALC_TYPES.has(type) ? "inches" : "", material: "", powderCoated: false, bladeType: "", gauge: "", mcRecommend: false, ductCalcLength: "", ductCalcWidth: "", ductCalcHeight: "", ductCalcOffset: "", ductNoFlange: false, ductPainted: false, fabricMaterial: type === "Duct Connector" ? DUCT_CONNECTOR_FABRICS[0] : "" }, true);
    } else {
      updateSpec(lineId, { type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" });
    }
  }

  // Product search selection: pre-fill category + brand/group, then apply the Type
  // (which runs the per-type init above). The remaining dropdowns follow the Type.
  function applyProductSearch(lineId: string, item: ProductSearchItem) {
    updateSpec(lineId, {
      category: item.category,
      brand: item.brandField,
      type: "", bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "", blowerModel: null,
    });
    selectProductType(lineId, item.category, item.brandField, item.type);
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
        {/* Type-ahead product search — fills category + brand/group + type, then
            the product-specific details/table appear and the rest is chosen below. */}
        <ProductSearch disabled={!editable} onSelect={(item) => applyProductSearch(l.id, item)} />
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
            onChange={(e) => selectProductType(l.id, c.category, c.brand, e.target.value)}
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
              {/* Explosion-proof — 3-phase 4-pole only (uses the EX price list). */}
              {inductionExEligible(c) && (
                <label className="flex h-9 items-center gap-1.5 whitespace-nowrap text-xs">
                  <input type="checkbox" className="h-4 w-4" disabled={!editable}
                    checked={!!c.exproof}
                    onChange={(e) => {
                      const on = e.target.checked;
                      const dropHp = on && c.motorHp != null && !hasExproofPrice(c.motorHp);
                      applyAccessory(l.id, { exproof: on, ...(dropHp ? { motorHp: null } : {}) });
                    }} />
                  Xproof
                </label>
              )}
            </>
          ) : isJetFan(c) ? (
            // Jet Fan: model dropdown — MaxAir (MA) or AlphaAir (AJF) by brand.
            <Select
              value={c.blowerModel || ""}
              disabled={!editable || !c.type}
              onChange={(e) => applyAccessory(l.id, { blowerModel: e.target.value || null })}
            >
              <option value="" disabled>Model…</option>
              {jetFanModelsFor(c.brand).map((m) => (<option key={m} value={m}>{m}</option>))}
            </Select>
          ) : isPoultryFan(c) ? (
            // Poultry Fan: model dropdown (AlphaAir ADH series).
            <Select
              value={c.blowerModel || ""}
              disabled={!editable || !c.type}
              onChange={(e) => applyAccessory(l.id, { blowerModel: e.target.value || null })}
            >
              <option value="" disabled>Model…</option>
              {POULTRY_FAN_MODELS.map((m) => (<option key={m} value={m}>{m} ({POULTRY_FAN[m].size})</option>))}
            </Select>
          ) : isHvls(c) ? (
            // HVLS: model dropdown (AlphaAir AAHVPM series).
            <Select
              value={c.blowerModel || ""}
              disabled={!editable || !c.type}
              onChange={(e) => applyAccessory(l.id, { blowerModel: e.target.value || null })}
            >
              <option value="" disabled>Model…</option>
              {HVLS_MODELS.map((m) => (<option key={m} value={m}>{m} ({HVLS_FAN[m].ft} ft)</option>))}
            </Select>
          ) : isDustCollector(c) ? (
            // Dust Collector: model dropdown (META Taiwan CT series).
            <Select
              value={c.blowerModel || ""}
              disabled={!editable || !c.type}
              onChange={(e) => applyAccessory(l.id, { blowerModel: e.target.value || null })}
            >
              <option value="" disabled>Model…</option>
              {DUST_COLLECTOR_MODELS.map((m) => (<option key={m} value={m}>{m}</option>))}
            </Select>
          ) : c.category === "Ventilation Accessories" ? (
            <>
              {/* Air Duct: Material then sealant brand sit right after Type. */}
              {isAirDuct(c) && (
                <>
                  <Select
                    value={AIR_DUCT_MATERIALS.includes(c.material) ? c.material : ""}
                    disabled={!editable || !c.type}
                    onChange={(e) => applyAccessory(l.id, { material: e.target.value })}
                  >
                    <option value="" disabled>Material…</option>
                    {AIR_DUCT_MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
                  </Select>
                  {/* Brand (sheet supplier) applies to Galvanized Iron only; Black
                      Iron and Stainless Steel use a single, brand-independent price. */}
                  {c.material === "Galvanized Iron" && (
                    <Select
                      value={AIR_DUCT_SEALANTS.includes(c.bladeType) ? c.bladeType : ""}
                      disabled={!editable || !c.type}
                      onChange={(e) => applyAccessory(l.id, { bladeType: e.target.value })}
                    >
                      <option value="" disabled>Brand…</option>
                      {AIR_DUCT_SEALANTS.map((s) => (<option key={s} value={s}>{s}</option>))}
                    </Select>
                  )}
                </>
              )}
              <Select
                // Legacy lines stored "Square" before it became "Square/Rectangle".
                value={c.shape === "Square" ? "Square/Rectangle" : c.shape}
                disabled={!editable || !c.type || (isIsolator(c) && !!c.mcRecommend)}
                onChange={(e) => (isIsolator(c) ? applyIsolator(l.id, { shape: e.target.value }) : applyAccessory(l.id, { shape: e.target.value }))}
              >
                <option value="">{variantLabel(c.type)}…</option>
                {shapesFor(c.type).map((s) => (<option key={s} value={s}>{s}</option>))}
              </Select>
              {/* Straight Duct: sheet gauge. Manually selectable, or auto-picked
                  and locked when Recommend is on (which sets c.gauge). */}
              {isDuctCalc(c) && (
                <Select
                  value={STRAIGHT_DUCT_GAUGES.includes(c.gauge ?? "") ? c.gauge : ""}
                  disabled={!editable || !c.type || !!c.mcRecommend}
                  onChange={(e) => applyAccessory(l.id, { gauge: e.target.value })}
                >
                  <option value="" disabled>Gauge…</option>
                  {STRAIGHT_DUCT_GAUGES.map((g) => (<option key={g} value={g}>{g} ga</option>))}
                </Select>
              )}
              {/* Unit of measurement for the dimensions (selected accessories). */}
              {UOM_TYPES.has(c.type) && (
                <Select
                  value={c.sizeUnit || ""}
                  disabled={!editable || !c.type}
                  onChange={(e) => {
                    const to = e.target.value;
                    // Straight Duct's dimensions live in the calculator and default
                    // to inches; other accessories default to mm.
                    const from = c.sizeUnit || (isDuctCalc(c) ? "inches" : "mm");
                    // Convert the entered dimensions to the new unit (trade ratio) —
                    // both the box L/W and the Straight Duct calculator's A/B.
                    applyAccessory(l.id, {
                      sizeUnit: to,
                      sizeL: convertAccSize(c.sizeL, from, to),
                      sizeW: convertAccSize(c.sizeW, from, to),
                      ductCalcLength: convertAccSize(c.ductCalcLength ?? "", from, to),
                      ductCalcWidth: convertAccSize(c.ductCalcWidth ?? "", from, to),
                      ductCalcHeight: convertAccSize(c.ductCalcHeight ?? "", from, to),
                      ductCalcOffset: convertAccSize(c.ductCalcOffset ?? "", from, to),
                    });
                  }}
                >
                  <option value="" disabled>Unit of Measurement…</option>
                  {SIZE_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
                </Select>
              )}
              {/* Duct Connector: canvas fabric material (per-meter price). Sits
                  after the unit and before the Recommend checkbox. */}
              {c.type === "Duct Connector" && (
                <Select
                  value={DUCT_CONNECTOR_FABRICS.includes(c.fabricMaterial ?? "") ? c.fabricMaterial : ""}
                  disabled={!editable || !c.type}
                  onChange={(e) => applyAccessory(l.id, { fabricMaterial: e.target.value })}
                >
                  <option value="" disabled>Fabric Material…</option>
                  {DUCT_CONNECTOR_FABRICS.map((m) => (<option key={m} value={m}>{m}</option>))}
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
              ) : isDuctCalc(c) ? (
                // Straight Duct / Connector / Reducer are sized in their own
                // calculator table (A × B, or a single Diameter when Round), so
                // the box's top-row size input is omitted here — including the
                // round diameter, which moves into the table.
                null
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
              {/* Air Duct: auto-pick the sheet gauge from the duct's dimensions
                  (box L × W for most types; the Duct Price Calculator's A × B for
                  Straight Duct). Ticking it fills the gauge and, for Straight
                  Duct, the Duct Price. */}
              {isAirDuct(c) && (
                <label className="flex h-9 items-center gap-1.5 whitespace-nowrap text-sm">
                  <input type="checkbox" className="h-4 w-4" disabled={!editable || !c.type}
                    checked={!!c.mcRecommend}
                    onChange={(e) => applyAccessory(l.id, { mcRecommend: e.target.checked })} />
                  Recommend{c.mcRecommend && c.gauge ? ` (${c.gauge} ga)` : ""}
                </label>
              )}
              {/* Straight Duct: No Flange drops the angle-iron flange (₱15 × 8)
                  and makes the standard body a full 1.2 m (flanged = 1.1 m).
                  Black Iron / Stainless Steel are flange-less, so it's forced on
                  and locked; only Galvanized Iron can be flanged. */}
              {isDuctCalc(c) && (() => {
                const flangeless = c.material === "Black Iron" || c.material === "Stainless Steel";
                return (
                  <label className="flex h-9 items-center gap-1.5 whitespace-nowrap text-sm">
                    <input type="checkbox" className="h-4 w-4" disabled={!editable || !c.type || flangeless}
                      checked={!!c.ductNoFlange}
                      onChange={(e) => applyAccessory(l.id, { ductNoFlange: e.target.checked })} />
                    No Flange
                  </label>
                );
              })()}
              {/* Painted finish — Black Iron only; adds 30% to the duct price. */}
              {isDuctCalc(c) && c.material === "Black Iron" && (
                <label className="flex h-9 items-center gap-1.5 whitespace-nowrap text-sm">
                  <input type="checkbox" className="h-4 w-4" disabled={!editable || !c.type}
                    checked={!!c.ductPainted}
                    onChange={(e) => applyAccessory(l.id, { ductPainted: e.target.checked })} />
                  Painted
                </label>
              )}
              {/* Material (Air Terminals / Dampers). Air Duct shows its own material
                  dropdown right after Type, so it's skipped here. */}
              {!isIsolator(c) && !isAirDuct(c) && (
                <Select
                  value={ACC_MATERIALS.includes(c.material) ? c.material : ""}
                  disabled={!editable || !c.type}
                  onChange={(e) => applyAccessory(l.id, { material: e.target.value })}
                >
                  <option value="" disabled>Material…</option>
                  {ACC_MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
                </Select>
              )}
              {/* Powder-coat finish — supported types only; not for any stainless. */}
              {POWDER_COAT_TYPES.has(c.type) && !isStainlessMaterial(c.material) && (
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
          ) : isPrebuiltUnit(c) || isMotorController(c) || isInlineFan(c) || c.brand === "AlphaAir" ? (
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
                {bladeTypesFor(c.category, c.type).map((b) => (<option key={b} value={b}>{b}</option>))}
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
          {!isPrebuiltUnit(c) && !isMotorController(c) && !isCanvass(c) && !isWindVent(c) && !isAluDuct(c) && !isPortableBlowerFamily(c) && !isVav(c) && !isInductionMotor(c) && !isDustCollector(c) && !isInlineFan(c) && !isJetFan(c) && c.brand !== "AlphaAir" && c.category !== "Ventilation Accessories" && (
            <Select
              value={c.material || "Black Iron Sheet"}
              disabled={!editable}
              onChange={(e) => applyMotor(l.id, { material: e.target.value })}
            >
              {MATERIAL_OPTIONS.map((m) => (<option key={m} value={m}>{m}</option>))}
            </Select>
          )}
          {/* Separate blade material — off = standard Black Iron Sheet. */}
          {MATERIAL_CATEGORIES.has(c.category) && (
            <label className="flex h-9 items-center gap-1.5 whitespace-nowrap text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                disabled={!editable}
                checked={!!c.bladeMaterialOn}
                onChange={(e) => applyMotor(l.id, { bladeMaterialOn: e.target.checked })}
              />
              Blade material
            </label>
          )}
          {MATERIAL_CATEGORIES.has(c.category) && c.bladeMaterialOn && (
            <Select
              value={c.bladeMaterial || ""}
              disabled={!editable}
              onChange={(e) => applyMotor(l.id, { bladeMaterial: e.target.value })}
            >
              {/* The body material is excluded so its factor isn't applied twice. */}
              {MATERIAL_OPTIONS.filter((m) => m !== c.material).map((m) => (<option key={m} value={m}>{m}</option>))}
            </Select>
          )}
          {/* Customized (bespoke) unit — body priced ×1.2 (a +20% uplift). */}
          {MATERIAL_CATEGORIES.has(c.category) && (
            <label className="flex h-9 items-center gap-1.5 whitespace-nowrap text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                disabled={!editable}
                checked={!!c.customizedUnit}
                onChange={(e) => applyMotor(l.id, { customizedUnit: e.target.checked })}
              />
              Customized unit
            </label>
          )}
          {/* Paint upgrade — Powder Coat (×1.5) / High Temperature (×1.3) on the base.
              Options depend on the body material; some materials offer none. */}
          {MATERIAL_CATEGORIES.has(c.category) && paintOptionsFor(c.material).length > 0 && (
            <label className="flex h-9 items-center gap-1.5 whitespace-nowrap text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                disabled={!editable}
                checked={!!c.upgradePaint}
                onChange={(e) => applyMotor(l.id, { upgradePaint: e.target.checked })}
              />
              Upgrade Paint
            </label>
          )}
          {MATERIAL_CATEGORIES.has(c.category) && c.upgradePaint && paintOptionsFor(c.material).length > 0 && (
            <Select
              value={c.paintType || ""}
              disabled={!editable}
              onChange={(e) => applyMotor(l.id, { paintType: e.target.value })}
            >
              {paintOptionsFor(c.material).map((p) => (<option key={p} value={p}>{p}</option>))}
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
        {isDuctCalc(c) && (() => {
          const sheets = ductSheetsUsed(c);
          const calcUnit = c.sizeUnit || "inches";
          // Effective gauge: recommended (from A × B) when Recommend is on, else
          // the manually selected Gauge dropdown value. It drives the Duct Price.
          const ductGauge = c.mcRecommend ? straightDuctGauge(c) : c.gauge || null;
          const priceVatEx = ductGauge ? straightDuctPriceVatEx({ ...c, gauge: ductGauge }) : null;
          // Duct price breakdown (each term of straightDuctPriceVatEx), shown below.
          const sheetPrice = ductGauge ? straightDuctSheetPrice(c.material, ductGauge, c.bladeType) : null;
          // Round duct: a single diameter (stored in ductCalcWidth) replaces A/B.
          const isRound = c.shape === "Round";
          // Reducer-like: developed-blank material area (sq in). Elbow uses A/B/R
          // (third field = radius); Reducer / Square to Round use the table + H.
          const isReducer = isReducerType(c.type);
          const isElbow = c.type === "Elbow Duct";
          const isOffset = c.type === "Offset Duct"; // 4 inputs: L, A, B, O
          // Material Used (sq in) includes the GI +10% material allowance.
          const reducerSqIn = isReducer ? reducerLikeMaterialSqIn(c) * ductMaterialWasteFactor(c) : null;
          // Standard height for this size, shown in the calc unit (H above it doubles
          // material) — reducers only; an Elbow's radius R has no standard.
          const reducerStdHIn = isReducer && !isElbow && !isOffset ? reducerStandardHeightIn(c) : 0;
          const reducerStdHDisp = reducerStdHIn > 0 ? (reducerStdHIn * 25) / (ACC_MM_PER_UNIT[calcUnit] ?? 25) : null;
          const baseLaborRate = AIR_DUCT_LABOR_PER_SHEET[c.material] ?? null;
          // A Duct Reducer takes twice the labour per sheet.
          const laborRate = baseLaborRate != null ? (isReducer ? baseLaborRate * 2 : baseLaborRate) : null;
          // Labour uses the labour sheet count for the type (see ductLaborSheetCount).
          const laborSheets = straightDuctLaborSheets(ductLaborSheetCount(c));
          const angleCost = c.ductNoFlange ? 0 : STRAIGHT_DUCT_ANGLE_PRICE * STRAIGHT_DUCT_ANGLE_COUNT;
          const materialCost = sheetPrice != null ? sheetPrice * STRAIGHT_DUCT_MARKUP * sheets : null;
          const laborCost = laborRate != null ? laborSheets * laborRate : null;
          const sheetsRounded = Math.round(sheets * 1000) / 1000;
          // Duct Connector: canvas fabric length (m) + its cost/rate.
          const isConnector = c.type === "Duct Connector";
          const fabricMeters = ductConnectorFabricMeters(c);
          const fabricRate = c.fabricMaterial ? CANVASS_METER_NET[c.fabricMaterial] ?? null : null;
          const fabricCost = isConnector ? ductConnectorFabricCost(c) : null;
          // Painted Black Iron: +30% of the base (pre-paint) duct price.
          const painted = ductCalcPainted(c);
          const paintCost =
            painted && materialCost != null && laborCost != null
              ? (materialCost + angleCost + laborCost + (fabricCost ?? 0)) * DUCT_PAINT_SURCHARGE
              : null;
          const peso = (n: number) =>
            `₱${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          return (
            <div className="mt-3 flex items-center gap-4">
              {/* Left column: price panel + the price computation beneath it. */}
              <div className="shrink-0 space-y-2">
              {/* Straight Duct price panel (VAT exclusive) — widened so its right
                  edge reaches the "No Flange" label above. */}
              <div className="w-[30rem] rounded-md border bg-sky-50 text-sm">
                <div className="border-b bg-sky-200/60 px-3 py-1.5 text-center font-semibold">{c.type}</div>
                <div className="border-b px-3 py-1 text-center text-[11px] text-muted-foreground">
                  {c.type === "Duct Connector"
                    ? `Collar length: 12"`
                    : isReducer
                    ? c.ductNoFlange ? "No Flange" : "Flanged"
                    : `Standard length: ${straightDuctStdLengthM(c)} meter${c.ductNoFlange ? " (No Flange)" : " (Flanged)"}`}
                </div>
                <div className="flex items-center justify-between border-b px-3 py-1.5">
                  <span>Number of Sheets Used</span>
                  <span className="tabular-nums font-medium">{(Math.round(sheets * 1000) / 1000).toLocaleString()}</span>
                </div>
                {isConnector && (
                  <div className="flex items-center justify-between border-b px-3 py-1.5">
                    <span>Fabric Material Used</span>
                    <span className="tabular-nums font-medium">{(Math.round(fabricMeters * 1000) / 1000).toLocaleString()} m</span>
                  </div>
                )}
                {isReducer && reducerSqIn != null && (
                  <div className="flex items-center justify-between border-b px-3 py-1.5">
                    <span>Material Used</span>
                    <span className="tabular-nums font-medium">{Math.round(reducerSqIn).toLocaleString()} sq in</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-b px-3 py-1.5">
                  <span>Gauge</span>
                  <span className="tabular-nums font-medium">{ductGauge ? `${ductGauge} ga` : "—"}</span>
                </div>
                {isOffset ? (
                  // Offset: Width A + Height B (or a single Diameter Ø when Round),
                  // then Offset O and Length L.
                  <>
                    {isRound ? (
                      <div className="flex items-center gap-2 border-b px-3 py-1.5">
                        <span className="flex-1">Diameter &quot;Ø&quot;</span>
                        <Input
                          type="number" step="any" className="h-8 w-20 text-right"
                          disabled={!editable} value={c.ductCalcWidth ?? ""}
                          onChange={(e) => applyAccessory(l.id, { ductCalcWidth: e.target.value })}
                        />
                        <span className="text-xs text-muted-foreground">{calcUnit}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 border-b px-3 py-1.5">
                          <span className="flex-1">Width &quot;A&quot;</span>
                          <Input
                            type="number" step="any" className="h-8 w-20 text-right"
                            disabled={!editable} value={c.ductCalcWidth ?? ""}
                            onChange={(e) => applyAccessory(l.id, { ductCalcWidth: e.target.value })}
                          />
                          <span className="text-xs text-muted-foreground">{calcUnit}</span>
                        </div>
                        <div className="flex items-center gap-2 border-b px-3 py-1.5">
                          <span className="flex-1">Height &quot;B&quot;</span>
                          <Input
                            type="number" step="any" className="h-8 w-20 text-right"
                            disabled={!editable} value={c.ductCalcLength ?? ""}
                            onChange={(e) => applyAccessory(l.id, { ductCalcLength: e.target.value })}
                          />
                          <span className="text-xs text-muted-foreground">{calcUnit}</span>
                        </div>
                      </>
                    )}
                    <div className="flex items-center gap-2 border-b px-3 py-1.5">
                      <span className="flex-1">Offset &quot;O&quot;</span>
                      <Input
                        type="number" step="any" className="h-8 w-20 text-right"
                        disabled={!editable} value={c.ductCalcOffset ?? ""}
                        onChange={(e) => applyAccessory(l.id, { ductCalcOffset: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground">{calcUnit}</span>
                    </div>
                    <div className="flex items-center gap-2 border-b px-3 py-1.5">
                      <span className="flex-1">Length &quot;L&quot;</span>
                      <Input
                        type="number" step="any" className="h-8 w-20 text-right"
                        disabled={!editable} value={c.ductCalcHeight ?? ""}
                        onChange={(e) => applyAccessory(l.id, { ductCalcHeight: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground">{calcUnit}</span>
                    </div>
                  </>
                ) : isRound ? (
                  // Round: a single Diameter Ø replaces A and B (stored in ductCalcWidth).
                  <div className="flex items-center gap-2 border-b px-3 py-1.5">
                    <span className="flex-1">Diameter &quot;Ø&quot;</span>
                    <Input
                      type="number" step="any" className="h-8 w-20 text-right"
                      disabled={!editable} value={c.ductCalcWidth ?? ""}
                      onChange={(e) => applyAccessory(l.id, { ductCalcWidth: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">{calcUnit}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 border-b px-3 py-1.5">
                      <span className="flex-1">{isReducer ? "Length" : "Height"} &quot;B&quot;</span>
                      <Input
                        type="number" step="any" className="h-8 w-20 text-right"
                        disabled={!editable} value={c.ductCalcLength ?? ""}
                        onChange={(e) => applyAccessory(l.id, { ductCalcLength: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground">{calcUnit}</span>
                    </div>
                    <div className="flex items-center gap-2 border-b px-3 py-1.5">
                      <span className="flex-1">Width &quot;A&quot;</span>
                      <Input
                        type="number" step="any" className="h-8 w-20 text-right"
                        disabled={!editable} value={c.ductCalcWidth ?? ""}
                        onChange={(e) => applyAccessory(l.id, { ductCalcWidth: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground">{calcUnit}</span>
                    </div>
                  </>
                )}
                {isReducer && !isOffset && (
                  <div className="flex items-center gap-2 border-b px-3 py-1.5">
                    <span className="flex-1">
                      {isElbow ? <>Radius &quot;R&quot;</> : <>Height &quot;H&quot;</>}
                      {reducerStdHDisp != null && (
                        <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                          ({Math.round(reducerStdHDisp * 10) / 10} {calcUnit} maximum — above this doubles material)
                        </span>
                      )}
                    </span>
                    <Input
                      type="number" step="any" className="h-8 w-20 text-right"
                      placeholder={reducerStdHDisp != null ? String(Math.round(reducerStdHDisp * 10) / 10) : undefined}
                      disabled={!editable} value={c.ductCalcHeight ?? ""}
                      onChange={(e) => applyAccessory(l.id, { ductCalcHeight: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">{calcUnit}</span>
                  </div>
                )}
                <div className="flex items-center justify-between bg-sky-200/60 px-3 py-1.5 font-semibold">
                  <span>Duct Price <span className="text-[10px] font-normal text-rose-600">VAT EX</span></span>
                  <span className="tabular-nums">
                    {priceVatEx != null
                      ? `₱${(Math.round(priceVatEx * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : "—"}
                  </span>
                </div>
              </div>
              {/* Duct computation — the breakdown of the Duct Price (VAT-ex),
                  shown below the price panel. Only when all inputs are set. */}
              {priceVatEx != null && (
                <div className="w-[30rem] rounded-md border bg-white/70 px-3 py-2 text-xs">
                  <div className="mb-1 font-semibold">
                    Duct Computation <span className="text-[10px] font-normal text-rose-600">VAT EX</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Material — {peso(sheetPrice!)} × 1.3 × {sheetsRounded} sheet</span>
                    <span className="tabular-nums">{peso(materialCost!)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Angle corners — {c.ductNoFlange ? "none (No Flange)" : "₱15 × 8 pcs"}</span>
                    <span className="tabular-nums">{peso(angleCost)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Labor — {laborSheets} sheet × {peso(laborRate!)}</span>
                    <span className="tabular-nums">{peso(laborCost!)}</span>
                  </div>
                  {isConnector && fabricCost != null && fabricRate != null && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Fabric — {c.fabricMaterial}, {Math.round(fabricMeters * 1000) / 1000} m × {peso(fabricRate)}</span>
                      <span className="tabular-nums">{peso(fabricCost)}</span>
                    </div>
                  )}
                  {paintCost != null && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Paint — Black Iron painted (+30%)</span>
                      <span className="tabular-nums">{peso(paintCost)}</span>
                    </div>
                  )}
                  <div className="mt-1 flex justify-between gap-2 border-t pt-1 font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">{peso(priceVatEx)}</span>
                  </div>
                </div>
              )}
              </div>
              {/* Duct illustration for this calc type (client-supplied image with
                  its own A × B dimensions), right — enlarged and vertically centered.
                  Offset shows a red warning centered beneath the image. */}
              <div className={isReducer ? "ml-12 flex flex-col items-center" : "flex flex-col items-center"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={DUCT_CALC_IMAGE[c.type] ?? "/straight-duct.png"}
                  alt={`${c.type} dimensions`}
                  className={isReducer ? "h-auto max-h-[26rem] w-auto min-w-0 flex-shrink" : "h-auto w-[32.4rem] min-w-0 flex-shrink"}
                />
                {(isOffset || isElbow) && (
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-sm font-medium text-red-600">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    If &quot;A&quot; or &quot;B&quot; is unknown, put the bigger number in &quot;{isElbow ? "B" : "A"}&quot;.
                  </p>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SimilarQuotes matches={dupMatches} currentCompany={quotation.customer} />
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
                onChange={(e) => setPressureUnit(e.target.value)}>
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
          {/* Mark-up, Discount and VAT presentation, inline */}
          <div className="grid gap-4 md:col-span-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Mark-up <span className="font-normal text-muted-foreground">(internal only)</span></Label>
              <div className="flex gap-2">
                <Select
                  className="w-28 shrink-0"
                  value={pricing.markupMode}
                  disabled={!editable}
                  onChange={(e) => setPricingField("markupMode", e.target.value as AdjustMode)}
                >
                  <option value="percent">% percent</option>
                  <option value="amount">₱ amount</option>
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={pricing.markupValue}
                  disabled={!editable}
                  onChange={(e) => setPricingField("markupValue", Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Discount</Label>
              <div className="flex gap-2">
                <Select
                  className="w-28 shrink-0"
                  value={pricing.discountMode}
                  disabled={!editable}
                  onChange={(e) => setPricingField("discountMode", e.target.value as AdjustMode)}
                >
                  <option value="percent">% percent</option>
                  <option value="amount">₱ amount</option>
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={pricing.discountValue}
                  disabled={!editable}
                  onChange={(e) => setPricingField("discountValue", Number(e.target.value) || 0)}
                />
              </div>
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
                // Manual pick: hold this pattern until the product family changes.
                templateManual.current = true;
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
              ) : isMotorController(l.specs) || isIsolator(l.specs) || isAccessory(l.specs) || isCanvass(l.specs) || isWindVent(l.specs) || isAluDuct(l.specs) || isPortableBlowerFamily(l.specs) || isVav(l.specs) || isInductionMotor(l.specs) || isDustCollector(l.specs) || isJetFan(l.specs) || isPoultryFan(l.specs) || isHvls(l.specs) ? null : (
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
                    <Label className="text-[10px]">Static pressure{isFlowOnlyUnit(l.specs) ? " (N/A)" : isCustomJetFan(l.specs) ? " (locked 0.5\")" : ""}</Label>
                    <Input className="h-8 text-right" type="number" step="any"
                      disabled={!editable || isFlowOnlyUnit(l.specs) || isCustomJetFan(l.specs)}
                      value={isFlowOnlyUnit(l.specs) ? "" : (l.specs.staticPressure_pa ?? "")}
                      onChange={(e) => updateSpec(l.id, { staticPressure_pa: numOrNull(e.target.value) })} />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-[10px]">Unit</Label>
                    <Select className="h-8" value={units.pressure}
                      disabled={!editable || isFlowOnlyUnit(l.specs)}
                      onChange={(e) => setPressureUnit(e.target.value)}>
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

              {/* Low-pressure fan cap (admin-gated): Propeller 0.5", Tubeaxial 1.5",
                  Vaneaxial 4" w.g. Warn (in the chosen unit) when the entry exceeds it. */}
              {isSpBlocked(l.specs) && (() => {
                const cap = spCapInWg(l.specs) ?? 0.5;
                const pu = normalizePressureUnit(units.pressure) ?? "inwg";
                const maxInUnit = Math.round(convertPressure(cap, "inwg", pu) * 100) / 100;
                const label = pu === "inwg" ? `${cap} in-w.g.` : `${maxInUnit} ${units.pressure} (${cap} in-w.g.)`;
                const name = l.specs.category === "Propeller Type" ? "Propeller Type" : l.specs.type;
                return (
                  <p className="mt-1 text-xs text-destructive">
                    Maximum static pressure for {name} is {label}. Lower it to run the selection.
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

              {/* AlphaAir Ceiling Cassette — duty-based BPT selector (own inline catalogue). */}
              {editable && isAlphaAirCassette(l.specs) && (
                <div className="mt-2 rounded-md border border-dashed p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      AlphaAir cassette selector — uses Capacity + S.P. above
                    </span>
                    <Button size="sm" variant="outline" onClick={() => setAlphaRan((m) => ({ ...m, [l.id]: true }))}>
                      <Gauge className="h-3.5 w-3.5" /> Run selection
                    </Button>
                  </div>
                  {alphaRan[l.id] && (() => {
                    const aUnit = normalizeAirflowUnit(units.capacity);
                    const pUnit = normalizePressureUnit(units.pressure);
                    const flow = l.specs.capacity_cfm;
                    if (!flow || !aUnit) return <p className="mt-1 text-xs text-muted-foreground">Enter a volume flow above.</p>;
                    const qM3hr = convertAirflow(flow, aUnit, "m3hr");
                    const pPa = l.specs.staticPressure_pa && pUnit ? convertPressure(l.specs.staticPressure_pa, pUnit, "pa") : 0;
                    const picks = alphaAirCassettePicks(qM3hr, pPa);
                    if (picks.length === 0)
                      return <p className="mt-1 text-xs text-destructive">No BPT cassette meets this duty (flow / static pressure too high).</p>;
                    return (
                      <div className="mt-2 space-y-1">
                        {picks.map(({ c, sp }, i) => {
                          const isRec = i === 0;
                          const isSel = (l.specs.blowerModel ?? "").startsWith(c.model);
                          return (
                            <button key={c.model} type="button" onClick={() => applyAlphaCassette(l.id, c)}
                              className={`w-full rounded-md border p-2 text-left text-xs hover:bg-accent ${isSel ? "border-primary ring-1 ring-primary" : isRec ? "border-primary/50" : ""}`}>
                              <div className="flex items-center justify-between">
                                <span className="font-medium">
                                  {c.model} ({c.duct})
                                  {isRec && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">RECOMMENDED</span>}
                                  {isSel && <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">SELECTED</span>}
                                </span>
                                <span className="font-medium">{formatCurrency(round2(c.price), quotation.currency)}</span>
                              </div>
                              <p className="text-muted-foreground">
                                Max {c.airM3hr} m³/h ({c.cfm} CFM) · {Math.round(sp)} Pa at duty · {c.powerW} W · {c.rpm} rpm
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Per-line fan selector — click a candidate to populate this item.
                  Air curtains and Motor Controllers aren't duty-selected. */}
              {editable && !isAirCurtain(l.specs) && !isMotorController(l.specs) && !isIsolator(l.specs) && !isAccessory(l.specs) && !isCanvass(l.specs) && !isWindVent(l.specs) && !isAluDuct(l.specs) && !isPortableBlowerFamily(l.specs) && !isVav(l.specs) && !isInductionMotor(l.specs) && !isDustCollector(l.specs) && !isJetFan(l.specs) && !isPoultryFan(l.specs) && !isHvls(l.specs) && !isAlphaAirCassette(l.specs) && (
                <div className="mt-2 rounded-md border border-dashed p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Fan selector — uses {isFlowOnlyUnit(l.specs) ? "Capacity (volume flow only)" : "Capacity + S.P."} above
                    </span>
                    <Button size="sm" variant="outline" onClick={() => runLineSelection(l)}
                      disabled={sel[l.id]?.loading || isSpBlocked(l.specs)}>
                      <Gauge className="h-3.5 w-3.5" /> {sel[l.id]?.loading ? "Selecting…" : "Run selection"}
                    </Button>
                  </div>
                  {/* Radial Blower blade-type application guide (sales reference). */}
                  {l.specs.type === "Radial Blower" && (
                    <div className="mt-1.5 rounded bg-muted/50 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
                      <div>Paddle Wheel — General Material</div>
                      <div>Ring Paddle Wheel — Clean, Contaminant Air</div>
                      <div>Backplate Paddle Wheel — Shredded Materials</div>
                    </div>
                  )}
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
                          const estBody = bodyNetFrom(baseBodyOf(cat?.basePrice ?? 0, l.specs), l.specs);
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
                                  {sellableModelCode(r.modelCode)}
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
              ) : isAccessory(l.specs) || isCanvass(l.specs) || isWindVent(l.specs) || isAluDuct(l.specs) || isPortableBlowerFamily(l.specs) || isVav(l.specs) || isInductionMotor(l.specs) || isDustCollector(l.specs) || isJetFan(l.specs) || isPoultryFan(l.specs) || isHvls(l.specs) ? (
                // Air Terminals / Dampers: per-square-inch body price + manual override.
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="flex flex-col justify-end gap-1 md:col-span-3">
                    {isJetFan(l.specs) && l.specs.blowerModel && JET_FAN[l.specs.blowerModel]?.cmh > 0 && (
                      <p className="text-xs font-medium text-foreground">
                        Volume flow {JET_FAN[l.specs.blowerModel].cmh} CMH
                        {JET_FAN[l.specs.blowerModel].pa > 0 ? ` · Static pressure ${JET_FAN[l.specs.blowerModel].pa} Pa` : ""}
                        {" · "}{JET_FAN[l.specs.blowerModel].watt} W
                      </p>
                    )}
                    {isPoultryFan(l.specs) && l.specs.blowerModel && POULTRY_FAN[l.specs.blowerModel] && (() => {
                      const p = POULTRY_FAN[l.specs.blowerModel];
                      return (
                        <p className="text-xs font-medium text-foreground">
                          Airflow {p.cmh.toLocaleString()} m³/h · Total pressure {p.pa} Pa · {p.watt} W · Ø {p.bladeMm} mm · H×W×T {p.h}×{p.w}×{p.t} mm · 220 V, single phase
                        </p>
                      );
                    })()}
                    {isHvls(l.specs) && l.specs.blowerModel && HVLS_FAN[l.specs.blowerModel] && (() => {
                      const h = HVLS_FAN[l.specs.blowerModel];
                      return (
                        <p className="text-xs font-medium text-foreground">
                          Ø {h.dia.toLocaleString()} mm ({h.ft} ft) · {h.blades} blades · Air volume {h.airMin.toLocaleString()} m³/min · {h.kw} kW · {h.rpm} rpm · {h.weight} kg · 220 V single phase, 50/60 Hz · ≤38 dB · PMSM motor
                        </p>
                      );
                    })()}
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
                        if (isDuctCalc(l.specs)) {
                          const ex = straightDuctPriceVatEx(
                            l.specs.mcRecommend ? { ...l.specs, gauge: straightDuctGauge(l.specs) ?? "" } : l.specs,
                          );
                          if (ex == null) {
                            const needsR = l.specs.type === "Elbow Duct";
                            return l.specs.shape === "Round"
                              ? `Enter the diameter${needsR ? " and radius" : ""} and pick a gauge to auto-price.`
                              : `Enter the ${needsR ? "A, B and R" : "A × B"} and pick a gauge to auto-price.`;
                          }
                          return `Duct Price ₱${(Math.round(ex * 100) / 100).toLocaleString()} (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
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
                          const exp = l.specs.exproof === true;
                          const net = motorNetPrice(m, exp);
                          return `₱${net.toLocaleString()} / unit${exp ? " (Xproof)" : ""} (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isJetFan(l.specs)) {
                          const net = jetFanNet(l.specs);
                          if (net == null) return "Pick a model to auto-price.";
                          return `₱${net.toLocaleString()} / pc (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isPoultryFan(l.specs)) {
                          const net = poultryFanNet(l.specs);
                          if (net == null) return "Pick a model to auto-price.";
                          return `₱${net.toLocaleString()} / unit (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isHvls(l.specs)) {
                          const net = hvlsNet(l.specs);
                          if (net == null) return "Pick a model to auto-price.";
                          return `₱${net.toLocaleString()} / unit (VAT ex) × 1.12 = auto-priced (editable).`;
                        }
                        if (isDustCollector(l.specs)) {
                          const net = dustCollectorNet(l.specs);
                          if (net == null) return "Pick a model to auto-price.";
                          return `₱${net.toLocaleString()} / unit (VAT ex) × 1.12 = auto-priced (editable).`;
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
                        if (l.specs.type === "Weather hood") {
                          const size = weatherhoodSize(l.specs);
                          const wh = weatherhoodUnitPrice(l.specs);
                          if (wh == null || size == null) return "Enter L × W to auto-price.";
                          const matF = ACC_MATERIAL_FACTOR[l.specs.material] ?? 1;
                          const matNote = matF !== 1 ? ` · ${accMaterialLabel(l.specs.material)} ×${matF}` : "";
                          const finish = l.specs.powderCoated
                            ? `${matNote} + powder coat ×${WEATHERHOOD_POWDER_FACTOR} (GI base)`
                            : matNote;
                          if (size > WEATHERHOOD_MAX)
                            return `√(area) → ${size}" (over 36") · area × ₱${WEATHERHOOD_OVER_RATE} × 1.12${finish} = ₱${wh.toLocaleString()} (VAT incl.) auto-priced (editable).`;
                          return `√(area) → ${size}" size${finish} · ₱${wh.toLocaleString()} (VAT incl.) = auto-priced (editable).`;
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
                    {poleOptions(l.specs).map((p) => (<option key={p} value={p}>{p}-pole</option>))}
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
              {!isPrebuiltUnit(l.specs) && !isMotorController(l.specs) && !isIsolator(l.specs) && !isAccessory(l.specs) && !isCanvass(l.specs) && !isWindVent(l.specs) && !isAluDuct(l.specs) && !isPortableBlowerFamily(l.specs) && !isVav(l.specs) && !isInductionMotor(l.specs) && !isDustCollector(l.specs) && !isJetFan(l.specs) && !isPoultryFan(l.specs) && !isHvls(l.specs) && (() => {
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
                    {isBlower && <span>Body: {bodyComputation(l.specs)}</span>}
                    {isBlower &&
                      (hp && ph ? (
                        motor ? (
                          <>
                            <span>Motor {mModel ?? "—"}{exp ? " (EX)" : ""}: {formatCurrency(motorNetPrice(motor, exp), quotation.currency)}</span>
                            {exp && !hasExproofPrice(hp) && <span className="text-amber-600">EX price N/A for {hp} HP — using standard</span>}
                            {db && <span className="text-amber-600">+10% dynamic balancing (3-ph &gt; 10 HP)</span>}
                            {l.specs.blowerModel && <span>Model: <b>{combinedModel(displayBlowerModel(l.specs), mModel)}</b></span>}
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
              {pricing.markupValue > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>ADD {pricing.markupMode === "percent" ? `${pricing.markupValue}% MARK-UP` : "MARK-UP"} <span className="italic">(internal)</span></span>
                  <span>{formatCurrency(totals.markupAmt, quotation.currency)}</span>
                </div>
              )}
              {pricing.discountValue > 0 && (
                <div className="flex justify-between">
                  <span>LESS {pricing.discountMode === "percent" ? `${pricing.discountValue}% DISCOUNT` : "DISCOUNT"}</span>
                  <span>−{formatCurrency(totals.discountAmt, quotation.currency)}</span>
                </div>
              )}
              {(pricing.markupValue > 0 || pricing.discountValue > 0) && (
                <div className="flex justify-between font-medium"><span>NET AMOUNT</span><span>{formatCurrency(totals.finalNet, quotation.currency)}</span></div>
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
                  rev. {r.rev} · {new Date(r.savedAt).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })} · {formatCurrency(round2(r.total), quotation.currency)}
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
