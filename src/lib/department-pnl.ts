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
const isFan = (s: Specs) => {
  if (isMotorController(s) || isAccessory(s)) return false;
  const hay = (str(s.category) + " " + str(s.type)).toLowerCase();
  return /centrifugal|axial|propeller|tubular|cabinet|panel|roof|blower|fan/.test(hay);
};
// A VFD controller is bought-in (like KDK); a Motor Starter is fabricated.
const isVfd = (s: Specs) => /variable frequency|vfd/i.test(str(s.bladeType));

export type Routing = "fan" | "production_markup" | "office_full";

/** Which department a line belongs to, and how its net is split with Office. */
export function lineRouting(specs: Specs): { dept: DeptKey; routing: Routing } {
  if (isFan(specs)) return { dept: "fans", routing: "fan" };
  if (isAirDuct(specs)) return { dept: "duct", routing: "production_markup" };
  if (isAccessory(specs)) return { dept: "accessories", routing: "production_markup" };
  if (isMotorController(specs))
    return isVfd(specs) ? { dept: "office", routing: "office_full" } : { dept: "motor", routing: "production_markup" };
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

/**
 * Build a fan-body COGS resolver from the cost rows. A fan line matches by exact
 * (or contained) model code first — an override — otherwise by size + material.
 * Returns 0 when nothing matches, which leaves that fan line's net in Office.
 */
export function fanCogsLookup(rows: FanCogsRow[]): (specs: Specs) => number {
  const byModel = new Map<string, number>();
  const bySizeMat = new Map<string, number>();
  const norm = (v: unknown) => str(v).toLowerCase();
  for (const r of rows) {
    if (r.modelCode) byModel.set(norm(r.modelCode), r.cost);
    if (r.size || r.material) bySizeMat.set(`${norm(r.size)}|${norm(r.material)}`, r.cost);
  }
  return (specs: Specs): number => {
    const model = norm(specs.model);
    if (model) {
      if (byModel.has(model)) return byModel.get(model)!;
      for (const [code, cost] of byModel) if (code && model.includes(code)) return cost;
    }
    const key = `${norm(specs.inches ?? specs.size)}|${norm(specs.material)}`;
    return bySizeMat.get(key) ?? 0;
  };
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
