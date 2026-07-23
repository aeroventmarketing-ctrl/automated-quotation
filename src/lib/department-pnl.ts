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
const isMotorController = (s: Specs) => s.type === "Motor Controller";
const isIsolator = (s: Specs) => s.type === "Spring Vibration Isolator";
const isAccessory = (s: Specs) =>
  s.category === "Ventilation Accessories" && !isAirDuct(s) && !isIsolator(s);
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
  // Fabricated ventilation accessories & air ducts.
  if (isAirDuct(specs)) return { dept: "duct", routing: "production_markup" };
  if (isAccessory(specs)) return { dept: "accessories", routing: "production_markup" };
  // Bought-in / resale goods (KDK, AlphaAir, Aerovent "Other Products") — Office
  // keeps the margin: selling net less the supplier cost. Must precede the
  // fabricated-fan check so a branded "…Fan" isn't mistaken for a fabricated fan.
  if (isOtherProducts(specs)) return { dept: "office", routing: "office_full" };
  // Fabricated fans & blowers (Centrifugal / Axial / Propeller / …).
  if (isFan(specs)) return { dept: "fans", routing: "fan" };
  return { dept: "office", routing: "office_full" };
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
}

export interface OfficeCostHit {
  unitCost: number;
  vatInclusive: boolean;
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
      hit: { unitCost: e.unitCost, vatInclusive: e.vatInclusive },
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
