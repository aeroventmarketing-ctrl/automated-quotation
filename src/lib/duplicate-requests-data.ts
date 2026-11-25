/**
 * Server side of lib/duplicate-requests: reads the order's MRFs and purchase
 * requests and finds the open requests that ask again for an item.
 */
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { readOrderWorkflow, requisitionDeptLabel, type MaterialRequest } from "@/lib/order-workflow";
import { buildCatalogueSkuIndex } from "@/lib/pr-item-skus";
import { skuFor, type SkuIndex } from "@/lib/item-sku";
import { getAlertGoLive, alertPasses } from "@/lib/alert-golive";
import { duplicateFlagsForOrder, DUP_CLOSED_STATUSES, type DupRequest, type DuplicateHit } from "@/lib/duplicate-requests";

export const DUPLICATE_FLAGS_TAG = "duplicate-flags";

export interface DuplicateFlagView {
  prId: string;
  hits: DuplicateHit[];
}

type OrderPr = DupRequest & { quotationId: string | null };

function flagsWith(orders: { id: string; mrfs: readonly MaterialRequest[] }[], prs: readonly OrderPr[], index: SkuIndex): Record<string, DuplicateHit[]> {
  const byOrder = new Map<string, OrderPr[]>();
  for (const p of prs) if (p.quotationId) (byOrder.get(p.quotationId) ?? byOrder.set(p.quotationId, []).get(p.quotationId)!).push(p);
  const out: Record<string, DuplicateHit[]> = {};
  for (const o of orders) {
    const list = byOrder.get(o.id) ?? [];
    if (list.length === 0) continue;
    const flags = duplicateFlagsForOrder(o.mrfs, list, (d) => skuFor(d, index), (k) => requisitionDeptLabel(k));
    for (const [id, hits] of flags) out[id] = hits;
  }
  return out;
}

/** Nothing to compare: no open request, or only one request on the order. */
function worthChecking(prs: readonly OrderPr[], mrfCount: number): boolean {
  return prs.some((p) => !DUP_CLOSED_STATUSES.has(p.status)) && prs.length + mrfCount > 1;
}

/**
 * Duplicate flags for requests already loaded by a page (the order page, the
 * Purchasing workspace) — no extra read but the SKU index, and that only when
 * an order has something to compare.
 */
export async function duplicateFlagsFor(
  orders: { id: string; mrfs: readonly MaterialRequest[] }[],
  prs: readonly OrderPr[],
): Promise<Record<string, DuplicateHit[]>> {
  const relevant = orders.filter((o) => worthChecking(prs.filter((p) => p.quotationId === o.id), o.mrfs.length));
  if (relevant.length === 0) return {};
  const index = await buildCatalogueSkuIndex();
  return flagsWith(relevant, prs, index);
}

export interface OpenDuplicate {
  prId: string;
  quotationId: string;
  code: string;
  company: string;
  /** When the repeated request was raised (ISO). */
  since: string;
  hits: DuplicateHit[];
}

/**
 * Every open request, on any order, that repeats an item and nobody has marked
 * "Not a duplicate" — for My Dashboard and the alarm. The alarm is polled by
 * every user, so this is cached (and dropped the moment someone confirms).
 */
export const openDuplicates = unstable_cache(
  async (): Promise<OpenDuplicate[]> => {
    const golive = await getAlertGoLive();
    const open = await prisma.purchaseRequest.findMany({
      where: { quotationId: { not: null }, status: { notIn: [...DUP_CLOSED_STATUSES] as never[] } },
      select: { quotationId: true, chainLog: true, createdAt: true },
    });
    const ids = [...new Set(open.filter((p) => alertPasses(p.createdAt, golive)).map((p) => p.quotationId!))];
    if (ids.length === 0) return [];
    const [prs, quotes] = await Promise.all([
      prisma.purchaseRequest.findMany({
        where: { quotationId: { in: ids } },
        select: { id: true, quotationId: true, mrfId: true, dept: true, status: true, createdAt: true, items: true, itemSkus: true, po: true, chainLog: true },
      }),
      prisma.$queryRaw<{ id: string; quoteNumber: string; company: string; mrfs: unknown; createdAt: Date }[]>`
        select q."id", q."quoteNumber", q."createdAt", cu."company",
               q."classification" #> '{workflow,materialRequests}' as "mrfs"
        from "Quotation" q
        join "Inquiry" i on i."id" = q."inquiryId"
        join "Customer" cu on cu."id" = i."customerId"
        where q."id" = any(${ids}::text[])
      `,
    ]);
    const orders = quotes
      .filter((q) => alertPasses(q.createdAt, golive))
      .map((q) => ({ id: q.id, mrfs: readOrderWorkflow({ workflow: { materialRequests: q.mrfs ?? [] } }).materialRequests }));
    const flags = await duplicateFlagsFor(orders, prs.map((p) => ({ ...p, status: String(p.status) })));
    const byId = new Map(quotes.map((q) => [q.id, q]));
    const prById = new Map(prs.map((p) => [p.id, p]));
    const out: OpenDuplicate[] = [];
    for (const [prId, hits] of Object.entries(flags)) {
      const pr = prById.get(prId);
      const q = pr?.quotationId ? byId.get(pr.quotationId) : undefined;
      if (!pr || !q || !alertPasses(pr.createdAt, golive)) continue;
      out.push({ prId, quotationId: q.id, code: q.quoteNumber, company: q.company, since: pr.createdAt.toISOString(), hits });
    }
    return out.sort((a, b) => a.since.localeCompare(b.since));
  },
  ["open-duplicate-requests-v1"],
  { tags: [DUPLICATE_FLAGS_TAG], revalidate: 120 },
);
