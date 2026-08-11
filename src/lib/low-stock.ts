/**
 * Low / out-of-stock items — active stock at or below its reorder level (or at
 * zero). Mirrors the finance-monitor's `lowStock` computation (same active +
 * alert-go-live scoping) so the Purchaser dashboard and the Accounting / Management
 * dashboards agree. Read-only.
 */
import { prisma } from "@/lib/db";
import { getAlertGoLive, alertGoLiveCreatedAtFilter } from "@/lib/alert-golive";
import type { LowStockRow } from "@/lib/finance-monitor";

export type { LowStockRow };

export async function getLowStock(): Promise<LowStockRow[]> {
  const gate = await getAlertGoLive();
  const cutoff = alertGoLiveCreatedAtFilter(gate);
  const createdFilter = cutoff ? { createdAt: cutoff } : {};
  const items = await prisma.stockItem
    .findMany({
      where: { active: true, ...createdFilter },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unit: true, quantity: true, reorderLevel: true },
    })
    .catch(() => []);
  return items
    .filter((i) => {
      const q = Number(i.quantity);
      const r = Number(i.reorderLevel);
      return q <= 0 || (r > 0 && q <= r);
    })
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit, quantity: Number(i.quantity) }));
}
