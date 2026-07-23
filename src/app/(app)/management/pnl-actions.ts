"use server";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { round2 } from "@/lib/quote";
import { config } from "@/lib/config";
import { saleFromClassification } from "@/lib/sale";
import { coerceChainLog } from "@/lib/purchase-chain-row";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import {
  PNL_DEPARTMENTS,
  zeroSplit,
  lineNetOf,
  lineSalesSplit,
  lineRouting,
  saleRecognitionDate,
  manilaYMD,
  ymdInRange,
  type DeptKey,
  type DeptSplit,
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

  // --- Sales ---------------------------------------------------------------
  const quotations = await prisma.quotation.findMany({
    select: {
      discountPct: true,
      classification: true,
      items: { select: { unitPrice: true, qty: true, specsSnapshot: true } },
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
      if (lineRouting(specs).routing === "fan") fanLinesPending += 1;
      addSplit(sales, lineSalesSplit(specs, net, 0));
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

  return { from: lo, to: hi, rows, totals, salesCount, fanLinesPending };
}
