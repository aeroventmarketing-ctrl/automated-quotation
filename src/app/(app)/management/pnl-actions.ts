"use server";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { round2, readPricing, applyPricing, pricingForVatMode, type PricingAdjust } from "@/lib/quote";
import { config } from "@/lib/config";
import { saleFromClassification } from "@/lib/sale";
import { coerceChainLog } from "@/lib/purchase-chain-row";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { getProducts } from "@/lib/product-catalog";
import { getOfficeResaleProductIds } from "@/lib/office-resale";
import { getSuppliers } from "@/lib/suppliers";
import { getTestMode, testModeCreatedAtFilter } from "@/lib/test-mode";
import { getAlertGoLive } from "@/lib/alert-golive";
import { payrollExpenseForRange } from "./payroll-actions";
import { isDuctHardwareStockName } from "@/lib/dept-stock-transfer";
import {
  PNL_DEPARTMENTS,
  DEPT_LABEL,
  zeroSplit,
  lineNetOf,
  lineSalesSplit,
  lineRouting,
  isServiceLine,
  saleRecognitionDate,
  fanCogsLookup,
  officeCostLookup,
  officeLineHaystack,
  windVentSupplierCost,
  productLabel,
  manilaYMD,
  ymdInRange,
  type DeptKey,
  type DeptSplit,
  type FanCogsRow,
  type OfficeCostEntry,
} from "@/lib/department-pnl";

const VAT_RATE = config.vatRate || 0.12;
const PROD_DEPT_KEYS = new Set<DeptKey>(["fans", "duct", "accessories", "motor"]);

/**
 * While the alerts go-live gate is on, the P&L never counts activity dated before
 * the launch day. Records are recognised by WHEN THEY HAPPENED — sales on their
 * payment / PO date, expenses on their release date — not when the row was
 * created, so a pre-launch order that's paid after go-live still counts. Returns
 * the go-live Manila day to floor the report's start (or null when the gate is off).
 */
async function goLiveFloorYMD(): Promise<string | null> {
  const g = await getAlertGoLive();
  return g.on ? manilaYMD(g.at) : null;
}

export interface PnlRow {
  key: DeptKey;
  label: string;
  production: boolean;
  color: string;
  sales: number;
  expenses: number;
  income: number;
}

export interface PnlReport {
  from: string;
  to: string;
  rows: PnlRow[];
  totals: { sales: number; expenses: number; income: number };
  salesCount: number;
  fanLinesPending: number; // fan lines booked entirely to Office (no COGS yet)
  officeCostUnmatched: number; // bought-in lines with no Products-tab cost matched
  officeUnmatchedItems: string[]; // distinct labels of those unmatched goods
  markupIncome: number; // "Income from Mark up" — quote mark-ups, booked to Office (net)
  clientDiscounts: number; // "Client Discounts" — quote discounts, an Office expense (net)
  vat: { output: number; input: number; payable: number }; // VAT for BIR (not in profit)
}

function addSplit(into: DeptSplit, from: DeptSplit) {
  for (const k of Object.keys(into) as DeptKey[]) into[k] = round2(into[k] + from[k]);
}

/**
 * A quote's mark-up and discount as VAT-exclusive (net) amounts. Departments book
 * their sales at the list price before either; the mark-up is Office income
 * ("Income from Mark up") and the discount an Office expense ("Client Discounts").
 * Mark-up/discount that were entered on a VAT-inclusive quote include VAT, so
 * strip it — the VAT part flows through Output VAT, not the profit lines.
 */
function markupDiscountNet(grossSum: number, vatMode: string, pricing: PricingAdjust): { markupNet: number; discountNet: number } {
  const displayedNet = vatMode === "INCLUSIVE" ? grossSum : grossSum / (1 + VAT_RATE);
  // A flat mark-up/discount is VAT-inclusive in EXCLUSIVE_PLUS too (matches INCLUSIVE).
  const { markupAmt, discountAmt } = applyPricing(displayedNet, pricingForVatMode(pricing, vatMode, VAT_RATE));
  const toNet = (x: number) => (vatMode === "INCLUSIVE" ? x / (1 + VAT_RATE) : x);
  return { markupNet: round2(toNet(markupAmt)), discountNet: round2(toNet(discountAmt)) };
}

/**
 * Build the fan-body COGS and Office-cost resolvers shared by the summary and
 * the detail views. Both degrade to "no match" (0) if their tables/data are
 * missing, so callers never throw.
 */
