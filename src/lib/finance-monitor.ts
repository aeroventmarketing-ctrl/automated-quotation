/**
 * Finance-monitor data — the Receivables, Unreconciled payments, Cash vouchers,
 * Stock alerts and Purchasing & commissions figures shown on the Management
 * Dashboard, packaged so other surfaces (e.g. Accounting's My Dashboard) can show
 * the same cards from one source of truth. Scoped to post-go-live activity while
 * the alerts go-live gate is on, exactly like the Management Dashboard.
 */
import { prisma } from "@/lib/db";
import { payableTotal, round2 } from "@/lib/quote";
import { saleFromClassification, isSaleConfirmed, collectedTotal } from "@/lib/sale";
import { readOrderWorkflow, stageIndex } from "@/lib/order-workflow";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { coerceReconciliation, isReconciled } from "@/lib/purchase-reconcile";
import { cashExpenseBooked } from "@/lib/cash-request";
import { getPrintedVouchers, type PrintedVoucherLine } from "@/lib/purchase-voucher";
import { saleRecognitionDate, manilaYMD } from "@/lib/department-pnl";
import { getAlertGoLive, alertGoLiveCreatedAtFilter } from "@/lib/alert-golive";

export interface UnbalancedRow {
  orderId: string;
  customerId: string;
  company: string;
  quoteNumber: string;
  value: number;
  collected: number;
  balance: number;
  delivered: boolean;
  closed: boolean;
}
export interface LowStockRow { id: string; name: string; unit: string; quantity: number }
export type VoucherState = "mismatch" | "awaiting" | "tallied";
export interface VoucherRow {
  no: string;
  /** "po" = printed from Purchasing against a PO (tallied vs approved PO);
   *  "cash" = a released cash-request voucher (operating expense, not PO-tied). */
  kind: "po" | "cash";
  paidTo: string;
  lines: PrintedVoucherLine[];
  total: number;
  approvedTotal: number;
  state: VoucherState;
  printedByName: string;
  printedAt: string;
}
export interface FinanceMonitor {
  outstanding: number;
  billed: number;
  collected: number;
  collectedPct: number;
  unbalanced: UnbalancedRow[];
  deliveredUnpaid: number;
  lowStock: LowStockRow[];
  prPendingCount: number;
  commissionsUnpaidCount: number;
  unpaidCommission: number;
  vouchers: VoucherRow[];
}

