/**
 * Recent activity for the Management dashboard — the last N days (default 3:
 * today, yesterday, the day before) of reconciled vouchers, MRFs, requisitions,
 * POs and related events, each with its own action date. Read-only reporting: it
 * derives events from existing records (PurchaseRequest columns, CashRequest
 * columns, and the order-workflow MRF JSON) and never mutates anything.
 */
import { prisma } from "@/lib/db";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { coerceReconciliation, isReconciled } from "@/lib/purchase-reconcile";
import { isDeptRequisition } from "@/lib/purchasing";
import { readOrderWorkflow } from "@/lib/order-workflow";

export type ActivityKind = "Requisition" | "PO" | "Reconciled" | "Voucher" | "MRF" | "Other";

export interface RecentActivityItem {
  id: string;
  kind: ActivityKind;
  label: string; // e.g. "PO issued", "Voucher released", "MRF released"
  ref: string; // PO number / voucher number / MRF form no / quote number
  detail: string;
  amount: number | null;
  who: string;
  at: string; // ISO event date
  href: string;
}
export interface RecentActivityDay {
  ymd: string; // Manila YYYY-MM-DD
  label: string; // "Today" / "Yesterday" / "Fri, Aug 8"
  items: RecentActivityItem[];
}

const MANILA = 8 * 3_600_000; // Asia/Manila (UTC+8, no DST)
const manilaYMD = (d: Date): string => new Date(d.getTime() + MANILA).toISOString().slice(0, 10);

const itemName = (it: unknown): string =>
  typeof it === "string" ? it : (((it as Record<string, unknown>)?.name as string) || ((it as Record<string, unknown>)?.description as string) || "");
const summarize = (items: unknown, n = 2): string =>
  Array.isArray(items) ? items.map(itemName).filter(Boolean).slice(0, n).join(", ") : "";

