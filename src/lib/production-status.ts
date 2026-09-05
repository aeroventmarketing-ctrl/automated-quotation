/**
 * Production-deadline status across all confirmed orders currently in the
 * production phase. Each unfinished department job order with a due date is
 * bucketed by how its deadline compares to today (Manila):
 *   - late    : past due (overdue)
 *   - nearDue : due today or within the next few days
 *   - onTime   : comfortably ahead of its deadline
 * Shown on the dashboards so every production/monitoring role can see, at a
 * glance, which orders are on track — and click through to the client.
 *
 * An order leaves the list when it is DELIVERED, whatever its job orders say.
 */
import { prisma } from "@/lib/db";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";
import { readOrderWorkflow, PRODUCTION_DEPTS, stageIndex, type OrderStage, type OrderWorkflow } from "@/lib/order-workflow";

/** The order's identity as the card shows it. */
export interface ProductionOrderRef {
  orderId: string;
  company: string;
  quoteNumber: string;
  projectName: string;
}

export interface ProductionRow extends ProductionOrderRef {
  dept: string; // department label
  dueAt: string; // YYYY-MM-DD
  days: number; // due − today; negative = overdue
}

export interface ProductionStatus {
  onTime: ProductionRow[];
  nearDue: ProductionRow[];
  late: ProductionRow[];
}

/** A job order is "near due" when it falls due today or within this many days. */
const NEAR_DUE_DAYS = 3;

/** Whole-day difference (target − reference), both YYYY-MM-DD. Negative = past. */
function daysBetween(fromYMD: string, toYMD: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(toYMD) - p(fromYMD)) / 86_400_000);
}

/**
 * Is this order's production still worth watching?
 *
 * It opens when the job orders are released and **closes the moment the order is
 * delivered** — the owner: *"Once item is delivered remove it from the list."*
 *
 * A department that never stamped its job order "finished" used to keep a row
 * here for good, so an order the client already has kept accruing "37d overdue"
 * beside orders still on the shop floor. Delivery is the fact that settles it: a
 * deadline for goods that have gone out is not a deadline any more, and a list
 * that shows it teaches the eye to skip the ones that matter.
 *
 * Both delivery modes land here. The single-batch flow stamps `delivered`; a
 * multiple-batch order reaches the same stage only once EVERY item has been
 * delivered, so a part-delivered order stays on the list — production still owes
 * the rest.
 */
export function isLiveProduction(stage: OrderStage): boolean {
  return stageIndex(stage) >= stageIndex("in_production") && stageIndex(stage) < stageIndex("delivered");
}

/**
 * The rows one order contributes — one per department still owing work against a
 * deadline. Empty for an order that has been delivered, has not reached
 * production, or whose job orders are all finished or undated.
 */
export function productionRowsForOrder(ref: ProductionOrderRef, wf: OrderWorkflow, todayYMD: string): ProductionRow[] {
  if (!isLiveProduction(wf.stage)) return [];
  return PRODUCTION_DEPTS.flatMap((d) => {
    const jo = wf.jobOrders[d.key];
    if (!jo || jo.status === "finished" || !jo.dueAt) return [];
    return [{ ...ref, dept: d.label, dueAt: jo.dueAt, days: daysBetween(todayYMD, jo.dueAt) }];
  });
}

export async function getProductionStatus(): Promise<ProductionStatus> {
  // Today in Manila (PH) so the deadline maths matches the rest of the app.
  const phToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  // Source from confirmed sales — NOT inquiry.status === "WON". A quotation
  // revision reopens the inquiry (status leaves WON), so a WON filter drops
  // confirmed orders that are still in production. isSaleConfirmed below is the
  // real gate, exactly as the departmental P&L does it.
  const wonQuotes = await prisma.quotation
    .findMany({
      select: {
        id: true,
        classification: true,
        quoteNumber: true,
        projectName: true,
        inquiry: { select: { projectName: true, customer: { select: { company: true } } } },
      },
    })
    .catch(() => []);

  const onTime: ProductionRow[] = [];
  const nearDue: ProductionRow[] = [];
  const late: ProductionRow[] = [];

  for (const q of wonQuotes) {
    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;
    const wf = readOrderWorkflow(q.classification);
    const ref: ProductionOrderRef = {
      orderId: q.id,
      company: q.inquiry?.customer?.company ?? "—",
      quoteNumber: q.quoteNumber,
      projectName: q.projectName ?? q.inquiry?.projectName ?? "",
    };
    for (const row of productionRowsForOrder(ref, wf, phToday)) {
      if (row.days < 0) late.push(row);
      else if (row.days <= NEAR_DUE_DAYS) nearDue.push(row);
      else onTime.push(row);
    }
  }
  const bySoonest = (a: ProductionRow, b: ProductionRow) => a.days - b.days;
  late.sort(bySoonest);
  nearDue.sort(bySoonest);
  onTime.sort(bySoonest);
  return { onTime, nearDue, late };
}