async function buildCostResolvers() {
  let cogsRows: FanCogsRow[] = [];
  try {
    const rows = await prisma.fanBodyCogs.findMany();
    cogsRows = rows.map((r) => ({ modelCode: r.modelCode, size: r.size, material: r.material, cost: Number(r.cost) || 0 }));
  } catch {
    cogsRows = [];
  }
  const cogsOf = fanCogsLookup(cogsRows);

  const [products, suppliers] = await Promise.all([getProducts().catch(() => []), getSuppliers().catch(() => [])]);
  const vatById = new Map(suppliers.map((s) => [s.id, s.ewt] as const));
  const vatByCompany = new Map(suppliers.map((s) => [s.company.trim().toLowerCase(), s.ewt] as const));
  // An EWT-capable supplier prices VAT-inclusive; default to VAT-inclusive when unknown.
  const supplierVatInclusive = (company: string): boolean => vatByCompany.get((company || "").trim().toLowerCase()) ?? true;
  const vatFor = (supplierId: string, company: string): boolean => vatById.get(supplierId) ?? supplierVatInclusive(company);

  // Each product's cheapest net cost, carrying whether that supplier prices
  // VAT-inclusive (so the caller can credit the input VAT).
  const costEntries: OfficeCostEntry[] = products
    .map((p) => {
      let best: OfficeCostEntry | null = null;
      for (const l of p.suppliers) {
        if (!(l.price && l.price > 0)) continue;
        const incl = vatFor(l.supplierId, l.company);
        const unitCost = round2(incl ? l.price / (1 + VAT_RATE) : l.price);
        if (!best || unitCost < best.unitCost) best = { name: p.name, sku: p.sku, unitCost, vatInclusive: incl, company: l.company };
      }
      return best;
    })
    .filter((e): e is OfficeCostEntry => e != null && e.unitCost > 0);
  const officeCostOf = officeCostLookup(costEntries);

  // Products flagged as Office/resale (finished goods bought and resold) — a sale
  // of one is booked entirely to Office, never a production department, whatever
  // its category. Matched to a line the same way costs are (name / model / SKU).
  const resaleIds = new Set(await getOfficeResaleProductIds());
  const resaleEntries: OfficeCostEntry[] = products
    .filter((p) => resaleIds.has(p.id))
    .map((p) => ({ name: p.name, sku: p.sku, unitCost: 1, vatInclusive: false }));
  const resaleLookup = officeCostLookup(resaleEntries);
  const isOfficeResale = (haystack: string): boolean => resaleLookup(haystack) != null;

  // Office cost for a bought-in line: a Wind Driven Roof Ventilator is priced
  // from its own throat-diameter × material supplier grid; everything else falls
  // back to the Products-tab name / model / SKU cost match.
  const officeCostOfLine = (specs: Record<string, unknown>, haystack: string) =>
    windVentSupplierCost(specs) ?? officeCostOf(haystack);

  return { cogsOf, officeCostOf, officeCostOfLine, supplierVatInclusive, isOfficeResale };
}

/** Stock unit-cost + name lookup for the items sold across a set of counter sales.
 *  The name lets the P&L recognise in-house duct hardware (angle corner / cleats /
 *  clips) so Fans is credited its production cost on those counter-sale lines. */
async function counterSaleCostMap(
  sales: { items: { stockItemId: string | null }[] }[],
): Promise<Map<string, { cost: number; name: string }>> {
  const ids = [...new Set(sales.flatMap((s) => s.items.map((i) => i.stockItemId).filter((x): x is string => !!x)))];
  const map = new Map<string, { cost: number; name: string }>();
  if (!ids.length) return map;
  try {
    const items = await prisma.stockItem.findMany({ where: { id: { in: ids } }, select: { id: true, unitCost: true, name: true } });
    for (const it of items) map.set(it.id, { cost: Number(it.unitCost) || 0, name: it.name });
  } catch {
    /* stock table issue — treat as no COGS */
  }
  return map;
}

/** Fans's share of a counter sale — the production cost of any in-house duct
 *  hardware lines (stock unit cost × qty). Office keeps the rest as margin. */
function counterSaleFansCogs(
  items: { qty: unknown; stockItemId: string | null }[],
  costMap: Map<string, { cost: number; name: string }>,
): number {
  return round2(items.reduce((a, i) => {
    const hit = i.stockItemId ? costMap.get(i.stockItemId) : null;
    return hit && isDuctHardwareStockName(hit.name) ? a + hit.cost * Number(i.qty) : a;
  }, 0));
}

/**
 * Build the departmental P&L for [from, to] (Manila YYYY-MM-DD, inclusive).
 * Sales come from confirmed quotations recognised in the window; expenses from
 * purchase requests and cash requests whose cash was released in the window.
 * Fan-body COGS and payroll are added in a later stage — until then every fan
 * line is booked to Office (flagged by `fanLinesPending`).
 */
