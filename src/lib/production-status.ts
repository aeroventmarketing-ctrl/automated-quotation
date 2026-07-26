/**
 * Production-deadline status across all confirmed orders currently in the
 * production phase. Each unfinished department job order with a due date is
 * bucketed by how its deadline compares to today (Manila):
 *   - late    : past due (overdue)
 *   - nearDue : due today or within the next few days
 *   - onTime   : comfortably ahead of its deadline
 * Shown on the dashboards so every production/monitoring role can see, at a
 * glance, which orders are on track — and click through to the client.
 */
import { prisma } from "@/lib/db";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";
import { readOrderWorkflow, PRODUCTION_DEPTS, stageIndex } from "@/lib/order-workflow";

export interface ProductionRow {
  orderId: string;
  company: string;
  quoteNumber: string;
  projectName: string;
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

export async function getProductionStatus(): Promise<ProductionStatus> {
  // Today in Manila (PH) so the deadline maths matches the rest of the app.
  const phToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const wonQuotes = await prisma.quotation
    .findMany({
      where: { inquiry: { status: "WON" } },
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
    // Only orders that have entered the production phase (job orders released).
    if (stageIndex(wf.stage) < stageIndex("in_production")) continue;
    for (const d of PRODUCTION_DEPTS) {
      const jo = wf.jobOrders[d.key];
      if (!jo || jo.status === "finished" || !jo.dueAt) continue;
      const days = daysBetween(phToday, jo.dueAt);
      const row: ProductionRow = {
        orderId: q.id,
        company: q.inquiry?.customer?.company ?? "—",
        quoteNumber: q.quoteNumber,
        projectName: q.projectName ?? q.inquiry?.projectName ?? "",
        dept: d.label,
        dueAt: jo.dueAt,
        days,
      };
      if (days < 0) late.push(row);
      else if (days <= NEAR_DUE_DAYS) nearDue.push(row);
      else onTime.push(row);
    }
  }
  const bySoonest = (a: ProductionRow, b: ProductionRow) => a.days - b.days;
  late.sort(bySoonest);
  nearDue.sort(bySoonest);
  onTime.sort(bySoonest);
  return { onTime, nearDue, late };
}
