/**
 * Server side of lib/awaiting-delivery: bought stock added at Cash & Check
 * Released, held (not usable) until the Warehouseman's Receive & Add Stock.
 */
import type { Prisma } from "@prisma/client";
import { applyStockChange } from "@/lib/inventory";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { OFFICE_DEPT_KEY } from "@/lib/order-workflow";
import { readEarlyReceive } from "@/lib/early-receive";
import { AWAITING_NOTE, DELIVERED_MARK, SHORT_DELIVERY_MARK, awaitingRef, planCashReleaseAdds, planConfirm, remapToHeldRows, holdRequestDepts, poRefOfAwaiting, type CashReleaseMember, type HoldPoRequest } from "@/lib/awaiting-delivery";
import { prisma } from "@/lib/db";
import { poMemberIds } from "@/lib/purchase-batch";

type Tx = Prisma.TransactionClient;

interface PrLike {
  id: string;
  chainLog?: unknown;
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
  // Its goods were already received early (lib/early-receive) — a rollback and
  // Cash & Check Released again must not put them in a second time.
  if (readEarlyReceive(poHolder.chainLog)) return 0;
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
  // Confirmed from the Inventory page before this Receive — already usable
  // stock; it absorbs what arrived instead of being added again.
  const delivered = await tx.stockReservation.findMany({
    where: { forRef: awaitingRef(poRef), active: false, note: { contains: DELIVERED_MARK } },
    select: { id: true, stockItemId: true, qty: true, createdAt: true },
  });
  if (holds.length === 0 && delivered.length === 0) return matches;
  // The same goods on another location's row: cash release filed a Motor /
  // Office line under the Office row, and Receive picked the Plant Warehouse row
  // of the same SKU. That row has no hold, so it would ADD the goods again while
  // the Office hold stayed — the PO counted twice in stock (and in its value).
  // Receive confirms the held row instead.
  const heldIds = [...new Set([...holds, ...delivered].map((h) => h.stockItemId))];
  const strays = [...new Set(matches.map((m) => m.stockItemId))].filter((id) => !heldIds.includes(id));
  if (strays.length) {
    const rows = await tx.stockItem.findMany({ where: { id: { in: [...heldIds, ...strays] } }, select: { id: true, sku: true } });
    matches = remapToHeldRows(matches, heldIds, rows);
  }
  const plan = planConfirm(matches, [
    ...holds.map((h) => ({ ...h, qty: Number(h.qty) })),
    ...delivered.map((h) => ({ ...h, qty: Number(h.qty), confirmed: true })),
  ]);
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

/**
 * For each held line, the departments that requested it (lib/awaiting-delivery
 * `holdRequestDepts`): its PO → the request(s) carrying that PO (with a combined
 * PO's members) → those whose lines carry the item's SKU. Two small reads.
 */
export async function holdDeptsFor(holds: readonly { id: string; forRef: string; stockItemId: string }[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (holds.length === 0) return out;
  const refs = [...new Set(holds.map((h) => poRefOfAwaiting(h.forRef).trim()))];
  type Row = { id: string; dept: string | null; itemSkus: unknown; po: unknown };
  const anchors = await prisma.$queryRaw<(Row & { poNumber: string | null })[]>`
    select "id", "dept", "itemSkus", "po", "po"->>'poNumber' as "poNumber"
    from "PurchaseRequest"
    where "po"->>'poNumber' = any(${refs}::text[]) or "id" = any(${refs}::text[])
  `;
  const memberIds = [...new Set(anchors.flatMap((a) => poMemberIds(a.po)))].filter((id) => !anchors.some((a) => a.id === id));
  const [members, items] = await Promise.all([
    memberIds.length ? prisma.purchaseRequest.findMany({ where: { id: { in: memberIds } }, select: { id: true, dept: true, itemSkus: true } }) : Promise.resolve([] as Row[]),
    prisma.stockItem.findMany({ where: { id: { in: [...new Set(holds.map((h) => h.stockItemId))] } }, select: { id: true, sku: true } }),
  ]);
  const byId = new Map<string, Row>([...anchors, ...members].map((r) => [r.id, r as Row]));
  const req = (r: Row): HoldPoRequest => ({ dept: r.dept, itemSkus: Array.isArray(r.itemSkus) ? (r.itemSkus as unknown[]).map((v) => String(v ?? "")) : [] });
  for (const h of holds) {
    const ref = poRefOfAwaiting(h.forRef).trim();
    const anchor = anchors.find((a) => (a.poNumber ?? "").trim() === ref) ?? anchors.find((a) => a.id === ref);
    if (!anchor) { out.set(h.id, []); continue; }
    const ids = [...new Set([anchor.id, ...poMemberIds(anchor.po)])];
    const prs = ids.map((id) => byId.get(id)).filter((r): r is Row => !!r).map(req);
    out.set(h.id, holdRequestDepts(items.find((i) => i.id === h.stockItemId)?.sku, prs));
  }
  return out;
}
