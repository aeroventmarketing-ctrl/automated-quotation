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

export interface DashboardAlerts {
  production: boolean;
  management: boolean;
  sales: boolean;
}

export async function getDashboardAlerts(): Promise<DashboardAlerts> {
  const [stockPending, newCash, newInquiries] = await Promise.all([
    prisma.stockAction.count({ where: { status: "PENDING" } }).catch(() => 0),
    prisma.cashRequest.count({ where: { status: "SUBMITTED" } }).catch(() => 0),
    prisma.inquiry.count({ where: { status: "NEW" } }).catch(() => 0),
  ]);
  return { production: stockPending > 0, management: newCash > 0, sales: newInquiries > 0 };
}