/** Compute the finance-monitor figures (mirrors the Management Dashboard). */
export async function getFinanceMonitor(): Promise<FinanceMonitor> {
  const alertGate = await getAlertGoLive();
  const goLiveCutoff = alertGoLiveCreatedAtFilter(alertGate); // { gt: Date } | undefined
  const createdFilter = goLiveCutoff ? { createdAt: goLiveCutoff } : {};
  const goLiveFloorYMD = alertGate.on ? manilaYMD(alertGate.at) : null;

  const [wonQuotes, stockItems, commissions, prPending] = await Promise.all([
    // Source from confirmed sales — NOT inquiry.status === "WON". A quotation
    // revision reopens the inquiry (status leaves WON), so a WON filter drops
    // confirmed, already-paid orders. isSaleConfirmed below is the real gate,
    // exactly as the departmental P&L does it.
    prisma.quotation.findMany({
      select: { id: true, classification: true, total: true, discountPct: true, vatMode: true, quoteNumber: true, inquiry: { select: { customer: { select: { id: true, company: true } } } } },
    }),
    prisma.stockItem.findMany({ where: { active: true, ...createdFilter }, orderBy: { name: "asc" } }).catch(() => []),
    prisma.commission.findMany({ where: { paid: false, ...createdFilter }, select: { amount: true, orderValue: true, quotation: { select: { classification: true } }, counterSale: { select: { paymentCleared: true } } } }).catch(() => []),
    // CANCELLED is terminal too — a withdrawn request is not money in flight,
    // and counting it inflated the pending-purchase figure.
    prisma.purchaseRequest.findMany({ where: { status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] }, ...createdFilter }, select: { id: true } }).catch(() => []),
  ]);

  // Receivables + unreconciled — confirmed orders recognised after go-live.
  let outstanding = 0;
  let billed = 0;
  let collected = 0;
  const unbalanced: UnbalancedRow[] = [];
  for (const q of wonQuotes) {
    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;
    if (goLiveFloorYMD) {
      const recAt = saleRecognitionDate(sale);
      if (!recAt || manilaYMD(recAt) < goLiveFloorYMD) continue;
    }
    const wf = readOrderWorkflow(q.classification);
    const value = round2(payableTotal(q));
    const paid = round2(collectedTotal(sale));
    billed = round2(billed + value);
    collected = round2(collected + paid);
    const balance = round2(value - paid);
    if (balance > 0.005) {
      outstanding = round2(outstanding + balance);
      unbalanced.push({
        orderId: q.id,
        customerId: q.inquiry?.customer?.id ?? "",
        company: q.inquiry?.customer?.company ?? "—",
        quoteNumber: q.quoteNumber,
        value,
        collected: paid,
        balance,
        delivered: stageIndex(wf.stage) >= stageIndex("delivered"),
        closed: wf.stage === "closed",
      });
    }
  }
  unbalanced.sort((a, b) => Number(b.delivered) - Number(a.delivered) || b.balance - a.balance);
  const deliveredUnpaid = unbalanced.filter((u) => u.delivered).length;
  const collectedPct = billed > 0 ? Math.round((collected / billed) * 100) : 0;

  const lowStock: LowStockRow[] = stockItems
    .filter((i) => { const q = Number(i.quantity); const r = Number(i.reorderLevel); return q <= 0 || (r > 0 && q <= r); })
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit, quantity: Number(i.quantity) }));

  // Commissions count once the order is fully paid (matches the Commissions page).
  const payableCommissions = commissions.filter((c) => {
    const ov = Number(c.orderValue);
    if (c.counterSale) return c.counterSale.paymentCleared;
    if (c.quotation) {
      const col = collectedTotal(saleFromClassification(c.quotation.classification));
      return ov > 0 && col >= ov - 0.005;
    }
    return false;
  });
  const unpaidCommission = round2(payableCommissions.reduce((a, c) => a + Number(c.amount), 0));

  // Printed cash vouchers (after go-live) and whether they tally with their POs.
  const printedVouchers = (await getPrintedVouchers().catch(() => []))
    .filter((v) => !goLiveCutoff || (v.printedAt && new Date(v.printedAt) > goLiveCutoff.gt));
  const voucherPrIds = [...new Set(printedVouchers.flatMap((v) => v.ids))];
  const voucherPrs = voucherPrIds.length
    ? await prisma.purchaseRequest.findMany({ where: { id: { in: voucherPrIds } }, select: { id: true, po: true, reconciliation: true } }).catch(() => [])
    : [];
  const voucherPrNet = new Map(voucherPrs.map((pr) => { const po = coercePurchaseOrder(pr.po); return [pr.id, po ? poTotals(po).net : 0]; }));
  const voucherReconciled = new Map(voucherPrs.map((pr) => [pr.id, isReconciled(coerceReconciliation(pr.reconciliation))]));
  const poVouchers: VoucherRow[] = printedVouchers.map((v) => {
    const approvedTotal = round2(v.ids.reduce((s, id) => s + (voucherPrNet.get(id) ?? 0), 0));
    const amountMatches = Math.abs(approvedTotal - round2(v.total)) < 0.01;
    const reconciled = v.ids.length > 0 && v.ids.every((id) => voucherReconciled.get(id));
    const state: VoucherState = !amountMatches ? "mismatch" : reconciled ? "tallied" : "awaiting";
    return { no: v.no, kind: "po" as const, paidTo: v.paidTo, lines: v.lines, total: v.total, approvedTotal, state, printedByName: v.printedByName, printedAt: v.printedAt };
  });

  // Released cash-request vouchers (operating-expense cash vouchers — Office
  // internet, fuel, permits, etc. — not tied to a PO). Same released statuses and
  // go-live scope the P&L uses, so the card mirrors the Expenses report.
  const RELEASED_CASH = new Set(["CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED", "SETTLED"]);
  const cashCrs = await prisma.cashRequest
    .findMany({
      // Released after go-live (mirrors the PO vouchers' printedAt > cutoff filter).
      where: { releasedAt: goLiveCutoff ? { not: null, gt: goLiveCutoff.gt } : { not: null } },
      select: { number: true, purpose: true, amount: true, requestedByName: true, voucherByName: true, releasedByName: true, voucherAt: true, releasedAt: true, status: true, liquidation: true },
    })
    .catch(() => []);
  const cashVouchers: VoucherRow[] = cashCrs
    .filter((cr) => RELEASED_CASH.has(cr.status) && cr.releasedAt)
    .map((cr) => {
      const total = cashExpenseBooked(Number(cr.amount) || 0, cr.liquidation);
      return {
        no: cr.number,
        kind: "cash" as const,
        paidTo: cr.requestedByName || "—",
        lines: cr.purpose ? [{ description: cr.purpose, amount: total }] : [],
        total,
        approvedTotal: total, // no PO to tally against — the voucher is its own total
        state: "tallied" as VoucherState,
        printedByName: cr.voucherByName || cr.releasedByName || cr.requestedByName || "",
        printedAt: (cr.voucherAt ?? cr.releasedAt)!.toISOString(),
      };
    });

  const vouchers: VoucherRow[] = [...poVouchers, ...cashVouchers].sort((a, b) => b.printedAt.localeCompare(a.printedAt));

  return { outstanding, billed, collected, collectedPct, unbalanced, deliveredUnpaid, lowStock, prPendingCount: prPending.length, commissionsUnpaidCount: payableCommissions.length, unpaidCommission, vouchers };
}