export async function getDepartmentPnl(from: string, to: string): Promise<PnlReport> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("Invalid date range.");
  }
  const [lo0, hi] = from <= to ? [from, to] : [to, from];
  // Go-live gate on → floor the report at the launch day (by payment/release date).
  const goLiveFloor = await goLiveFloorYMD();
  const lo = goLiveFloor && goLiveFloor > lo0 ? goLiveFloor : lo0;

  const sales = zeroSplit();
  const expenses = zeroSplit();
  let salesCount = 0;
  let fanLinesPending = 0;
  let officeCostUnmatched = 0;
  const officeUnmatched = new Set<string>();
  let outputVat = 0;
  let inputVat = 0;
  let markupIncome = 0;
  let clientDiscounts = 0;

  const { cogsOf, officeCostOfLine, supplierVatInclusive, isOfficeResale } = await buildCostResolvers();
  const cutoff = testModeCreatedAtFilter(await getTestMode());

  // --- Sales ---------------------------------------------------------------
  const quotations = await prisma.quotation.findMany({
    where: cutoff ? { createdAt: cutoff } : undefined,
    select: {
      discountPct: true,
      vatMode: true,
      classification: true,
      items: { select: { unitPrice: true, qty: true, specsSnapshot: true, descriptionSnapshot: true } },
    },
  });
  for (const q of quotations) {
    const sale = saleFromClassification(q.classification);
    const recAt = saleRecognitionDate(sale);
    if (!recAt) continue;
    if (!ymdInRange(manilaYMD(recAt), lo, hi)) continue;
    salesCount += 1;
    // A VAT-exclusive quote charges the client no VAT — no output VAT on it.
    const chargesVat = q.vatMode !== "EXCLUSIVE";
    // Departments book the LIST price before the quote's mark-up / discount; the
    // mark-up becomes Office income and the discount an Office expense below.
    let grossSum = 0;
    for (const it of q.items) {
      const specs = (it.specsSnapshot && typeof it.specsSnapshot === "object"
        ? it.specsSnapshot
        : {}) as Record<string, unknown>;
      grossSum += (Number(it.unitPrice) || 0) * (Number(it.qty) || 0);
      const net = lineNetOf(Number(it.unitPrice), it.qty, 0);
      if (net === 0) continue;
      // Output VAT is charged on the full selling price regardless of the split.
      if (chargesVat) outputVat = round2(outputVat + round2(net * VAT_RATE));
      const haystack = officeLineHaystack(it.descriptionSnapshot, specs);
      let routing = lineRouting(specs).routing;
      // A flagged Office/resale product is booked entirely to Office.
      if (routing !== "office_full" && isOfficeResale(haystack)) routing = "office_full";
      if (routing === "office_full") {
        // Bought-in good: Office keeps the margin — selling net less the supplier
        // cost. The cost is netted here (not booked as a separate expense); its
        // input VAT is still creditable. A service / charge line (no product
        // selected) carries no COGS — never cost-match it.
        const service = isServiceLine(specs);
        const hit = service ? null : officeCostOfLine(specs, haystack);
        const cost = hit ? round2(hit.unitCost * it.qty) : 0;
        sales.office = round2(sales.office + round2(net - cost));
        // Resale-COGS input VAT is credited at the point of sale. While the go-live
        // gate is on, the resold goods are opening stock (bought pre-launch), so
        // their input VAT belongs to the pre-launch period — don't credit it here;
        // only genuine post-go-live material POs generate input VAT.
        if (hit?.vatInclusive && cost && !goLiveFloor) inputVat = round2(inputVat + round2(cost * VAT_RATE));
        if (!hit && !service) {
          officeCostUnmatched += 1;
          const label = productLabel(specs, it.descriptionSnapshot);
          if (label) officeUnmatched.add(label);
        }
      } else if (routing === "fan") {
        const cogs = cogsOf(specs);
        if (cogs <= 0) fanLinesPending += 1;
        addSplit(sales, lineSalesSplit(specs, net, cogs));
      } else {
        addSplit(sales, lineSalesSplit(specs, net, 0));
      }
    }
    // Quote-level mark-up → Office income; discount → Office expense (both net).
    const { markupNet, discountNet } = markupDiscountNet(grossSum, q.vatMode, readPricing(q.classification, Number(q.discountPct)));
    if (markupNet) {
      sales.office = round2(sales.office + markupNet);
      markupIncome = round2(markupIncome + markupNet);
      if (chargesVat) outputVat = round2(outputVat + round2(markupNet * VAT_RATE));
    }
    if (discountNet) {
      expenses.office = round2(expenses.office + discountNet);
      clientDiscounts = round2(clientDiscounts + discountNet);
      if (chargesVat) outputVat = round2(outputVat - round2(discountNet * VAT_RATE));
    }
  }

  // --- Sales: completed counter sales (walk-in) → Office -------------------
  // Booked to Office as margin (net selling less stock COGS), mirroring bought-in
  // resale. Recognised on the completion date. VAT-inclusive sales charge output
  // VAT; VAT-exclusive (non-VAT) sales don't.
  const counterSales = await prisma.counterSale.findMany({
    where: { status: "COMPLETED", ...(cutoff ? { createdAt: cutoff } : {}) },
    select: { completedAt: true, vatMode: true, subtotal: true, items: { select: { qty: true, stockItemId: true } } },
  });
  const csCostById = await counterSaleCostMap(counterSales);
  for (const cs of counterSales) {
    if (!cs.completedAt || !ymdInRange(manilaYMD(cs.completedAt.toISOString()), lo, hi)) continue;
    salesCount += 1;
    const net = Number(cs.subtotal) || 0; // INCLUSIVE backs VAT out; EXCLUSIVE = total
    if (cs.vatMode !== "EXCLUSIVE") outputVat = round2(outputVat + round2(net * VAT_RATE));
    const cogs = round2(cs.items.reduce((a, i) => a + (i.stockItemId ? (csCostById.get(i.stockItemId)?.cost ?? 0) * Number(i.qty) : 0), 0));
    // In-house duct hardware sold over the counter: Fans is credited its production
    // cost (stock unit cost); Office keeps the margin — same split as a quotation sale.
    const fansCogs = counterSaleFansCogs(cs.items, csCostById);
    if (fansCogs > 0) sales.fans = round2(sales.fans + fansCogs);
    sales.office = round2(sales.office + round2(net - cogs));
  }

  // --- Expenses: purchase requests (material POs) --------------------------
  // Booked to the requesting department, net of VAT, on the cash-released date.
  const prs = await prisma.purchaseRequest.findMany({
    where: { dept: { not: null }, status: { not: "CANCELLED" }, ...(cutoff ? { createdAt: cutoff } : {}) },
    select: { dept: true, po: true, chainLog: true },
  });
  for (const pr of prs) {
    const releasedAt = coerceChainLog(pr.chainLog).release_cash?.at;
    if (!releasedAt) continue;
    if (!ymdInRange(manilaYMD(releasedAt), lo, hi)) continue;
    const dept = pr.dept as DeptKey;
    if (!PROD_DEPT_KEYS.has(dept)) continue;
    const po = coercePurchaseOrder(pr.po);
    if (!po) continue;
    // VAT-inclusive supplier (EWT-capable) → strip VAT to net and credit input
    // VAT; a non-VAT supplier's price is already net.
    const incl = supplierVatInclusive(po.supplier.company);
    const gross = poTotals(po).total;
    const net = incl ? round2(gross / (1 + VAT_RATE)) : round2(gross);
    expenses[dept] = round2(expenses[dept] + net);
    if (incl) inputVat = round2(inputVat + round2(net * VAT_RATE));
  }

  // --- Expenses: cash requests (vouchers) ---------------------------------
  // Released cash, booked to its department (or Office when unassigned).
  const RELEASED = new Set(["CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED", "SETTLED"]);
  const crs = await prisma.cashRequest.findMany({
    where: { releasedAt: { not: null }, ...(cutoff ? { createdAt: cutoff } : {}) },
    select: { dept: true, amount: true, releasedAt: true, status: true },
  });
  for (const cr of crs) {
    if (!RELEASED.has(cr.status)) continue;
    if (!cr.releasedAt) continue;
    if (!ymdInRange(manilaYMD(cr.releasedAt.toISOString()), lo, hi)) continue;
    const dept: DeptKey = cr.dept && PROD_DEPT_KEYS.has(cr.dept as DeptKey) ? (cr.dept as DeptKey) : "office";
    expenses[dept] = round2(expenses[dept] + (Number(cr.amount) || 0));
  }

  // --- Expenses: manual departmental payroll (months overlapping the range) ---
  const payroll = await payrollExpenseForRange(lo.slice(0, 7), hi.slice(0, 7));
  for (const k of Object.keys(expenses) as DeptKey[]) expenses[k] = round2(expenses[k] + payroll[k]);

  // --- Inter-department stock transfers (in-house duct hardware, Fans → dept) --
  // When a department pulls Fans-produced duct hardware from stock via the MRF it
  // is booked at the stock item's production cost: a SALE for Fans & Blowers and a
  // PURCHASE (expense) for the requesting department. Internal move — no VAT, and
  // not counted as a customer sale.
  const transfers = await prisma.deptStockTransfer.findMany({
    where: cutoff ? { createdAt: cutoff } : undefined,
    select: { at: true, fromDept: true, toDept: true, value: true },
  });
  for (const t of transfers) {
    if (!ymdInRange(manilaYMD(t.at.toISOString()), lo, hi)) continue;
    const from = t.fromDept as DeptKey;
    const to = t.toDept as DeptKey;
    const val = Number(t.value) || 0;
    if (from in sales) sales[from] = round2(sales[from] + val);
    if (to in expenses) expenses[to] = round2(expenses[to] + val);
  }

  const rows: PnlRow[] = PNL_DEPARTMENTS.map((d) => ({
    key: d.key,
    label: d.label,
    production: d.production,
    color: d.color,
    sales: sales[d.key],
    expenses: expenses[d.key],
    income: round2(sales[d.key] - expenses[d.key]),
  }));
  const totals = rows.reduce(
    (a, r) => ({
      sales: round2(a.sales + r.sales),
      expenses: round2(a.expenses + r.expenses),
      income: round2(a.income + r.income),
    }),
    { sales: 0, expenses: 0, income: 0 },
  );

  const vat = { output: outputVat, input: inputVat, payable: round2(outputVat - inputVat) };

  return { from: lo, to: hi, rows, totals, salesCount, fanLinesPending, officeCostUnmatched, officeUnmatchedItems: [...officeUnmatched].sort(), markupIncome, clientDiscounts, vat };
}

