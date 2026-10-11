/**
 * The Purchaser Plan's read. Server-only.
 *
 * Three reads, all narrow:
 *  - the paid orders — the same `sale.po`-filtered query My Dashboard uses, with
 *    the same slimmed `classification` (the revision snapshots never leave
 *    Postgres), so the plan adds no new fingerprint to the egress picture;
 *  - the purchase requests raised from MRFs — five columns, for status and due;
 *  - the plan's own entries — Type / Client due date, with who and when.
 *
 * Nothing on a row is copied from anywhere: it is rebuilt from the order and its
 * requests on every load, so a status or a due date changed in Purchasing is on
 * the plan the next time it is opened.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";
import { saleRecognitionDate } from "@/lib/department-pnl";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { slimClassificationByOrder, withSlimClassification } from "@/lib/slim-classification";
import type { PRStatus } from "@/lib/purchasing";
import {
  isPlanOpenMrf,
  isPlanType,
  planMrfStatus,
  earliestPurchaseDue,
  manilaDay,
  sortPlanRows,
  type PlanPr,
  type PurchaserPlanRow,
} from "@/lib/purchaser-plan";

export interface PurchaserPlanData {
  rows: PurchaserPlanRow[];
  /** The plan's table has not been created yet (migration 0060 not applied). */
  tableMissing: boolean;
}

export async function loadPurchaserPlan(): Promise<PurchaserPlanData> {
  let tableMissing = false;
  const [quotes, slim, prs, entries] = await Promise.all([
    prisma.quotation.findMany({
      where: { classification: { path: ["sale", "po"], not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      select: { id: true, quoteNumber: true, preparedBy: { select: { name: true } } },
    }),
    slimClassificationByOrder(),
    prisma.purchaseRequest.findMany({
      where: { mrfId: { not: null } },
      select: { mrfId: true, status: true, kind: true, chainLog: true, purchaseDueAt: true },
    }),
    prisma.purchaserPlanEntry.findMany().catch(() => {
      tableMissing = true;
      return [] as Awaited<ReturnType<typeof prisma.purchaserPlanEntry.findMany>>;
    }),
  ]);

  const prsByMrf = new Map<string, PlanPr[]>();
  for (const p of prs) {
    if (!p.mrfId) continue;
    const arr = prsByMrf.get(p.mrfId) ?? [];
    arr.push({ ...p, status: p.status as PRStatus });
    prsByMrf.set(p.mrfId, arr);
  }
  const entryByMrf = new Map(entries.map((e) => [e.mrfId, e] as const));

  const rows: PurchaserPlanRow[] = [];
  for (const row of quotes) {
    const q = withSlimClassification(row, slim);
    const sale = saleFromClassification(q.classification);
    // "Paid quotations" — the same gate every order screen uses.
    if (!sale || !isSaleConfirmed(sale)) continue;
    const wf = readOrderWorkflow(q.classification);
    const orderedDate = manilaDay(saleRecognitionDate(sale));
    for (const m of wf.materialRequests) {
      if (!isPlanOpenMrf(m.status)) continue;
      const mine = prsByMrf.get(m.id) ?? [];
      const e = entryByMrf.get(m.id);
      rows.push({
        key: `${q.id}:${m.id}`,
        quotationId: q.id,
        mrfId: m.id,
        orderNo: q.quoteNumber,
        href: `/orders/${q.id}/mrf/${m.id}`,
        orderedDate,
        accountHolder: q.preparedBy?.name ?? "—",
        mrfNo: m.formNo,
        mrfStatus: planMrfStatus(m.status, mine),
        purchaseDue: earliestPurchaseDue(mine),
        type: e && isPlanType(e.type) ? e.type : null,
        typeByName: e?.typeByName ?? null,
        typeAt: e?.typeAt ? e.typeAt.toISOString() : null,
        clientDue: e?.clientDueDate ?? null,
        clientDueByName: e?.clientDueByName ?? null,
        clientDueAt: e?.clientDueAt ? e.clientDueAt.toISOString() : null,
      });
    }
  }
  return { rows: sortPlanRows(rows), tableMissing };
}

/** How many rows the plan has — for the dashboard tile. Same rule, no entries read. */
export function countOpenPlanMrfs(materialRequests: readonly { status: string }[]): number {
  return materialRequests.filter((m) => isPlanOpenMrf(m.status)).length;
}
