/**
 * Lightweight "new activity" signals for the admin's three dashboards, used to
 * flash the matching nav item. Cheap indexed counts only — this runs in the app
 * layout on every page, so it must stay fast.
 *
 *  - Production Dashboard  → a pending inventory double-handshake approval
 *  - Management Dashboard  → a new cash request awaiting processing
 *  - Sales Dashboard       → a new (unworked) inquiry
 */
import { prisma } from "@/lib/db";
import { getAlertGoLive, alertGoLiveCreatedAtFilter } from "@/lib/alert-golive";

export interface DashboardAlerts {
  production: boolean;
  management: boolean;
  sales: boolean;
}

export async function getDashboardAlerts(): Promise<DashboardAlerts> {
  // Alerts go-live gate: only count items created after the launch moment, so the
  // nav dots stay dark before launch and afterwards flash only for new activity.
  const createdAt = alertGoLiveCreatedAtFilter(await getAlertGoLive());
  const when = createdAt ? { createdAt } : {};
  const [stockPending, newCash, newInquiries] = await Promise.all([
    prisma.stockAction.count({ where: { status: "PENDING", ...when } }).catch(() => 0),
    prisma.cashRequest.count({ where: { status: "SUBMITTED", ...when } }).catch(() => 0),
    prisma.inquiry.count({ where: { status: "NEW", ...when } }).catch(() => 0),
  ]);
  return { production: stockPending > 0, management: newCash > 0, sales: newInquiries > 0 };
}
