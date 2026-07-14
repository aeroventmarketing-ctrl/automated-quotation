/**
 * Shared stock-ledger helper used by the Inventory actions and the order workflow
 * (issue-from-stock, receive-into-stock). Applies one movement within a Prisma
 * transaction: updates the item's quantity and appends a StockMovement with the
 * running balance. RECEIPT adds, ISSUE subtracts (never below zero), ADJUSTMENT
 * sets the on-hand to the given quantity.
 */
import type { Prisma } from "@prisma/client";

export type StockKind = "RECEIPT" | "ISSUE" | "ADJUSTMENT";

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
