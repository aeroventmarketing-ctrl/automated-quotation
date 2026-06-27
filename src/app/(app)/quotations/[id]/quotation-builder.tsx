"use client";

import { useMemo, useState } from "react";
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
import { PRODUCT_CATEGORIES, typesFor, entryFor } from "@/lib/product-taxonomy";
import { ConfidenceBadge } from "@/components/status-badge";
import type { SelectionResult } from "@/lib/selection";
import {
  normalizeAirflowUnit,
  normalizePressureUnit,
  convertAirflow,
  convertPressure,
} from "@/lib/units";
import { updateQuotationLines, transitionQuotation } from "../actions";
import { updateQuoteNumber } from "../../admin/actions";

interface CatalogEntry {
  modelCode: string;
  description: string;
  basePrice: number;
  bladeDia: number | null;
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
  blowerModel: string | null; // base catalogue model code, e.g. AV1225CEB
  // Per-item product selection (classification).
  category: string;
  type: string;
  bladeType: string;
  drive: string;
  material: string;
  shape: string;
  sizeL: string;
  sizeW: string;
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
// Pre-built units selected by model (no blade type / drive / material config).
const NO_BLADE_DRIVE_TYPES = new Set(["Ceiling Cassette"]);
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

/** Shape / variant options for a Ventilation Accessory type. */
function shapesFor(type: string): string[] {
  if (type === "Bar Grille") return ["Rectangle"];
  if (type === "Jet Nozzle Diffuser" || type === "Vent Cap" || type === "Wind Driven Roof Ventilator") return ["Round"];
  if (type === "Spring Vibration Isolator") return ["Foot Mounted", "Ceiling Mounted"];
  return ["Round", "Square"];
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

  const vatRate = config.vatRate;
  const totals = useMemo(() => {
    const gross = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0); // VAT-inclusive
    const net = gross / (1 + vatRate);
    const exclusive = vatMode !== "INCLUSIVE";
    const displayedNet = exclusive ? net : gross;
    const discountAmt = displayedNet * (discountPct / 100);
    const finalNet = displayedNet - discountAmt;
    const addVat = vatMode === "EXCLUSIVE_PLUS";
    const vatAmt = addVat ? finalNet * vatRate : 0;
    const grandTotal = finalNet + vatAmt;
    return { net, vat: gross - net, gross, exclusive, displayedNet, discountAmt, finalNet, addVat, vatAmt, grandTotal };
  }, [lines, vatRate, vatMode, discountPct]);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function updateSpec(id: string, patch: Partial<LineSpecs>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, specs: { ...l.specs, ...patch } } : l)));
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
          bodyPrice: null, blowerModel: null,
          category: "", type: "", bladeType: "", drive: "", material: "Black Iron Sheet", shape: "", sizeL: "", sizeW: "",
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
    const panel = PROPELLER_FAN_TYPES.has(line.specs.type);
    if (!flow || (!spVal && !panel)) {
      setSel((s) => ({ ...s, [line.id]: { loading: false, error: panel ? "Enter volume flow first." : "Enter volume flow and static pressure first.", results: null } }));
      return;
    }
    const aUnit = normalizeAirflowUnit(units.capacity);
    const pUnit = normalizePressureUnit(units.pressure);
    if (!aUnit || !pUnit) {
      setSel((s) => ({ ...s, [line.id]: { loading: false, error: `Unit "${aUnit ? units.pressure : units.capacity}" isn't supported for selection — use CFM/m³/hr and in-w.g./Pa.`, results: null } }));
      return;
    }
    const cfm = convertAirflow(flow, aUnit, "cfm");
    let sp = spVal ? convertPressure(spVal, pUnit, "inwg") : 0;
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
        { templateId, notes, terms, validUntil: validUntil || undefined, projectName, vatMode, discountPct, headerUnits: units },
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
    return (
      <div className="space-y-1">
        <Label>Product selection</Label>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Select
            value={c.category}
            disabled={!editable}
            onChange={(e) => set({ category: e.target.value, type: "", bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" })}
          >
            <option value="">Category…</option>
            {PRODUCT_CATEGORIES.map((x) => (<option key={x} value={x}>{x}</option>))}
          </Select>
          <Select
            value={c.type}
            disabled={!editable || !c.category}
            onChange={(e) => {
              const type = e.target.value;
              // Blower/fan categories route through applyMotor so the description
              // rebuilds field-by-field (and the model re-tags). Wall fans have a
              // single blade (Propeller), so pre-select it. Accessories keep set().
              if (PROPELLER_FAN_TYPES.has(type)) {
                applyMotor(l.id, { type, bladeType: "Propeller", shape: "", sizeL: "", sizeW: "" });
              } else if (MATERIAL_CATEGORIES.has(c.category)) {
                applyMotor(l.id, { type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" });
              } else {
                set({ type, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" });
              }
            }}
          >
            <option value="">Type…</option>
            {typesFor(c.category).map((t) => (<option key={t} value={t}>{t}</option>))}
          </Select>
          {c.category === "Ventilation Accessories" ? (
            <>
              <Select
                value={c.shape}
                disabled={!editable || !c.type}
                onChange={(e) => set({ shape: e.target.value })}
              >
                <option value="">{variantLabel(c.type)}…</option>
                {shapesFor(c.type).map((s) => (<option key={s} value={s}>{s}</option>))}
              </Select>
              {sizeMode(c.type, c.shape) === "capacity" ? (
                <Input className="h-9" type="number" step="any" placeholder="Capacity (kg)"
                  disabled={!editable || !c.type} value={c.sizeL}
                  onChange={(e) => set({ sizeL: e.target.value, sizeW: "" })} />
              ) : sizeMode(c.type, c.shape) === "diameter" ? (
                <Input className="h-9" type="number" step="any" placeholder="Diameter Ø (mm)"
                  disabled={!editable || !c.type} value={c.sizeL}
                  onChange={(e) => set({ sizeL: e.target.value, sizeW: "" })} />
              ) : (
                <>
                  <Input className="h-9" type="number" step="any" placeholder="L (mm)"
                    disabled={!editable || !c.type} value={c.sizeL}
                    onChange={(e) => set({ sizeL: e.target.value })} />
                  <Input className="h-9" type="number" step="any" placeholder="W (mm)"
                    disabled={!editable || !c.type} value={c.sizeW}
                    onChange={(e) => set({ sizeW: e.target.value })} />
                </>
              )}
            </>
          ) : NO_BLADE_DRIVE_TYPES.has(c.type) ? (
            // Pre-built units (e.g. Ceiling Cassette) have no blade type / drive
            // and aren't material-configurable — the model is picked by selection.
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
          {/* Material applies to blowers and accessories, not pre-built units. */}
          {!NO_BLADE_DRIVE_TYPES.has(c.type) && (
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
            : NO_BLADE_DRIVE_TYPES.has(c.type)
              ? "Category · Type — run the selection to pick a model by duty."
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

      {/* Workflow + exports */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-6">
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
          <div className="ml-auto flex gap-2">
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
        </CardContent>
      </Card>

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
              <Select value={vatMode} onChange={(e) => setVatMode(e.target.value as never)} disabled={!editable}>
                <option value="INCLUSIVE">VAT inclusive</option>
                <option value="EXCLUSIVE">VAT exclusive (÷1.12)</option>
                <option value="EXCLUSIVE_PLUS">VAT exclusive (+12%)</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Template (pattern)</Label>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!editable}>
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
                  <Input className="h-8 text-right" type="number" min={1} value={l.qty} disabled={!editable}
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

              {/* Table specs (Capacity / S.P. / Size columns in the quote). The flow
                  and pressure units mirror the quotation header; the value is stored
                  and shown in that unit, and converted to CFM / in-w.g. only to read
                  the catalog in the fan selector. */}
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
                  <Label className="text-[10px]">Static pressure</Label>
                  <Input className="h-8 text-right" type="number" step="any" disabled={!editable}
                    value={l.specs.staticPressure_pa ?? ""}
                    onChange={(e) => updateSpec(l.id, { staticPressure_pa: numOrNull(e.target.value) })} />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-[10px]">Unit</Label>
                  <Select className="h-8" value={units.pressure} disabled={!editable}
                    onChange={(e) => setUnits({ ...units, pressure: e.target.value })}>
                    {(units.pressure && !PRESSURE_UNITS.includes(units.pressure) ? [units.pressure, ...PRESSURE_UNITS] : PRESSURE_UNITS).map((u) => (
                      <option key={u} value={u}>{u}</option>))}
                  </Select>
                </div>
                <div className="md:col-span-1">
                  <Label className="text-[10px]">Size (in)</Label>
                  <Input className="h-8 text-right" type="number" step="any" disabled={!editable}
                    value={l.specs.inches ?? ""}
                    onChange={(e) => updateSpec(l.id, { inches: numOrNull(e.target.value) })} />
                </div>
              </div>

              {/* Per-line fan selector — click a candidate to populate this item */}
              {editable && (
                <div className="mt-2 rounded-md border border-dashed p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Fan selector — uses Capacity + S.P. above
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
                    const w = sel[l.id]?.results ? sizeWindow(sel[l.id]!.results!) : null;
                    if (!w) return null;
                    return (
                      <div className="mt-2 space-y-1">
                        {w.list.map((r) => {
                          const cat = catalog[r.modelId];
                          const motor = lookupMotor(r.motorHp, 3, r.motorPole ?? 4);
                          const estBody = (cat?.basePrice ?? 0) * bladeFactor(l.specs) * materialFactor(l.specs);
                          const est = estBody > 0 ? round2(computeUnitPrice(estBody, motor?.price ?? 0, r.motorHp, 3) * (1 + vatRate)) : 0;
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
                              <p className="text-muted-foreground">
                                {r.rpm} rpm · {r.bhp} BHP → {r.motorHp} HP{r.motorPole ? ` ${r.motorPole}-pole` : ""}
                                {r.bladeAngle != null ? ` · ${r.bladeAngle}° blade` : ""}
                                {` · delivers ${Math.round((r.selectedAirflow_m3hr ?? r.dutyAirflow_m3hr) / 1.6990108)} cfm`}
                                {r.outletVelocity_fpm != null
                                  ? ` · OV ${r.outletVelocity_fpm}${r.ovLimit_fpm != null ? `/${r.ovLimit_fpm}` : ""} fpm`
                                  : ""}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Motor + price calculator */}
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

              {/* Calculator readout */}
              {(() => {
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

      {editable && (
        <Button onClick={save} disabled={busy} size="lg">{busy ? "Saving…" : "Save changes"}</Button>
      )}
    </div>
  );
}
