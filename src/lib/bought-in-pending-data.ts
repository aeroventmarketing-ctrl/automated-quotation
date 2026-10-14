import { prisma } from "@/lib/db";
import { DEPT_REQUISITION_KIND } from "@/lib/purchasing";
import { boughtInPurchasePending, type BoughtInPurchaseRow } from "@/lib/bought-in-pending";
import type { PendingStep } from "@/lib/order-workflow";

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