// --- Drill-down detail (spot-check / audit) -------------------------------
export interface PnlSaleLine {
  label: string;
  qty: number;
  net: number; // discounted net sale for the line
  routing: "fan" | "production_markup" | "office_full";
  dept: DeptKey; // the production department (office for bought-in)
  deptShare: number; // amount credited to the production department
  officeShare: number; // amount credited to Office
  cogs: number | null; // fan-body COGS used (fan lines)
  officeCost: number | null; // supplier cost booked to Office (bought-in), null if unmatched
  service?: boolean; // typed service / charge line (no product) — carries no COGS by design
}
export interface PnlSaleDetail {
  quotationId: string;
  href?: string; // link target (defaults to the quotation; set for counter sales)
  quoteNumber: string;
  customerId: string | null;
  customer: string;
  recognizedAt: string; // Manila YYYY-MM-DD
  basis: "PO date" | "Payment date" | "Transfer";
  net: number;
  lines: PnlSaleLine[];
}
export interface PnlExpenseItem {
  dept: DeptKey;
  source: "Purchase order" | "Cash voucher" | "Payroll" | "Stock transfer";
  ref: string;
  date: string; // Manila YYYY-MM-DD (or YYYY-MM for payroll)
  amount: number;
}
export type PnlVatByDept = Record<DeptKey, { output: number; input: number; payable: number }>;
/** Output VAT contributed by one order (quotation / counter sale). */
export interface PnlVatOrder {
  quotationId: string;
  href?: string;
  quoteNumber: string;
  customer: string;
  output: number;
}
/** Input VAT credited from one supplier (material POs + bought-in goods). */
export interface PnlVatSupplier {
  supplier: string;
  input: number;
}
/** A per-order amount (mark-up income / client discount) with a link to the order. */
export interface PnlOrderAmount {
  quotationId: string;
  href?: string;
  quoteNumber: string;
  customer: string;
  amount: number;
}
/** One order's mark-up / discount inputs and the net-of-VAT figures they produce. */
export interface PnlPricingAudit {
  quotationId: string;
  quoteNumber: string;
  customer: string;
  vatMode: string; // INCLUSIVE | EXCLUSIVE | EXCLUSIVE_PLUS
  grossBase: number; // Σ line gross (VAT-inclusive)
  orderNet: number; // grossBase ÷ 1.12
  markupMode: string; // percent | amount (as entered)
  markupValue: number; // as entered
  discountMode: string;
  discountValue: number;
  markupNet: number; // net-of-VAT mark-up booked to Office income
  discountNet: number; // net-of-VAT discount booked to Office expense
}

