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
import { getTestMode, testModeCreatedAtFilter } from "@/lib/test-mode";
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
  vat: { output: number; input: number; payable: number }; // VAT for BIR (not in profit)
}

function addSplit(into: DeptSplit, from: DeptSplit) {
  for (const k of Object.keys(into) as DeptKey[]) into[k] = round2(into[k] + from[k]);
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
        if (!best || unitCost < best.unitCost) best = { name: p.name, sku: p.sku, unitCost, vatInclusive: incl };
      }
      return best;
    })
    .filter((e): e is OfficeCostEntry => e != null && e.unitCost > 0);
  const officeCostOf = officeCostLookup(costEntries);

  return { cogsOf, officeCostOf, supplierVatInclusive };
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
  const officeUnmatched = new Set<string>();
  let outputVat = 0;
  let inputVat = 0;

  const { cogsOf, officeCostOf, supplierVatInclusive } = await buildCostResolvers();
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
    const disc = Number(q.discountPct) || 0;
    // A VAT-exclusive quote charges the client no VAT — no output VAT on it.
    const chargesVat = q.vatMode !== "EXCLUSIVE";
    for (const it of q.items) {
      const specs = (it.specsSnapshot && typeof it.specsSnapshot === "object"
        ? it.specsSnapshot
        : {}) as Record<string, unknown>;
      const net = lineNetOf(Number(it.unitPrice), it.qty, disc);
      if (net === 0) continue;
      if (chargesVat) outputVat = round2(outputVat + round2(net * VAT_RATE));
      const routing = lineRouting(specs).routing;
      let cogs = 0;
      if (routing === "fan") {
        cogs = cogsOf(specs);
        if (cogs <= 0) fanLinesPending += 1;
      } else if (routing === "office_full") {
        // Bought-in good: its supplier cost is an Office expense. Discount the
        // cost proportionally so it lines up with the discounted sale.
        const hit = officeCostOf(officeLineHaystack(it.descriptionSnapshot, specs));
        if (hit) {
          const cost = round2(hit.unitCost * it.qty * (1 - disc / 100));
          expenses.office = round2(expenses.office + cost);
          if (hit.vatInclusive) inputVat = round2(inputVat + round2(cost * VAT_RATE));
        } else {
          officeCostUnmatched += 1;
          const label = productLabel(specs, it.descriptionSnapshot);
          if (label) officeUnmatched.add(label);
        }
      }
      addSplit(sales, lineSalesSplit(specs, net, cogs));
    }
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

  return { from: lo, to: hi, rows, totals, salesCount, fanLinesPending, officeCostUnmatched, officeUnmatchedItems: [...officeUnmatched].sort(), vat };
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
}
export interface PnlSaleDetail {
  quotationId: string;
  quoteNumber: string;
  customerId: string | null;
  customer: string;
  recognizedAt: string; // Manila YYYY-MM-DD
  basis: "PO date" | "Payment date";
  net: number;
  lines: PnlSaleLine[];
}
export interface PnlExpenseItem {
  dept: DeptKey;
  source: "Purchase order" | "Cash voucher" | "Payroll";
  ref: string;
  date: string; // Manila YYYY-MM-DD (or YYYY-MM for payroll)
  amount: number;
}
export type PnlVatByDept = Record<DeptKey, { output: number; input: number; payable: number }>;
export interface PnlDetail {
  from: string;
  to: string;
  sales: PnlSaleDetail[];
  expenses: PnlExpenseItem[];
  vatByDept: PnlVatByDept;
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
  const [lo, hi] = from <= to ? [from, to] : [to, from];

  const { cogsOf, officeCostOf, supplierVatInclusive } = await buildCostResolvers();
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
  const sales: PnlSaleDetail[] = [];
  for (const q of quotations) {
    const sale = saleFromClassification(q.classification);
    const recAt = saleRecognitionDate(sale);
    if (!recAt) continue;
    const ymd = manilaYMD(recAt);
    if (!ymdInRange(ymd, lo, hi)) continue;
    const disc = Number(q.discountPct) || 0;
    const chargesVat = q.vatMode !== "EXCLUSIVE";
    const lines: PnlSaleLine[] = [];
    for (const it of q.items) {
      const specs = (it.specsSnapshot && typeof it.specsSnapshot === "object" ? it.specsSnapshot : {}) as Record<string, unknown>;
      const net = lineNetOf(Number(it.unitPrice), it.qty, disc);
      if (net === 0) continue;
      const { dept, routing } = lineRouting(specs);
      let cogs: number | null = null;
      let officeCost: number | null = null;
      let deptShare = 0;
      let officeShare = 0;
      if (routing === "fan") {
        cogs = round2(Math.min(Math.max(cogsOf(specs), 0), net));
        deptShare = cogs;
        officeShare = round2(net - cogs);
      } else if (routing === "office_full") {
        officeShare = net;
        const hit = officeCostOf(officeLineHaystack(it.descriptionSnapshot, specs));
        officeCost = hit ? round2(hit.unitCost * it.qty * (1 - disc / 100)) : null;
        if (hit?.vatInclusive && officeCost) inputVatByDept.office = round2(inputVatByDept.office + round2(officeCost * VAT_RATE));
      } else {
        deptShare = round2(net / 1.3);
        officeShare = round2(net - deptShare);
      }
      if (chargesVat) {
        outputVatByDept[dept] = round2(outputVatByDept[dept] + round2(deptShare * VAT_RATE));
        outputVatByDept.office = round2(outputVatByDept.office + round2(officeShare * VAT_RATE));
      }
      const label = productLabel(specs, it.descriptionSnapshot);
      lines.push({ label, qty: it.qty, net, routing, dept, deptShare, officeShare, cogs, officeCost });
    }
    if (!lines.length) continue;
    sales.push({
      quotationId: q.id,
      quoteNumber: q.quoteNumber,
      customerId: q.inquiry?.customer?.id ?? null,
      customer: q.inquiry?.customer?.company ?? "—",
      recognizedAt: ymd,
      basis: sale!.arrangement === "terms" ? "PO date" : "Payment date",
      net: round2(lines.reduce((a, l) => a + l.net, 0)),
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
    if (incl) inputVatByDept[dept] = round2(inputVatByDept[dept] + round2(net * VAT_RATE));
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
  expenses.sort((a, b) => a.date.localeCompare(b.date) || a.dept.localeCompare(b.dept));

  const vatByDept = Object.fromEntries(
    (Object.keys(outputVatByDept) as DeptKey[]).map((k) => [
      k,
      { output: outputVatByDept[k], input: inputVatByDept[k], payable: round2(outputVatByDept[k] - inputVatByDept[k]) },
    ]),
  ) as PnlVatByDept;

  return { from: lo, to: hi, sales, expenses, vatByDept };
}
