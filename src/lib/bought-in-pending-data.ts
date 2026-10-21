import { prisma } from "@/lib/db";
import { DEPT_REQUISITION_KIND } from "@/lib/purchasing";
import { boughtInPurchasePending, type BoughtInPurchaseRow } from "@/lib/bought-in-pending";
import type { PendingStep } from "@/lib/order-workflow";
import { isBoughtInOnlyOrder, orderBoughtInLines } from "@/lib/department-pnl";

/**
 * The department requisitions of the given orders, reduced to what
 * `boughtInPurchasePending` reads — one small row each, without pulling the PO
 * or chain-log JSON across the wire. Same department rule as
 * `DEPT_REQUISITION_WHERE` (kind "department", or escalated from an MRF).
 */
export async function boughtInPurchaseRows(quotationIds: string[]): Promise<Map<string, BoughtInPurchaseRow[]>> {
  const out = new Map<string, BoughtInPurchaseRow[]>();
  if (quotationIds.length === 0) return out;
  const rows = await prisma.$queryRaw<(BoughtInPurchaseRow & { quotationId: string })[]>`
    select "quotationId", status::text as status,
           (po is not null and po <> 'null'::jsonb) as "hasPo",
           coalesce("chainLog"->'approve_po'->>'byName', '') <> '' as "poApproved"
      from "PurchaseRequest"
     where "quotationId" = any(${quotationIds})
       and (kind = ${DEPT_REQUISITION_KIND} or "mrfId" is not null)
  `;
  for (const r of rows) {
    const list = out.get(r.quotationId) ?? [];
    list.push({ status: r.status, hasPo: r.hasPo, poApproved: r.poApproved });
    out.set(r.quotationId, list);
  }
  return out;
}

/**
 * For a list of orders, a lookup of who each one's purchase request is waiting
 * on — the last argument `pendingStep` takes. Only orders at "released" are
 * read (that is the only stage `pendingStep` asks it at); one query for all.
 */
export async function boughtInPendingLookup(orders: { id: string; stage: string }[]): Promise<(id: string) => PendingStep | null> {
  const ids = orders.filter((o) => o.stage === "released").map((o) => o.id);
  const rows = await boughtInPurchaseRows(ids);
  return (id) => (rows.has(id) ? boughtInPurchasePending(rows.get(id)!) : null);
}

/** A bought-in order at "For PO creation" whose items nobody has requested yet. */
export interface BoughtInToRequest {
  id: string;
  quoteNumber: string;
  company: string;
  /** "24 unit · Spring Vibration Isolator · Ceiling Mounted …" */
  lines: string[];
}

/**
 * Every bought-in order waiting for the Purchaser's "Request bought-in items" —
 * at "released" (For PO creation), bought-in only, with no live requisition
 * (none, or only cancelled / rejected ones). Same tests `requestBoughtInItems`
 * makes, so the list never offers a button the server would refuse.
 */
export async function boughtInOrdersToRequest(): Promise<BoughtInToRequest[]> {
  const released = await prisma.$queryRaw<{ id: string }[]>`
    select "id" from "Quotation"
     where "classification" #> '{sale,po}' is not null
       and "classification" #>> '{workflow,stage}' = 'released'
  `;
  if (released.length === 0) return [];
  const quotes = await prisma.quotation.findMany({
    where: { id: { in: released.map((r) => r.id) } },
    select: {
      id: true, quoteNumber: true,
      inquiry: { select: { customer: { select: { company: true } } } },
      items: { select: { qty: true, descriptionSnapshot: true, specsSnapshot: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const boughtIn = quotes.filter((q) => isBoughtInOnlyOrder(q.items));
  const reqs = await boughtInPurchaseRows(boughtIn.map((q) => q.id));
  return boughtIn
    .filter((q) => !(reqs.get(q.id) ?? []).some((r) => r.status !== "CANCELLED" && r.status !== "REJECTED"))
    .map((q) => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      company: q.inquiry?.customer?.company ?? "",
      lines: orderBoughtInLines(q.items).map((l) => `${l.qty} unit · ${[l.name, ...l.detail].join(" · ")}`),
    }));
}

/**
 * How many requests the system raised by itself on payment clearing are still
 * awaiting the Payment Approver (no purchase approval, no PO) — what the admin's
 * one-time "Cancel them" would cancel (`cancelAutoRaisedBoughtInRequests`).
 */
export async function autoRaisedAwaitingCount(): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    select count(*) as n from "PurchaseRequest"
     where kind = 'department' and dept = 'office' and status::text = 'APPROVED'
       and note like 'Bought-in items for order%'
       and (po is null or po = 'null'::jsonb)
       and coalesce("chainLog"->'approve_po'->>'byName', '') = ''
  `;
  return Number(row?.n ?? 0);
}