export interface PnlDetail {
  from: string;
  to: string;
  sales: PnlSaleDetail[];
  expenses: PnlExpenseItem[];
  vatByDept: PnlVatByDept;
  vatOutputByOrder: PnlVatOrder[];
  vatInputBySupplier: PnlVatSupplier[];
  markupIncome: number; // "Income from Mark up" — Office income (net)
  clientDiscounts: number; // "Client Discounts" — Office expense (net)
  markupByOrder: PnlOrderAmount[]; // mark-up income per order (clickable)
  discountByOrder: PnlOrderAmount[]; // client discount per order (clickable)
  pricingAudit: PnlPricingAudit[]; // per-order mark-up/discount inputs → net (self-check)
}

/**
 * Line-by-line breakdown for [from, to] so the summary P&L can be audited: each
 * confirmed sale with its per-line department/Office split, and each expense
 * with its source, department and date.
 */
export async function getPnlDetail(from: string, to: string): Promise<PnlDetail> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Invalid date range.");
  const [lo0, hi] = from <= to ? [from, to] : [to, from];
  // Go-live gate on → floor the report at the launch day (by payment/release date).
  const goLiveFloor = await goLiveFloorYMD();
  const lo = goLiveFloor && goLiveFloor > lo0 ? goLiveFloor : lo0;

  const { cogsOf, officeCostOfLine, supplierVatInclusive, isOfficeResale } = await buildCostResolvers();
  const cutoff = testModeCreatedAtFilter(await getTestMode());

  // --- Sales detail --------------------------------------------------------
  const quotations = await prisma.quotation.findMany({
    where: cutoff ? { createdAt: cutoff } : undefined,
    select: {
      id: true,
      quoteNumber: true,
      discountPct: true,
      vatMode: true,
      classification: true,
      inquiry: { select: { customer: { select: { id: true, company: true } } } },
      items: { select: { unitPrice: true, qty: true, specsSnapshot: true, descriptionSnapshot: true } },
    },
  });
  const outputVatByDept = zeroSplit();
  const inputVatByDept = zeroSplit();
  let markupIncome = 0;
  let clientDiscounts = 0;
  const markupByOrder: PnlOrderAmount[] = [];
  const discountByOrder: PnlOrderAmount[] = [];
  const pricingAudit: PnlPricingAudit[] = [];
  // Output VAT per order, and input VAT per supplier — the two VAT breakdowns.
  const vatOutputByOrder: PnlVatOrder[] = [];
  const inputVatBySupplier = new Map<string, number>();
  const addSupplierVat = (name: string, v: number) =>
    inputVatBySupplier.set(name, round2((inputVatBySupplier.get(name) ?? 0) + v));
  const sales: PnlSaleDetail[] = [];
  for (const q of quotations) {
    const sale = saleFromClassification(q.classification);
    const recAt = saleRecognitionDate(sale);
    if (!recAt) continue;
    const ymd = manilaYMD(recAt);
    if (!ymdInRange(ymd, lo, hi)) continue;
    const chargesVat = q.vatMode !== "EXCLUSIVE";
    const lines: PnlSaleLine[] = [];
    let orderOutputVat = 0;
    let grossSum = 0;
    for (const it of q.items) {
      const specs = (it.specsSnapshot && typeof it.specsSnapshot === "object" ? it.specsSnapshot : {}) as Record<string, unknown>;
      grossSum += (Number(it.unitPrice) || 0) * (Number(it.qty) || 0);
      const net = lineNetOf(Number(it.unitPrice), it.qty, 0);
      if (net === 0) continue;
      let { dept, routing } = lineRouting(specs);
      // A flagged Office/resale product is booked entirely to Office.
      if (routing !== "office_full" && isOfficeResale(officeLineHaystack(it.descriptionSnapshot, specs))) {
        dept = "office";
        routing = "office_full";
      }
      let cogs: number | null = null;
      let officeCost: number | null = null;
      let deptShare = 0;
      let officeShare = 0;
      const service = isServiceLine(specs);
      if (routing === "fan") {
        cogs = round2(Math.min(Math.max(cogsOf(specs), 0), net));
        deptShare = cogs;
        officeShare = round2(net - cogs);
      } else if (routing === "office_full") {
        // A service / charge line (no product selected) carries no COGS.
        const hit = service ? null : officeCostOfLine(specs, officeLineHaystack(it.descriptionSnapshot, specs));
        officeCost = hit ? round2(hit.unitCost * it.qty) : null;
        officeShare = round2(net - (officeCost ?? 0)); // margin: selling less supplier cost
        // While the go-live gate is on, resold goods are pre-launch opening stock,
        // so their input VAT belongs to the pre-launch period — skip it (only
        // post-go-live material POs generate input VAT).
        if (hit?.vatInclusive && officeCost && !goLiveFloor) {
          const v = round2(officeCost * VAT_RATE);
          inputVatByDept.office = round2(inputVatByDept.office + v);
          addSupplierVat(hit.company || "Bought-in goods", v);
        }
      } else {
        deptShare = round2(net / 1.3);
        officeShare = round2(net - deptShare);
      }
      if (chargesVat) {
        // Output VAT is on the full selling price — for a bought-in line the whole
        // net is the Office's sale, not the netted margin.
        outputVatByDept[dept] = round2(outputVatByDept[dept] + round2(deptShare * VAT_RATE));
        outputVatByDept.office = round2(outputVatByDept.office + round2((routing === "office_full" ? net : officeShare) * VAT_RATE));
        orderOutputVat = round2(orderOutputVat + round2(net * VAT_RATE));
      }
      const label = productLabel(specs, it.descriptionSnapshot);
      lines.push({ label, qty: it.qty, net, routing, dept, deptShare, officeShare, cogs, officeCost, service });
    }
    if (!lines.length) continue;
    const customer = q.inquiry?.customer?.company ?? "—";
    // Quote-level mark-up → Office income; discount → Office expense (both net).
    const pricing = readPricing(q.classification, Number(q.discountPct));
    const { markupNet, discountNet } = markupDiscountNet(grossSum, q.vatMode, pricing);
    markupIncome = round2(markupIncome + markupNet);
    clientDiscounts = round2(clientDiscounts + discountNet);
    if (markupNet > 0) markupByOrder.push({ quotationId: q.id, quoteNumber: q.quoteNumber, customer, amount: markupNet });
    if (discountNet > 0) discountByOrder.push({ quotationId: q.id, quoteNumber: q.quoteNumber, customer, amount: discountNet });
    if (pricing.markupValue > 0 || pricing.discountValue > 0) {
      pricingAudit.push({
        quotationId: q.id, quoteNumber: q.quoteNumber, customer, vatMode: q.vatMode,
        grossBase: round2(grossSum), orderNet: round2(grossSum / (1 + VAT_RATE)),
        markupMode: pricing.markupMode, markupValue: pricing.markupValue,
        discountMode: pricing.discountMode, discountValue: pricing.discountValue,
        markupNet, discountNet,
      });
    }
    if (chargesVat) {
      const adj = round2(round2(markupNet * VAT_RATE) - round2(discountNet * VAT_RATE));
      outputVatByDept.office = round2(outputVatByDept.office + adj);
      orderOutputVat = round2(orderOutputVat + adj);
    }
    sales.push({
      quotationId: q.id,
      quoteNumber: q.quoteNumber,
      customerId: q.inquiry?.customer?.id ?? null,
      customer,
      recognizedAt: ymd,
      basis: sale!.arrangement === "terms" ? "PO date" : "Payment date",
      net: round2(lines.reduce((a, l) => a + l.net, 0)),
      lines,
    });
    if (orderOutputVat > 0) vatOutputByOrder.push({ quotationId: q.id, quoteNumber: q.quoteNumber, customer, output: orderOutputVat });
  }
  // Counter sales (walk-in) → Office, as margin (net less stock COGS).
  const counterSalesD = await prisma.counterSale.findMany({
    where: { status: "COMPLETED", ...(cutoff ? { createdAt: cutoff } : {}) },
    select: { id: true, saleNumber: true, vatMode: true, subtotal: true, completedAt: true, customerId: true, customer: { select: { company: true } }, items: { select: { qty: true, stockItemId: true } } },
  });
  const csCost = await counterSaleCostMap(counterSalesD);
  for (const cs of counterSalesD) {
    if (!cs.completedAt) continue;
    const ymd = manilaYMD(cs.completedAt.toISOString());
    if (!ymdInRange(ymd, lo, hi)) continue;
    const net = Number(cs.subtotal) || 0;
    const cogs = round2(cs.items.reduce((a, i) => a + (i.stockItemId ? (csCost.get(i.stockItemId)?.cost ?? 0) * Number(i.qty) : 0), 0));
    // In-house duct hardware on a counter sale → Fans is credited its production cost.
    const fansCogs = counterSaleFansCogs(cs.items, csCost);
    if (cs.vatMode !== "EXCLUSIVE") {
      const v = round2(net * VAT_RATE);
      outputVatByDept.office = round2(outputVatByDept.office + v);
      vatOutputByOrder.push({ quotationId: cs.id, href: `/counter-sales/${cs.id}`, quoteNumber: cs.saleNumber ?? "Counter sale", customer: cs.customer.company, output: v });
    }
    const n = cs.items.length;
    const lines: PnlSaleLine[] = [];
    if (fansCogs > 0) {
      lines.push({ label: "Duct hardware — production cost", qty: 1, net: fansCogs, routing: "production_markup", dept: "fans", deptShare: fansCogs, officeShare: 0, cogs: null, officeCost: null });
    }
    lines.push({ label: `Counter sale · ${n} item${n === 1 ? "" : "s"}`, qty: 1, net: round2(net - fansCogs), routing: "office_full", dept: "office", deptShare: 0, officeShare: round2(net - cogs), cogs: null, officeCost: round2(cogs - fansCogs) || null });
    sales.push({
      quotationId: cs.id,
      href: `/counter-sales/${cs.id}`,
      quoteNumber: cs.saleNumber ?? "Counter sale",
      customerId: cs.customerId,
      customer: cs.customer.company,
      recognizedAt: ymd,
      basis: "Payment date",
      net,
      lines,
    });
  }
  sales.sort((a, b) => a.recognizedAt.localeCompare(b.recognizedAt) || a.quoteNumber.localeCompare(b.quoteNumber));

  // --- Expense detail ------------------------------------------------------
  const expenses: PnlExpenseItem[] = [];
  const prs = await prisma.purchaseRequest.findMany({
    where: { dept: { not: null }, status: { not: "CANCELLED" }, ...(cutoff ? { createdAt: cutoff } : {}) },
    select: { dept: true, po: true, chainLog: true },
  });
  for (const pr of prs) {
    const releasedAt = coerceChainLog(pr.chainLog).release_cash?.at;
    if (!releasedAt || !ymdInRange(manilaYMD(releasedAt), lo, hi)) continue;
    const dept = pr.dept as DeptKey;
    if (!PROD_DEPT_KEYS.has(dept)) continue;
    const po = coercePurchaseOrder(pr.po);
    if (!po) continue;
    const incl = supplierVatInclusive(po.supplier.company);
    const gross = poTotals(po).total;
    const net = incl ? round2(gross / (1 + VAT_RATE)) : round2(gross);
    expenses.push({ dept, source: "Purchase order", ref: po.poNumber, date: manilaYMD(releasedAt), amount: net });
    if (incl) {
      const v = round2(net * VAT_RATE);
      inputVatByDept[dept] = round2(inputVatByDept[dept] + v);
      addSupplierVat(po.supplier.company || "—", v);
    }
  }
  const RELEASED = new Set(["CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED", "SETTLED"]);
  const crs = await prisma.cashRequest.findMany({
    where: { releasedAt: { not: null }, ...(cutoff ? { createdAt: cutoff } : {}) },
    select: { number: true, dept: true, amount: true, releasedAt: true, status: true },
  });
  for (const cr of crs) {
    if (!RELEASED.has(cr.status) || !cr.releasedAt) continue;
    if (!ymdInRange(manilaYMD(cr.releasedAt.toISOString()), lo, hi)) continue;
    const dept: DeptKey = cr.dept && PROD_DEPT_KEYS.has(cr.dept as DeptKey) ? (cr.dept as DeptKey) : "office";
    expenses.push({ dept, source: "Cash voucher", ref: cr.number, date: manilaYMD(cr.releasedAt.toISOString()), amount: round2(Number(cr.amount) || 0) });
  }
  try {
    const months: string[] = [];
    for (let d = new Date(`${lo.slice(0, 7)}-01T00:00:00Z`); d <= new Date(`${hi.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1)) {
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    const rows = await prisma.payroll.findMany({ where: { month: { in: months } } });
    for (const p of rows) {
      const amt = Number(p.amount) || 0;
      if (amt <= 0) continue;
      expenses.push({ dept: p.dept as DeptKey, source: "Payroll", ref: p.month, date: p.month, amount: round2(amt) });
    }
  } catch {
    // payroll table not migrated — skip
  }
  // --- Inter-department stock transfers (in-house duct hardware, Fans → dept) --
  // Booked at the stock item's production cost: a SALE for the producing dept
  // (Fans) and a PURCHASE (expense) for the requesting dept. Internal move — no
  // VAT, no customer — so it's appended after the VAT-bearing sales are tallied.
  const transfers = await prisma.deptStockTransfer.findMany({
    where: cutoff ? { createdAt: cutoff } : undefined,
    select: { id: true, at: true, quotationId: true, fromDept: true, toDept: true, description: true, qty: true, value: true },
  });
  let xferSeq = 0;
  for (const t of transfers) {
    const ymd = manilaYMD(t.at.toISOString());
    if (!ymdInRange(ymd, lo, hi)) continue;
    const from = t.fromDept as DeptKey;
    const to = t.toDept as DeptKey;
    const value = Number(t.value) || 0;
    if (value <= 0 || !(from in DEPT_LABEL) || !(to in DEPT_LABEL)) continue;
    xferSeq += 1;
    // Producing-dept side — a sale credited to Fans (no Office share, no VAT).
    sales.push({
      quotationId: t.quotationId ?? `xfer-${t.id}`,
      href: t.quotationId ? `/orders/${t.quotationId}` : "/inventory",
      quoteNumber: `Transfer #${xferSeq}`,
      customerId: null,
      customer: `${DEPT_LABEL[from]} → ${DEPT_LABEL[to]}`,
      recognizedAt: ymd,
      basis: "Transfer",
      net: value,
      lines: [{ label: t.description, qty: Number(t.qty) || 0, net: value, routing: "production_markup", dept: from, deptShare: value, officeShare: 0, cogs: null, officeCost: null }],
    });
    // Requesting-dept side — a purchase/expense.
    expenses.push({ dept: to, source: "Stock transfer", ref: t.description, date: ymd, amount: value });
  }
  sales.sort((a, b) => a.recognizedAt.localeCompare(b.recognizedAt) || a.quoteNumber.localeCompare(b.quoteNumber));
  expenses.sort((a, b) => a.date.localeCompare(b.date) || a.dept.localeCompare(b.dept));

  const vatByDept = Object.fromEntries(
    (Object.keys(outputVatByDept) as DeptKey[]).map((k) => [
      k,
      { output: outputVatByDept[k], input: inputVatByDept[k], payable: round2(outputVatByDept[k] - inputVatByDept[k]) },
    ]),
  ) as PnlVatByDept;

  vatOutputByOrder.sort((a, b) => b.output - a.output || a.quoteNumber.localeCompare(b.quoteNumber));
  const vatInputBySupplier: PnlVatSupplier[] = [...inputVatBySupplier.entries()]
    .map(([supplier, input]) => ({ supplier, input }))
    .sort((a, b) => b.input - a.input || a.supplier.localeCompare(b.supplier));
  markupByOrder.sort((a, b) => b.amount - a.amount || a.quoteNumber.localeCompare(b.quoteNumber));
  discountByOrder.sort((a, b) => b.amount - a.amount || a.quoteNumber.localeCompare(b.quoteNumber));

  pricingAudit.sort((a, b) => a.quoteNumber.localeCompare(b.quoteNumber));
  return { from: lo, to: hi, sales, expenses, vatByDept, vatOutputByOrder, vatInputBySupplier, markupIncome, clientDiscounts, markupByOrder, discountByOrder, pricingAudit };
}
