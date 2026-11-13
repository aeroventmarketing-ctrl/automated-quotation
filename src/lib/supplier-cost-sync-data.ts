/**
 * Server side of lib/supplier-cost-sync: apply a product's supplier price
 * change to the inventory items of the same name, and log each as a price
 * movement ("Supplier price").
 */
import type { Prisma } from "@prisma/client";
import { logPriceChange } from "@/lib/inventory-history-data";
import type { ProductSupplierLink } from "@/lib/products";
import { catalogueNameKey, planStockCost } from "@/lib/supplier-cost-sync";

export interface SupplierCostSyncInput {
  /** The product's names, before and after (a rename still reaches the item). */
  names: string[];
  unit: string;
  before: ProductSupplierLink[];
  after: ProductSupplierLink[];
  /** Who proposed the supplier prices. */
  byName: string;
  /** Who approved them; null when the price owner set them directly. */
  approvedByName: string | null;
}

/** Returns how many inventory items' unit cost changed. */
export async function syncStockCostFromSuppliers(tx: Prisma.TransactionClient, c: SupplierCostSyncInput): Promise<number> {
  const keys = [...new Set(c.names.map(catalogueNameKey).filter(Boolean))];
  if (keys.length === 0) return 0;
  const items = await tx.stockItem.findMany({
    where: { active: true, OR: keys.map((k) => ({ name: { equals: k, mode: "insensitive" as const } })) },
    select: { id: true, name: true, sku: true, unit: true, unitCost: true, sellPrice: true },
  });
  let changed = 0;
  for (const it of items) {
    // `equals` + insensitive doesn't trim; the catalogue join does.
    if (!keys.includes(catalogueNameKey(it.name))) continue;
    const unitCost = Number(it.unitCost);
    const plan = planStockCost({ unit: it.unit, unitCost }, { unit: c.unit }, c.before, c.after);
    if (!plan) continue;
    const newUnitCost = plan.newUnitCost ?? unitCost;
    if (newUnitCost !== unitCost) {
      await tx.stockItem.update({ where: { id: it.id }, data: { unitCost: newUnitCost } });
      changed++;
    }
    await logPriceChange(tx, {
      item: { id: it.id, name: it.name, sku: it.sku },
      before: { unitCost, sellPrice: Number(it.sellPrice) },
      after: { unitCost: newUnitCost, sellPrice: Number(it.sellPrice) },
      source: "supplier",
      byName: c.byName,
      approvedByName: c.approvedByName,
      note: plan.note,
      force: true,
    });
  }
  return changed;
}
