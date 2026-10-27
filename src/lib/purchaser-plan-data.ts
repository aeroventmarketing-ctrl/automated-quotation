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
import { readClientDue } from "@/lib/order-client-due";
import type { PRStatus } from "@/lib/purchasing";
import {
  isPlanOpenMrf,
  isPlanType,
  planMrfStatus,
  earliestPurchaseDue,
  receivedOn,
  manilaDay,
  sortPlanRows,
  closedInfo,
  sortClosedRows,
  planClientDue,
  planPoNumbers,
  type PlanPoSource,
  type ClosedPlanRow,
  type PlanPr,
  type PlanEdit,
  type PurchaserPlanRow,
} from "@/lib/purchaser-plan";

export interface PurchaserPlanData {
  rows: PurchaserPlanRow[];
  /** Rejected / cancelled MRFs — their own box, most recently closed first. */
  closed: ClosedPlanRow[];
  /** The plan's table has not been created yet (migration 0060 not applied). */
  tableMissing: boolean;
}

export async function loadPurchaserPlan(): Promise<PurchaserPlanData> {
  let tableMissing = false;
  const [quotes, slim, prs, entries, poRows] = await Promise.all([
    prisma.quotation.findMany({
      where: { classification: { path: ["sale", "po"], not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      select: { id: true, quoteNumber: true, preparedBy: { select: { name: true } } },
    }),
    slimClassificationByOrder(),
    prisma.purchaseRequest.findMany({
      where: { mrfId: { not: null } },
      select: { mrfId: true, status: true, kind: true, chainLog: true, purchaseDueAt: true, receivedAt: true, decidedByName: true, decidedAt: true, decisionNote: true },
    }),
    prisma.purchaserPlanEntry.findMany().catch(() => {
      tableMissing = true;
      return [] as Awaited<ReturnType<typeof prisma.purchaserPlanEntry.findMany>>;
    }),
    // The PO number of each request raised from an MRF — just the number and
    // when it was prepared, picked out of the `po` JSON in SQL rather than
    // shipping the whole PO (lines, supplier, remarks) for one field.
    prisma.$queryRaw<{ id: string; mrfId: string; status: string; poNumber: string | null; poAt: string | null }[]>`
      select "id", "mrfId", "status"::text as "status", "po"->>'poNumber' as "poNumber", "po"->>'createdAt' as "poAt"
      from "PurchaseRequest"
      where "mrfId" is not null and "po" ->> 'poNumber' is not null
    `.catch(() => []),
  ]);
  const posByMrf = new Map<string, PlanPoSource[]>();
  for (const r of poRows) {
    const arr = posByMrf.get(r.mrfId) ?? [];
    arr.push({ prId: r.id, status: r.status, poNumber: r.poNumber, poAt: r.poAt });
    posByMrf.set(r.mrfId, arr);
  }
  // The edit trail, newest first. Only rows that have an entry can have edits,
  // so the read is scoped to those — usually a handful.
  const edited = entries.map((e) => e.mrfId);
  const edits = edited.length
    ? await prisma.purchaserPlanEdit
        .findMany({ where: { mrfId: { in: edited } }, orderBy: { at: "desc" } })
        .catch(() => [] as Awaited<ReturnType<typeof prisma.purchaserPlanEdit.findMany>>)
    : [];
  const editsByMrf = new Map<string, PlanEdit[]>();
  for (const e of edits) {
    if (e.field !== "type" && e.field !== "clientDue") continue;
    const arr = editsByMrf.get(e.mrfId) ?? [];
    arr.push({ field: e.field, from: e.fromValue, to: e.toValue, byName: e.byName, at: e.at.toISOString() });
    editsByMrf.set(e.mrfId, arr);
  }

  const prsByMrf = new Map<string, PlanPr[]>();
  for (const p of prs) {
    if (!p.mrfId) continue;
    const arr = prsByMrf.get(p.mrfId) ?? [];
    arr.push({ ...p, status: p.status as PRStatus });
    prsByMrf.set(p.mrfId, arr);
  }
  const entryByMrf = new Map(entries.map((e) => [e.mrfId, e] as const));

  const rows: PurchaserPlanRow[] = [];
  const closed: ClosedPlanRow[] = [];
  for (const row of quotes) {
    const q = withSlimClassification(row, slim);
    const sale = saleFromClassification(q.classification);
    // "Paid quotations" — the same gate every order screen uses.
    if (!sale || !isSaleConfirmed(sale)) continue;
    const wf = readOrderWorkflow(q.classification);
    const orderedDate = manilaDay(saleRecognitionDate(sale));
    // The order's client due date — set in its Phase 1 box, shown on every MRF row.
    const orderDue = readClientDue(q.classification);
    for (const m of wf.materialRequests) {
      const mine = prsByMrf.get(m.id) ?? [];
      // Rejected / cancelled → the box below the plan, not the plan itself.
      const shut = closedInfo(m, mine);
      if (shut) {
        closed.push({
          ...shut,
          key: `${q.id}:${m.id}`,
          quotationId: q.id,
          mrfId: m.id,
          orderNo: q.quoteNumber,
          orderHref: `/orders/${q.id}`,
          mrfHref: `/orders/${q.id}#mrf-${m.id}`,
          orderedDate,
          accountHolder: q.preparedBy?.name ?? "—",
          poNumbers: planPoNumbers(posByMrf.get(m.id) ?? [], { includeClosed: true }),
          mrfNo: m.formNo,
        });
        continue;
      }
      if (!isPlanOpenMrf(m.status)) continue;
      const e = entryByMrf.get(m.id);
      const allEdits = editsByMrf.get(m.id) ?? [];
      const due = planClientDue(
        orderDue,
        e ? { date: e.clientDueDate ?? null, byName: e.clientDueByName ?? null, at: e.clientDueAt ? e.clientDueAt.toISOString() : null } : null,
        allEdits,
      );
      rows.push({
        key: `${q.id}:${m.id}`,
        quotationId: q.id,
        mrfId: m.id,
        orderNo: q.quoteNumber,
        // The owner: Order no. "should be redirected to the workflow of the order
        // number"; MRF no. "redirected to specific MRF" — that MRF's card in the
        // order's Phase 3 · Materials, not the printable form.
        orderHref: `/orders/${q.id}`,
        mrfHref: `/orders/${q.id}#mrf-${m.id}`,
        orderedDate,
        accountHolder: q.preparedBy?.name ?? "—",
        poNumbers: planPoNumbers(posByMrf.get(m.id) ?? []),
        mrfNo: m.formNo,
        mrfStatus: planMrfStatus(m.status, mine),
        purchaseDue: earliestPurchaseDue(mine),
        receivedOn: receivedOn(mine),
        type: e && isPlanType(e.type) ? e.type : null,
        typeByName: e?.typeByName ?? null,
        typeAt: e?.typeAt ? e.typeAt.toISOString() : null,
        clientDue: due.clientDue,
        clientDueByName: due.clientDueByName,
        clientDueAt: due.clientDueAt,
        clientDueFromOrder: due.clientDueFromOrder,
        // Type's trail as it was; the client due date's from the order (+ the plan's older lines).
        edits: [...allEdits.filter((x) => x.field === "type"), ...due.edits],
      });
    }
  }
  return { rows: sortPlanRows(rows), closed: sortClosedRows(closed), tableMissing };
}