/** Events (with their own action dates) across the last `days` Manila days. */
export async function getRecentActivity(days = 3): Promise<RecentActivityDay[]> {
  const now = new Date();
  const mNow = new Date(now.getTime() + MANILA);
  const todayMidnightUtc = Date.UTC(mNow.getUTCFullYear(), mNow.getUTCMonth(), mNow.getUTCDate()) - MANILA;
  const windowStart = new Date(todayMidnightUtc - (days - 1) * 86_400_000); // 00:00 Manila of the earliest day
  const startMs = windowStart.getTime();
  const inWin = (v: string | Date | null | undefined): boolean => {
    if (!v) return false;
    const t = typeof v === "string" ? Date.parse(v) : v.getTime();
    return Number.isFinite(t) && t >= startMs;
  };

  const items: RecentActivityItem[] = [];

  // --- Purchasing: requisitions, POs, reconciliations --------------------
  const prs = await prisma.purchaseRequest
    .findMany({
      where: { updatedAt: { gte: windowStart } },
      select: {
        id: true, kind: true, mrfId: true, note: true, items: true, po: true, reconciliation: true,
        createdAt: true, createdByName: true, purchasedAt: true, purchasedByName: true,
        receivedAt: true, receivedByName: true, dept: true, quotation: { select: { quoteNumber: true } },
      },
      take: 400,
    })
    .catch(() => []);
  for (const pr of prs) {
    const po = coercePurchaseOrder(pr.po);
    const poNo = po?.poNumber || "";
    const net = po ? poTotals(po).net : null;
    const detail = summarize(pr.items) || pr.note || "";
    const href = `/purchasing/po/${pr.id}`;
    const ref = poNo || pr.quotation?.quoteNumber || pr.dept || "—";

    if (inWin(pr.createdAt)) {
      const req = isDeptRequisition(pr);
      items.push({ id: `pr-new-${pr.id}`, kind: req ? "Requisition" : "Other", label: req ? "Requisition raised" : "Purchase request raised", ref, detail, amount: null, who: pr.createdByName, at: pr.createdAt.toISOString(), href });
    }
    if (inWin(pr.purchasedAt)) items.push({ id: `pr-po-${pr.id}`, kind: "PO", label: "PO issued", ref: poNo || ref, detail, amount: net, who: pr.purchasedByName || "", at: pr.purchasedAt!.toISOString(), href });
    if (inWin(pr.receivedAt)) items.push({ id: `pr-recv-${pr.id}`, kind: "PO", label: "PO received", ref: poNo || ref, detail, amount: net, who: pr.receivedByName || "", at: pr.receivedAt!.toISOString(), href });
    const rec = coerceReconciliation(pr.reconciliation);
    if (isReconciled(rec)) {
      const at = rec.settled?.at || rec.approval?.at || rec.recordedAt || "";
      if (inWin(at)) items.push({ id: `pr-rec-${pr.id}`, kind: "Reconciled", label: "Voucher reconciled", ref: poNo || ref, detail, amount: net, who: rec.settled?.byName || rec.recordedByName || "", at, href });
    }
  }

  // --- Cash vouchers: released, settled / liquidated ---------------------
  const crs = await prisma.cashRequest
    .findMany({
      where: { updatedAt: { gte: windowStart } },
      select: { id: true, number: true, purpose: true, amount: true, requestedByName: true, releasedAt: true, releasedByName: true, updatedAt: true, status: true },
      take: 400,
    })
    .catch(() => []);
  for (const cr of crs) {
    const href = `/cash-requests/${cr.id}/voucher`;
    const amt = Number(cr.amount) || 0;
    if (inWin(cr.releasedAt)) items.push({ id: `cr-rel-${cr.id}`, kind: "Voucher", label: "Voucher released", ref: cr.number, detail: cr.purpose, amount: amt, who: cr.releasedByName || cr.requestedByName, at: cr.releasedAt!.toISOString(), href });
    if ((cr.status === "SETTLED" || cr.status === "LIQUIDATED") && inWin(cr.updatedAt))
      items.push({ id: `cr-set-${cr.id}`, kind: "Reconciled", label: cr.status === "SETTLED" ? "Voucher settled" : "Voucher liquidated", ref: cr.number, detail: cr.purpose, amount: amt, who: cr.requestedByName, at: cr.updatedAt.toISOString(), href });
  }

  // --- MRF: raised / released / received (from order-workflow JSON) -------
  // Quotations have no updatedAt and MRFs live in classification JSON, so we scan
  // recent orders (created within ~180 days — the realistic in-flight window) and
  // keep only MRF events whose own date falls in the last-3-days window.
  const orderLookback = new Date(now.getTime() - 180 * 86_400_000);
  const quotes = await prisma.quotation
    .findMany({ where: { createdAt: { gte: orderLookback } }, select: { id: true, quoteNumber: true, classification: true }, take: 600 })
    .catch(() => []);
  for (const q of quotes) {
    let mrfs: ReturnType<typeof readOrderWorkflow>["materialRequests"] = [];
    try {
      mrfs = readOrderWorkflow(q.classification).materialRequests;
    } catch {
      continue;
    }
    for (const m of mrfs) {
      const ref = `MRF ${m.formNo}`;
      const detail = `${m.dept} · ${summarize(m.items)}`.trim();
      const href = `/orders/${q.id}`;
      if (inWin(m.raisedAt)) items.push({ id: `mrf-r-${q.id}-${m.id}`, kind: "MRF", label: "MRF raised", ref, detail, amount: null, who: m.raisedByName, at: m.raisedAt, href });
      if (inWin(m.releasedAt)) items.push({ id: `mrf-x-${q.id}-${m.id}`, kind: "MRF", label: "MRF released", ref, detail, amount: null, who: m.releasedByName || "", at: m.releasedAt!, href });
      if (inWin(m.confirmedAt)) items.push({ id: `mrf-c-${q.id}-${m.id}`, kind: "MRF", label: "MRF received", ref, detail, amount: null, who: m.confirmedByName || "", at: m.confirmedAt!, href });
    }
  }

  // --- Group by Manila day, newest first ---------------------------------
  const todayYmd = manilaYMD(now);
  const yesterdayYmd = manilaYMD(new Date(now.getTime() - 86_400_000));
  const byDay = new Map<string, RecentActivityItem[]>();
  for (const it of items) {
    const ymd = manilaYMD(new Date(it.at));
    if (!byDay.has(ymd)) byDay.set(ymd, []);
    byDay.get(ymd)!.push(it);
  }
  const dayLabel = (ymd: string): string => {
    if (ymd === todayYmd) return "Today";
    if (ymd === yesterdayYmd) return "Yesterday";
    const d = new Date(`${ymd}T00:00:00Z`);
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(d);
  };
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ymd, list]) => ({ ymd, label: dayLabel(ymd), items: list.sort((a, b) => b.at.localeCompare(a.at)) }));
}
