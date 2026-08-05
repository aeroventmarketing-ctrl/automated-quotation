/**
 * Departmental P&L — profit-centre accounting across AeroVent's four production
 * departments (Fans & Blowers, Duct, Accessories, Motor Controller) plus the
 * Office (sales & operations, not production).
 *
 * SALES routing (all figures net of VAT). Every confirmed-sale quotation line is
 * split between the department that made it and the Office, which carries the
 * operating margin:
 *   • Fan / blower      → Fans records its body COGS; Office keeps the rest
 *                         (body margin + the motor). Office = lineNet − COGS.
 *   • Air Duct          → Duct        records net ÷ 1.3; Office keeps the rest.
 *   • Accessories       → Accessories records net ÷ 1.3; Office keeps the rest.
 *   • Motor Controller  → fabricated Starter: Motor records net ÷ 1.3, Office rest;
 *                         VFD (bought-in): the whole net is an Office sale.
 *   • Everything else   → KDK / AlphaAir / induction motors / other bought-in
 *     ("Other Products")  goods: the whole net is an Office sale (cost is an
 *                         Office expense).
 *
 * The classification predicates mirror src/lib/job-order-autogen.ts so a line is
 * routed to the same department that would build its job order.
 */
import { round2 } from "@/lib/quote";
import { config } from "@/lib/config";
import { PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { isSaleConfirmed, type SaleRecord } from "@/lib/sale";
import { fanTagOf, fanBodyFactored } from "@/lib/fan-body-factors";
import { isDamperType } from "@/lib/duct-job-order";
import { quotationJobOrderDepts, type QuoteItemLike } from "@/lib/job-order-autogen";

export type DeptKey = "fans" | "duct" | "accessories" | "motor" | "office";

export interface Department {
  key: DeptKey;
  label: string;
  production: boolean;
  color: string;
}

export const DEPT_COLORS: Record<DeptKey, string> = {
  fans: "#2563eb",
  duct: "#0d9488",
  accessories: "#16a34a",
  motor: "#d97706",
  office: "#7c3aed",
};

/** The five profit centres, production departments first then Office. */
export const PNL_DEPARTMENTS: Department[] = [
  ...PRODUCTION_DEPTS.map((d) => ({
    key: d.key as DeptKey,
    label: d.label,
    production: true,
    color: DEPT_COLORS[d.key as DeptKey],
  })),
  { key: "office", label: "Office", production: false, color: DEPT_COLORS.office },
];

export const DEPT_LABEL: Record<DeptKey, string> = Object.fromEntries(
  PNL_DEPARTMENTS.map((d) => [d.key, d.label]),
) as Record<DeptKey, string>;

/** Production-department markup divisor: dept keeps net ÷ 1.3, Office the rest. */
export const PRODUCTION_MARKUP_DIVISOR = 1.3;

const VAT_RATE = config.vatRate || 0.12;

// --- Line classification (mirrors job-order-autogen.ts) -------------------
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

const AIR_DUCT_TYPES = new Set([
  "Straight Duct", "Duct Connector", "Duct Reducer", "Elbow Duct",
  "Offset Duct", "R-Duct", "Square to Round Duct", "Y-Duct",
]);
type Specs = Record<string, unknown>;
const isAirDuct = (s: Specs) => s.category === "Ventilation Accessories" && AIR_DUCT_TYPES.has(str(s.type));
// Dampers are produced by the Duct department (not Accessories), so they route
// to Duct for the departmental margin split too — mirrors job-order-autogen.ts.
const isDamper = (s: Specs) => s.category === "Ventilation Accessories" && isDamperType(str(s.type));
// Vent Cap and Duct Angle corner are bought-in (purchased from a supplier), not
// fabricated — they follow the Office resale routing like other bought-in goods.
// Mirrors job-order-autogen.ts.
const isDuctAngleCorner = (s: Specs) => s.category === "Ventilation Accessories" && /^duct angle corner$/i.test(str(s.type));
const isVentCap = (s: Specs) => s.category === "Ventilation Accessories" && /^vent cap$/i.test(str(s.type));
const isBoughtInVentAccessory = (s: Specs) => isVentCap(s) || isDuctAngleCorner(s);
const isMotorController = (s: Specs) => s.type === "Motor Controller";
const isIsolator = (s: Specs) => s.type === "Spring Vibration Isolator";
const isAccessory = (s: Specs) =>
  s.category === "Ventilation Accessories" && !isAirDuct(s) && !isDamper(s) && !isBoughtInVentAccessory(s) && !isIsolator(s);
// Bought-in / resale goods sit under the "Other Products" category (KDK,
// AlphaAir, MAXAIR, induction motors, dust collectors, VAV, inline/jet fans …).
const isOtherProducts = (s: Specs) => str(s.category) === "Other Products";
const isFan = (s: Specs) => {
  if (isMotorController(s) || isAccessory(s) || isOtherProducts(s)) return false;
  const hay = (str(s.category) + " " + str(s.type)).toLowerCase();
  return /centrifugal|axial|propeller|tubular|cabinet|panel|roof|blower|fan/.test(hay);
};
// A VFD controller is bought-in (like KDK); a Motor Starter is fabricated. The
// distinction rides in bladeType or the series field, depending on the quote.
const isVfd = (s: Specs) => /variable frequency|vfd/i.test(`${str(s.bladeType)} ${str(s.series)} ${str(s.drive)}`);

/** A readable label for a line — brand + type + model (e.g. "KDK Cabinet Fan · 25NFB"). */
export function productLabel(specs: Specs, description = ""): string {
  const model = str(specs.model) || str(specs.blowerModel);
  const head = [str(specs.brand), str(specs.type)].filter(Boolean).join(" ");
  const label = [head, model].filter(Boolean).join(" · ");
  return label || description.slice(0, 60);
}

export type Routing = "fan" | "production_markup" | "office_full";

/** Which department a line belongs to, and how its net is split with Office. */
export function lineRouting(specs: Specs): { dept: DeptKey; routing: Routing } {
  // Motor Controller: fabricated Starter → Motor dept; VFD (bought-in) → Office.
  if (isMotorController(specs))
    return isVfd(specs) ? { dept: "office", routing: "office_full" } : { dept: "motor", routing: "production_markup" };
  // Vent Cap and Duct Angle corner are bought-in — Office keeps the margin (net
  // less supplier cost), like other resale goods. Must precede the accessory /
  // fan checks so neither claims them for a fabricating department.
  if (isBoughtInVentAccessory(specs)) return { dept: "office", routing: "office_full" };
  // Fabricated ventilation accessories & air ducts. Dampers are duct-department
  // products, so they take the Duct markup too.
  if (isAirDuct(specs) || isDamper(specs)) return { dept: "duct", routing: "production_markup" };
  if (isAccessory(specs)) return { dept: "accessories", routing: "production_markup" };
  // Bought-in / resale goods (KDK, AlphaAir, Aerovent "Other Products") — Office
  // keeps the margin: selling net less the supplier cost. Must precede the
  // fabricated-fan check so a branded "…Fan" isn't mistaken for a fabricated fan.
  if (isOtherProducts(specs)) return { dept: "office", routing: "office_full" };
  // Fabricated fans & blowers (Centrifugal / Axial / Propeller / …).
  if (isFan(specs)) return { dept: "fans", routing: "fan" };
  return { dept: "office", routing: "office_full" };
}

/**
 * A typed service / charge line (Mobilization / Demobilization, Delivery,
 * Installation, …) — no product was selected from the catalogue, so its
 * `category` is blank. These are revenue with NO cost of goods: their spend is
 * booked later via Requisitions / Cash Vouchers, so they must never be
 * fuzzy-matched to a catalogue product's cost.
 */
export function isServiceLine(specs: Specs): boolean {
  return str(specs.category).trim() === "";
}

/**
 * The BOUGHT-IN products on an order's lines — what a supplier requisition / PO
 * would cover. Excludes Aerovent-fabricated items (fans / ducts / accessories /
 * motor starters) and typed service / charge lines (Mobilization, Delivery,
 * Installation), keeping only the resale goods (KDK, WDRV, VFD, …).
 */
export function orderBoughtInLines(
  items: { qty: number; descriptionSnapshot: string; specsSnapshot: unknown }[],
): { name: string; qty: number; unitPrice: number | null }[] {
  const lines = items
    .filter((it) => {
      const specs = (it.specsSnapshot && typeof it.specsSnapshot === "object" ? it.specsSnapshot : {}) as Specs;
      // A real bought-in product is a catalogue selection — it always carries a
      // product `type` (Wind Driven Roof Ventilator, KDK Cabinet Fan, …). A typed
      // service / charge (Mobilization, Delivery, Installation) has only a brand /
      // free-text description and NO type, even when filed under "Other Products",
      // so it slips past the blank-category service check — exclude those too.
      return lineRouting(specs).routing === "office_full" && !isServiceLine(specs) && str(specs.type) !== "";
    })
    .map((it) => {
      const specs = (it.specsSnapshot ?? {}) as Specs;
      // Supplier-facing name: drop Aerovent's own brand (the supplier ships it as
      // "Wind Driven Roof Ventilator", not "Aerovent Wind Driven Roof Ventilator").
      const raw = productLabel(specs, it.descriptionSnapshot) || it.descriptionSnapshot || "Item";
      let name = raw.replace(/^aerovent\s+/i, "").trim() || raw;
      // Size × material priced products (WDRV): append the throat size + material
      // so otherwise-identical lines are distinguishable on the PO.
      if (str(specs.type) === "Wind Driven Roof Ventilator") {
        const size = sizeKey(specs.sizeL ?? specs.size ?? specs.inches);
        const mat = str(specs.material).toLowerCase();
        const matLabel = /galvan/.test(mat) ? (specs.windVentPaint === true ? "G.I. with paint" : "G.I.")
          : /alumin/.test(mat) ? "Aluminum"
          : /stainless/.test(mat) ? "Stainless"
          : str(specs.material);
        const detail = [size ? `${size}"` : "", matLabel].filter(Boolean).join(" ");
        if (detail) name = `${name} — ${detail}`;
      }
      // Supplier unit price from the product's price grid (WDRV: size × material).
      const grid = windVentSupplierCost(specs);
      return { name, qty: Number(it.qty) || 1, unitPrice: grid ? grid.unitCost : null };
    });

  // Combine identical products — same name means same product, size & material —
  // into one line, summing the quantity, so the requisition / PO shows a single
  // row per product (e.g. 4 + 8 + 5 → one line of 17) instead of a row per
  // quotation line.
  const combined = new Map<string, { name: string; qty: number; unitPrice: number | null }>();
  for (const l of lines) {
    const key = `${l.name}||${l.unitPrice ?? ""}`;
    const existing = combined.get(key);
    if (existing) existing.qty += l.qty;
    else combined.set(key, { ...l });
  }
  return [...combined.values()];
}

/**
 * A fully bought-in order: it has bought-in products AND no department fabricates
 * anything (no fans / ducts / accessories / motor job orders). These skip
 * production and follow the PO flow (clear payment & create PO → Purchaser makes
 * PO → Engineer verifies → notify client) instead of the job-order flow.
 */
export function isBoughtInOnlyOrder(
  items: { qty: number; descriptionSnapshot: string; specsSnapshot: unknown }[],
): boolean {
  if (orderBoughtInLines(items).length === 0) return false;
  const depts = quotationJobOrderDepts(items as QuoteItemLike[]);
  return !Object.values(depts).some(Boolean);
}

// --- Amounts --------------------------------------------------------------
export type DeptSplit = Record<DeptKey, number>;
export const zeroSplit = (): DeptSplit => ({ fans: 0, duct: 0, accessories: 0, motor: 0, office: 0 });

/**
 * Net (VAT-exclusive) value of one quotation line after the quote's discount.
 * unitPrice is stored VAT-inclusive, so strip the VAT then apply the discount.
 */
export function lineNetOf(unitPrice: number, qty: number, discountPct: number): number {
  const gross = (Number(unitPrice) || 0) * (Number(qty) || 0);
  const net = gross / (1 + VAT_RATE);
  return round2(net * (1 - (Number(discountPct) || 0) / 100));
}

/**
 * Split one line's net between its department and the Office. `cogs` is the fan
 * body cost of goods sold (from the cost table) — 0 until one is recorded, in
 * which case the whole fan line lands in Office until the COGS is filled in.
 */
export function lineSalesSplit(specs: Specs, lineNet: number, cogs = 0): DeptSplit {
  const split = zeroSplit();
  const { dept, routing } = lineRouting(specs);
  if (routing === "office_full") {
    split.office = lineNet;
    return split;
  }
  if (routing === "fan") {
    const c = round2(Math.min(Math.max(cogs, 0), lineNet));
    split.fans = c;
    split.office = round2(lineNet - c);
    return split;
  }
  const deptNet = round2(lineNet / PRODUCTION_MARKUP_DIVISOR);
  split[dept] = deptNet;
  split.office = round2(lineNet - deptNet);
  return split;
}

// --- Fan-body COGS lookup -------------------------------------------------
export interface FanCogsRow {
  modelCode: string | null;
  size: string | null; // blade diameter (inches) as a string
  material: string | null;
  cost: number;
}

/** Canonical numeric key for a size ("12.0" and "12" both → "12"). */
const sizeKey = (v: unknown): string => {
  const n = Number(str(v));
  return Number.isFinite(n) && str(v) !== "" ? String(n) : "";
};

/**
 * Build a fan-body COGS resolver from the cost rows. Three kinds of row, in
 * priority order:
 *  1. fan code + size (both set) — a base cost from the fabricated-fan matrix.
 *     The same body factors (material, customized, double-wall, …) that scale
 *     the price scale this base too, via fanBodyFactored.
 *  2. model code only — a fixed override matched when the line's model contains
 *     it (used as-is, no factors).
 *  3. size + material — a fixed fallback (used as-is, no factors).
 * Returns 0 when nothing matches, which leaves that fan line's net in Office.
 */
export function fanCogsLookup(rows: FanCogsRow[]): (specs: Specs) => number {
  const norm = (v: unknown) => str(v).toLowerCase();
  const codeSize = new Map<string, number>(); // `${code}|${size}` -> base cost
  const overrides: { code: string; cost: number }[] = [];
  const bySizeMat = new Map<string, number>();
  for (const r of rows) {
    const code = norm(r.modelCode);
    const sk = sizeKey(r.size);
    if (code && sk) codeSize.set(`${code}|${sk}`, r.cost);
    else if (code) overrides.push({ code, cost: r.cost });
    else if (r.size || r.material) bySizeMat.set(`${sk}|${norm(r.material)}`, r.cost);
  }
  overrides.sort((a, b) => b.code.length - a.code.length); // longest (most specific) first
  return (specs: Specs): number => {
    // 1. fabricated-fan matrix — base cost by code + size, then apply factors.
    const tag = norm(fanTagOf(specs));
    const sk = sizeKey(specs.inches ?? specs.size);
    if (tag && sk) {
      const base = codeSize.get(`${tag}|${sk}`);
      if (base != null) return round2(fanBodyFactored(base, specs));
    }
    // 2. fixed model-code override.
    const model = norm(specs.model);
    if (model) for (const o of overrides) if (o.code && model.includes(o.code)) return o.cost;
    // 3. fixed size + material fallback.
    return bySizeMat.get(`${sk}|${norm(specs.material)}`) ?? 0;
  };
}

// --- Office cost lookup (bought-in goods) ---------------------------------
export interface OfficeCostEntry {
  name: string;
  sku: string | null;
  unitCost: number; // net (VAT-exclusive) supplier cost per unit
  vatInclusive: boolean; // whether the chosen supplier prices VAT-inclusive (creditable input VAT)
  company?: string | null; // the supplier the cost came from (for the input-VAT-by-supplier breakdown)
}

export interface OfficeCostHit {
  unitCost: number;
  vatInclusive: boolean;
  company?: string | null; // supplier company (for input-VAT attribution)
}

const normText = (s: unknown) => str(s).toLowerCase().replace(/\s+/g, " ");
// Generic words that don't help identify a product.
const COST_STOP = new Set(["fan", "fans", "the", "and", "brand", "model", "type", "with", "for", "pc", "pcs", "unit", "units", "set", "sets"]);
const tokenize = (text: unknown): string[] =>
  normText(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !COST_STOP.has(t));
const hasDigit = (t: string) => /\d/.test(t);

interface PreparedCost {
  tokens: string[]; // significant name tokens
  codes: string[]; // model-code tokens (contain a digit)
  sku: string | null; // compacted sku
  hit: OfficeCostHit;
}

/**
 * Build a resolver that finds a bought-in line's net unit cost from the Products
 * table. Matching, strongest first:
 *   1. the product SKU appears in the line;
 *   2. a product model code (e.g. "25NSB") matches a token in the line — so a
 *      KDK/AlphaAir line is priced by its exact model, not just brand + type;
 *   3. every word of a model-less product name is present in the line (order-
 *      independent, so "AlphaAir Duct Canvass Connector" matches
 *      "Duct Canvass Connector - AlphaAir").
 * A product that carries a model code is matched ONLY by that code, so a
 * different model of the same brand is never priced by the wrong cost.
 * Returns null when nothing matches.
 */
export function officeCostLookup(entries: OfficeCostEntry[]): (haystack: string) => OfficeCostHit | null {
  const prepared: PreparedCost[] = entries.map((e) => {
    const tokens = tokenize(e.name);
    return {
      tokens,
      codes: tokens.filter(hasDigit),
      sku: e.sku ? normText(e.sku).replace(/[^a-z0-9]/g, "") : null,
      hit: { unitCost: e.unitCost, vatInclusive: e.vatInclusive, company: e.company ?? null },
    };
  });
  return (haystackRaw: string): OfficeCostHit | null => {
    const lineTokens = new Set(tokenize(haystackRaw));
    const lineCompact = normText(haystackRaw).replace(/[^a-z0-9]/g, "");
    let best: { score: number; hit: OfficeCostHit } | null = null;
    for (const p of prepared) {
      let score = 0;
      if (p.sku && p.sku.length >= 4 && lineCompact.includes(p.sku)) score = 1000 + p.tokens.length;
      else if (p.codes.length && p.codes.some((c) => lineTokens.has(c))) score = 500 + p.tokens.length;
      else if (!p.codes.length && p.tokens.length >= 2 && p.tokens.every((t) => lineTokens.has(t))) score = 100 + p.tokens.length;
      if (score > 0 && (!best || score > best.score)) best = { score, hit: p.hit };
    }
    return best?.hit ?? null;
  };
}

/** The text a bought-in line is matched against (description + key specs). */
export function officeLineHaystack(description: string, specs: Specs): string {
  return [description, specs.model, specs.brand, specs.type, specs.blowerModel]
    .map((v) => str(v))
    .filter(Boolean)
    .join(" ");
}

// --- Wind Driven Roof Ventilator supplier cost ----------------------------
// This bought-in roof ventilator is priced by throat diameter × material, so a
// single Products-tab price can't express its cost. Supplier price (net /
// VAT-exclusive) by material × throat diameter; "with paint" (Galvanized Iron
// only) uses the G.I.-with-paint column. Mirrors the quotation selling grid.
const WIND_VENT_SUPPLIER_COST: Record<string, Record<string, number>> = {
  gi: { "12": 3500, "15": 5000, "24": 8000, "27": 8500, "32": 10000, "36": 15000 },
  giPaint: { "12": 4500, "15": 6000, "24": 9000, "27": 9500, "32": 11000, "36": 16500 },
  aluminum: { "12": 5950, "15": 9500, "24": 12500, "27": 14450, "32": 18500, "36": 24500 },
  stainless: { "12": 8750, "15": 12000, "24": 20000, "27": 21250, "32": 28000, "36": 36000 },
};
/** Supplier COGS for a Wind Driven Roof Ventilator line, or null if not one. */
export function windVentSupplierCost(specs: Specs): OfficeCostHit | null {
  if (str(specs.type) !== "Wind Driven Roof Ventilator") return null;
  const size = sizeKey(specs.sizeL ?? specs.size ?? specs.inches);
  if (!size) return null;
  const material = str(specs.material).toLowerCase();
  let col: string | null = null;
  if (/galvan/.test(material)) col = specs.windVentPaint ? "giPaint" : "gi";
  else if (/alumin/.test(material)) col = "aluminum";
  else if (/stainless/.test(material)) col = "stainless";
  if (!col) return null;
  const unitCost = WIND_VENT_SUPPLIER_COST[col]?.[size];
  if (unitCost == null) return null;
  // Prices are VAT-exclusive (net) — no creditable input VAT assumed.
  return { unitCost, vatInclusive: false };
}

// --- Sale recognition -----------------------------------------------------
/**
 * The date a confirmed sale is recognised: a Terms (PO) client is booked on the
 * PO date; everyone else on the date they first paid. Returns null when the sale
 * is not yet confirmed (no PO, or no payment for a non-terms client).
 */
export function saleRecognitionDate(sale: SaleRecord | null | undefined): string | null {
  if (!sale || !isSaleConfirmed(sale)) return null;
  if (sale.arrangement === "terms") {
    return sale.po?.uploadedAt || sale.soldAt || null;
  }
  const paid = (sale.payments ?? []).map((p) => p.date).filter(Boolean).sort();
  return paid[0] || sale.soldAt || sale.po?.uploadedAt || null;
}

// --- Manila-time bucketing ------------------------------------------------
const MS_PH = 8 * 3600 * 1000; // AeroVent runs on fixed UTC+8 (no DST).

/** Manila calendar day (YYYY-MM-DD) of an ISO instant. */
export function manilaYMD(iso: string): string {
  const d = new Date(new Date(iso).getTime() + MS_PH);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Manila month (YYYY-MM) of an ISO instant. */
export function manilaMonthKey(iso: string): string {
  return manilaYMD(iso).slice(0, 7);
}

/** Whether a Manila day (YYYY-MM-DD) falls within [from, to] inclusive. */
export function ymdInRange(ymd: string, from: string, to: string): boolean {
  return ymd >= from && ymd <= to;
}
