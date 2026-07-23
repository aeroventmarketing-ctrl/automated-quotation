"use server";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { round2 } from "@/lib/quote";
import { config } from "@/lib/config";
import { saleFromClassification } from "@/lib/sale";
import { coerceChainLog } from "@/lib/purchase-chain-row";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { getProducts } from "@/lib/product-catalog";
import { getSuppliers } from "@/lib/suppliers";
import { payrollExpenseForRange } from "./payroll-actions";
import {
  PNL_DEPARTMENTS,
  zeroSplit,
  lineNetOf,
  lineSalesSplit,
  lineRouting,
  saleRecognitionDate,
  fanCogsLookup,
  officeCostLookup,
  officeLineHaystack,
  manilaYMD,
  ymdInRange,
  type DeptKey,
  type DeptSplit,
  type FanCogsRow,
  type OfficeCostEntry,
} from "@/lib/department-pnl";

const VAT_RATE = config.vatRate || 0.12;
const PROD_DEPT_KEYS = new Set<DeptKey>(["fans", "duct", "accessories", "motor"]);

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
}

function addSplit(into: DeptSplit, from: DeptSplit) {
  for (const k of Object.keys(into) as DeptKey[]) into[k] = round2(into[k] + from[k]);
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
  const [lo, hi] = from <= to ? [from, to] : [to, from];

  const sales = zeroSplit();
  const expenses = zeroSplit();
  let salesCount = 0;
  let fanLinesPending = 0;
  let officeCostUnmatched = 0;

  // Fan-body COGS table (empty until 0027_fan_body_cogs is applied).
  let cogsRows: FanCogsRow[] = [];
  try {
    const rows = await prisma.fanBodyCogs.findMany();
    cogsRows = rows.map((r) => ({ modelCode: r.modelCode, size: r.size, material: r.material, cost: Number(r.cost) || 0 }));
  } catch {
    cogsRows = [];
  }
  const cogsOf = fanCogsLookup(cogsRows);

  // Office cost of bought-in goods, from the Products tab. Each product's net
  // unit cost is its cheapest supplier price, converted to net using that
  // supplier's VAT-inclusive flag.
  const [products, suppliers] = await Promise.all([getProducts().catch(() => []), getSuppliers().catch(() => [])]);
  const vatById = new Map(suppliers.map((s) => [s.id, s.vatInclusive] as const));
  const vatByCompany = new Map(suppliers.map((s) => [s.company.trim().toLowerCase(), s.vatInclusive] as const));
  const netCost = (price: number, supplierId: string, company: string): number => {
    const incl = vatById.get(supplierId) ?? vatByCompany.get((company || "").trim().toLowerCase()) ?? true;
    return incl ? price / (1 + VAT_RATE) : price;
  };
  const costEntries: OfficeCostEntry[] = products
    .map((p) => {
      const costs = p.suppliers
        .filter((l) => (l.price ?? 0) > 0)
        .map((l) => round2(netCost(l.price!, l.supplierId, l.company)));
      return { name: p.name, sku: p.sku, unitCost: costs.length ? Math.min(...costs) : 0 };
    })
    .filter((e) => e.unitCost > 0);
  const officeCostOf = officeCostLookup(costEntries);

  // --- Sales ---------------------------------------------------------------
  const quotations = await prisma.quotation.findMany({
    select: {
      discountPct: true,
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
    const disc = Number(q.discountPct) || 0;
    for (const it of q.items) {
      const specs = (it.specsSnapshot && typeof it.specsSnapshot === "object"
        ? it.specsSnapshot
        : {}) as Record<string, unknown>;
      const net = lineNetOf(Number(it.unitPrice), it.qty, disc);
      if (net === 0) continue;
      const routing = lineRouting(specs).routing;
      let cogs = 0;
      if (routing === "fan") {
        cogs = cogsOf(specs);
        if (cogs <= 0) fanLinesPending += 1;
      } else if (routing === "office_full") {
        // Bought-in good: its supplier cost is an Office expense. Discount the
        // cost proportionally so it lines up with the discounted sale.
        const unitCost = officeCostOf(officeLineHaystack(it.descriptionSnapshot, specs));
        if (unitCost > 0) {
          expenses.office = round2(expenses.office + round2(unitCost * it.qty * (1 - disc / 100)));
        } else {
          officeCostUnmatched += 1;
        }
      }
      addSplit(sales, lineSalesSplit(specs, net, cogs));
    }
  }

  // --- Expenses: purchase requests (material POs) --------------------------
  // Booked to the requesting department, net of VAT, on the cash-released date.
  const prs = await prisma.purchaseRequest.findMany({
    where: { dept: { not: null }, status: { not: "CANCELLED" } },
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
    const net = round2(poTotals(po).total / (1 + VAT_RATE));
    expenses[dept] = round2(expenses[dept] + net);
  }

  // --- Expenses: cash requests (vouchers) ---------------------------------
  // Released cash, booked to its department (or Office when unassigned).
  const RELEASED = new Set(["CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED", "SETTLED"]);
  const crs = await prisma.cashRequest.findMany({
    where: { releasedAt: { not: null } },
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

  return { from: lo, to: hi, rows, totals, salesCount, fanLinesPending, officeCostUnmatched };
}
