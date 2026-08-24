/**
 * Shared stock-ledger helper used by the Inventory actions and the order workflow
 * (issue-from-stock, receive-into-stock). Applies one movement within a Prisma
 * transaction: updates the item's quantity and appends a StockMovement with the
 * running balance. RECEIPT adds, ISSUE subtracts (never below zero), ADJUSTMENT
 * sets the on-hand to the given quantity.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type StockKind = "RECEIPT" | "ISSUE" | "ADJUSTMENT";

export interface StockOptWithAvail {
  id: string;
  /** Short scan/item code — the shared key used to match a quoted item to stock. */
  sku: string | null;
  name: string;
  unit: string;
  /** Warehouse location — routes issuing (Plant Warehouse vs Office). */
  location: string | null;
  /** Free to issue right now (on hand − active reservations). */
  available: number;
}

/**
 * Active stock items with what's actually free to issue (on hand − active
 * reservations), the same figure the availability lookup shows. Shared by the
 * MRF / requisition / purchasing stock pickers so a line with nothing available
 * can hide its "Issue" control. Returns [] if the inventory tables aren't set up.
 */
export async function listStockItemsWithAvailability(): Promise<StockOptWithAvail[]> {
  const items = await prisma.stockItem
    .findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, sku: true, name: true, unit: true, quantity: true, location: true } })
    .catch(() => [] as { id: string; sku: string | null; name: string; unit: string; quantity: unknown; location: string | null }[]);
  if (items.length === 0) return [];
  const resv = await prisma.stockReservation
    .groupBy({ by: ["stockItemId"], where: { active: true, stockItemId: { in: items.map((i) => i.id) } }, _sum: { qty: true } })
    .catch(() => [] as { stockItemId: string; _sum: { qty: number | null } }[]);
  const reservedById = new Map(resv.map((r) => [r.stockItemId, Number(r._sum.qty ?? 0)]));
  return items.map((i) => ({
    id: i.id,
    sku: i.sku,
    name: i.name,
    unit: i.unit,
    location: i.location,
    available: Math.round((Number(i.quantity) - (reservedById.get(i.id) ?? 0)) * 1000) / 1000,
  }));
}

export interface StockChange {
  stockItemId: string;
  kind: StockKind;
  qty: number;
  reason?: string;
}

export async function applyStockChange(
  tx: Prisma.TransactionClient,
  change: StockChange,
  byName: string,
): Promise<void> {
  const item = await tx.stockItem.findUnique({ where: { id: change.stockItemId } });
  if (!item) throw new Error("Stock item not found");
  const current = Number(item.quantity);

  let delta: number;
  if (change.kind === "RECEIPT") delta = change.qty;
  else if (change.kind === "ISSUE") {
    if (change.qty > current) throw new Error(`Not enough ${item.name} — only ${current} ${item.unit} on hand.`);
    delta = -change.qty;
  } else {
    delta = change.qty - current;
  }
  const balanceAfter = Math.round((current + delta) * 1000) / 1000;

  await tx.stockItem.update({ where: { id: item.id }, data: { quantity: balanceAfter } });
  await tx.stockMovement.create({
    data: { stockItemId: item.id, kind: change.kind, delta, balanceAfter, reason: change.reason || null, byName },
  });
}
