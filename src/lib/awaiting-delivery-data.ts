/**
 * Server side of lib/awaiting-delivery: bought stock added at Cash & Check
 * Released, held (not usable) until the Warehouseman's Receive & Add Stock.
 */
import type { Prisma } from "@prisma/client";
import { applyStockChange } from "@/lib/inventory";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { OFFICE_DEPT_KEY } from "@/lib/order-workflow";
import { AWAITING_NOTE, SHORT_DELIVERY_MARK, awaitingRef, planCashReleaseAdds, planConfirm, type CashReleaseMember } from "@/lib/awaiting-delivery";

type Tx = Prisma.TransactionClient;

interface PrLike {
  id: string;
  kind?: string | null;
  dept: string | null;
  quotationId: string | null;
  items: unknown;
  itemSkus?: unknown;
  po: unknown;
}

/** The PO a request's holds are filed under: its PO number, else the request id. */
export function poRefOf(pr: { id: string; po: unknown }): string {
  return coercePurchaseOrder(pr.po)?.poNumber?.trim() || pr.id;
}

function memberOf(pr: PrLike): CashReleaseMember {
  return {
    items: Array.isArray(pr.items) ? (pr.items as unknown[]).map((v) => String(v ?? "")) : [],
    skus: Array.isArray(pr.itemSkus) ? (pr.itemSkus as unknown[]).map((v) => String(v ?? "")) : [],
    dept: pr.dept,
    // An Office bought-in requisition linked to an order goes straight to the
    // client — it is never received into stock (`advancePurchaseRequest` "check").
    skip: pr.kind === "department" && pr.dept === OFFICE_DEPT_KEY && !!pr.quotationId,
  };
}

/**
 * Cash & Check Released: put the PO's lines into stock, held. `poHolder` is the
 * request carrying the PO (the anchor of a combined PO); `members` are the
 * requests it buys for. Returns how many items were added.
 */
export async function addAwaitingAtCashRelease(tx: Tx, poHolder: PrLike, members: PrLike[], byName: string): Promise<number> {
  const po = coercePurchaseOrder(poHolder.po);
  if (!po || po.lines.length === 0) return 0;
  const ref = poRefOf(poHolder);
  // Pressed twice (a rollback and forward again) — never add the same PO twice.
  const already = await tx.stockReservation.count({ where: { forRef: awaitingRef(ref), active: true } });
  if (already > 0) return 0;
  const stock = await tx.stockItem.findMany({ where: { active: true, sku: { not: null } }, select: { id: true, sku: true, unit: true, location: true } });
  const plan = planCashReleaseAdds(po.lines, members.map(memberOf), stock);
  for (const a of plan) {
    await applyStockChange(tx, { stockItemId: a.stockItemId, kind: "RECEIPT", qty: a.qty, reason: `Bought — ${ref} (Cash & Check Released) · not usable until Receive & Add Stock` }, byName);
    await tx.stockReservation.create({ data: { stockItemId: a.stockItemId, qty: a.qty, forRef: awaitingRef(ref), note: AWAITING_NOTE, byName } });
  }
  return plan.length;
}

/**
 * Receive & Add Stock against a PO that was added at cash release: confirm the
 * holds with what arrived, and return only what still has to be ADDED (the rest
 * is already in stock). With no holds — a PO from before this, or one whose lines
 * matched no item — it returns the matches unchanged and Receive works as before.
 */
export async function confirmAwaitingOnReceive(
  tx: Tx,
  poRef: string,
  matches: { stockItemId: string; qty: number }[],
  byName: string,
): Promise<{ stockItemId: string; qty: number }[]> {
  const holds = await tx.stockReservation.findMany({
    where: { forRef: awaitingRef(poRef), active: true },
    select: { id: true, stockItemId: true, qty: true, createdAt: true, note: true },
  });
  if (holds.length === 0) return matches;
  const plan = planConfirm(matches, holds.map((h) => ({ ...h, qty: Number(h.qty) })));
  const now = new Date();
  if (plan.release.length) {
    await tx.stockReservation.updateMany({ where: { id: { in: plan.release } }, data: { active: false, releasedByName: byName, releasedAt: now } });
  }
  const day = now.toISOString().slice(0, 10);
  for (const r of plan.reduce) {
    const h = holds.find((x) => x.id === r.id)!;
    const got = Math.round((Number(h.qty) - r.to) * 1000) / 1000;
    await tx.stockReservation.update({
      where: { id: r.id },
      data: { qty: r.to, note: `${h.note ?? AWAITING_NOTE} · ${SHORT_DELIVERY_MARK} ${got} received by ${byName} on ${day}; ${r.to} still to arrive.` },
    });
  }
  return plan.adds;
}

/**
 * Take a PO's held stock back out — the purchase was rolled back to before cash
 * release, cancelled or deleted, so the goods are not coming. Only what is still
 * held: anything the Warehouseman already confirmed is real stock and stays.
 */
export async function reverseAwaiting(tx: Tx, poRef: string, byName: string, why: string): Promise<number> {
  const holds = await tx.stockReservation.findMany({ where: { forRef: awaitingRef(poRef), active: true }, select: { id: true, stockItemId: true, qty: true } });
  const now = new Date();
  for (const h of holds) {
    // Release first: the issue guard counts held stock, and this IS that stock.
    await tx.stockReservation.update({ where: { id: h.id }, data: { active: false, releasedByName: byName, releasedAt: now } });
    const item = await tx.stockItem.findUnique({ where: { id: h.stockItemId }, select: { quantity: true } });
    const qty = Math.min(Number(h.qty), Number(item?.quantity ?? 0));
    if (qty > 0) await applyStockChange(tx, { stockItemId: h.stockItemId, kind: "ISSUE", qty, reason: `${poRef} ${why} — bought stock taken back out (never confirmed by the Warehouseman)` }, byName);
  }
  return holds.length;
}

