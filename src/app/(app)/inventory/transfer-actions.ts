"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { isProductionHead, isPurchaserRole, coerceStockDoc, isOfficeTransfer, type StockDoc } from "@/lib/stock-transfer";
import { logActivity } from "@/lib/activity-log";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function requireInventoryManager(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isAdmin(user)) return user;
  const roles = await getWorkflowRoles();
  const ok =
    userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, "plant_manager" as WorkflowRoleKey);
  if (!ok) throw new Error("Only the Warehouse, Plant Manager, or an admin can manage transfers.");
  return user;
}

/** Anyone involved in a transfer — inventory managers or the receiving parties. */
async function requireTransferParty(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isAdmin(user)) return user;
  const roles = await getWorkflowRoles();
  const ok =
    userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, "plant_manager" as WorkflowRoleKey) ||
    isProductionHead(roles, user.id) ||
    isPurchaserRole(roles, user.id);
  if (!ok) throw new Error("You can't act on stock transfers.");
  return user;
}

async function nextSku(tx: Prisma.TransactionClient): Promise<string> {
  const KEY = "sku_counter";
  const row = await tx.appSetting.findUnique({ where: { key: KEY } });
  const cur = typeof (row?.value as { n?: unknown } | null)?.n === "number" ? (row!.value as { n: number }).n : 10000;
  const n = cur + 1;
  await tx.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: { n } as Prisma.InputJsonValue }, update: { value: { n } as Prisma.InputJsonValue } });
  return String(n);
}

const initiateSchema = z.object({
  stockItemId: z.string().min(1),
  qty: z.number().positive(),
  toLocation: z.string().trim().min(1),
  note: z.string().trim().max(200).optional(),
});

/**
 * Send a quantity to another location. The stock is issued from the source (in
 * transit) and a transfer record opens, awaiting the production head's and the
 * purchaser's receipt confirmations. Reserved stock can't be sent.
 */
export async function initiateTransfer(input: z.infer<typeof initiateSchema>): Promise<void> {
  const user = await requireInventoryManager();
  const d = initiateSchema.parse(input);
  let transferInfo: { name: string; unit: string; from: string; to: string } | null = null;
  await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.findUnique({ where: { id: d.stockItemId } });
    if (!item) throw new Error("Stock item not found");
    const fromLocation = item.location?.trim() || "—";
    const toLocation = d.toLocation.trim();
    if (toLocation.toLowerCase() === fromLocation.toLowerCase()) throw new Error("Choose a different destination location.");
    if (isOfficeTransfer(toLocation)) throw new Error("Use the Office transfer request flow (Purchaser) for Office transfers.");

    const onHand = Number(item.quantity);
    const agg = await tx.stockReservation.aggregate({ where: { stockItemId: item.id, active: true }, _sum: { qty: true } });
    const reserved = Number(agg._sum.qty ?? 0);
    const available = onHand - reserved;
    if (d.qty > available) throw new Error(`Only ${available} ${item.unit} available to transfer${reserved > 0 ? " (the rest is reserved)" : ""}.`);

    const srcBalance = round3(onHand - d.qty);
    await tx.stockItem.update({ where: { id: item.id }, data: { quantity: srcBalance } });
    await tx.stockMovement.create({
      data: { stockItemId: item.id, kind: "ISSUE", delta: -d.qty, balanceAfter: srcBalance, reason: `Transfer to ${toLocation} (in transit)${d.note ? ` · ${d.note}` : ""}`, byName: user.name },
    });
    await tx.stockTransfer.create({
      data: { stockItemId: item.id, itemName: item.name, unit: item.unit, qty: d.qty, fromLocation, toLocation, note: d.note || null, initiatedById: user.id, initiatedByName: user.name },
    });
    transferInfo = { name: item.name, unit: item.unit, from: fromLocation, to: toLocation };
  });
  if (transferInfo) {
    const info = transferInfo as { name: string; unit: string; from: string; to: string };
    await logActivity(user, {
      action: "inventory.transfer.initiate",
      category: "inventory",
      summary: `Stock transfer started: ${d.qty} ${info.unit} ${info.name} (${info.from} → ${info.to})`,
      entity: "inventory",
      href: "/inventory",
    });
  }
  revalidatePath("/inventory");
}

/**
 * Confirm receipt on one side of the handshake. When both the production head
 * and the purchaser have confirmed, the quantity is received into the
 * destination (merging into an existing same-name record there, or a new one).
 */
export async function confirmTransferReceipt(transferId: string, slot: "prod_head" | "purchaser"): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const admin = isAdmin(user);
  if (slot === "prod_head" && !(admin || isProductionHead(roles, user.id))) throw new Error("Only a production head can confirm this side.");
  if (slot === "purchaser" && !(admin || isPurchaserRole(roles, user.id))) throw new Error("Only the purchaser can confirm this side.");

  let confirmInfo: { name: string; received: boolean } | null = null;
  await prisma.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findUnique({ where: { id: transferId } });
    if (!t) throw new Error("Transfer not found");
    if (t.status !== "IN_TRANSIT") throw new Error("This transfer is not awaiting receipt.");
    const now = new Date();
    const data: Prisma.StockTransferUpdateInput = {};
    if (slot === "prod_head") {
      if (t.prodHeadById) throw new Error("A production head already confirmed this.");
      data.prodHeadById = user.id; data.prodHeadByName = user.name; data.prodHeadAt = now;
    } else {
      if (t.purchaserById) throw new Error("The purchaser already confirmed this.");
      data.purchaserById = user.id; data.purchaserByName = user.name; data.purchaserAt = now;
    }
    const bothConfirmed = (slot === "prod_head" || !!t.prodHeadById) && (slot === "purchaser" || !!t.purchaserById);
    if (bothConfirmed) {
      const qty = Number(t.qty);
      const dest = await tx.stockItem.findFirst({
        where: { active: true, name: { equals: t.itemName, mode: "insensitive" }, location: { equals: t.toLocation, mode: "insensitive" } },
      });
      let destId: string;
      if (dest) {
        const bal = round3(Number(dest.quantity) + qty);
        await tx.stockItem.update({ where: { id: dest.id }, data: { quantity: bal } });
        await tx.stockMovement.create({ data: { stockItemId: dest.id, kind: "RECEIPT", delta: qty, balanceAfter: bal, reason: `Transfer received from ${t.fromLocation}`, byName: user.name } });
        destId = dest.id;
      } else {
        const src = t.stockItemId ? await tx.stockItem.findUnique({ where: { id: t.stockItemId } }) : null;
        const sku = await nextSku(tx);
        const created = await tx.stockItem.create({
          data: { sku, name: t.itemName, unit: t.unit, category: src?.category ?? null, location: t.toLocation, quantity: qty, reorderLevel: src?.reorderLevel ?? 0, unitCost: src?.unitCost ?? 0 },
        });
        await tx.stockMovement.create({ data: { stockItemId: created.id, kind: "RECEIPT", delta: qty, balanceAfter: qty, reason: `Transfer received from ${t.fromLocation}`, byName: user.name } });
        destId = created.id;
      }
      data.destStockItemId = destId; data.status = "RECEIVED"; data.receivedAt = now;
    }
    await tx.stockTransfer.update({ where: { id: transferId }, data });
    confirmInfo = { name: t.itemName, received: bothConfirmed };
  });
  if (confirmInfo) {
    const info = confirmInfo as { name: string; received: boolean };
    await logActivity(user, {
      action: info.received ? "inventory.transfer.received" : "inventory.transfer.confirm",
      category: "inventory",
      summary: info.received
        ? `Stock transfer received into stock: ${info.name}`
        : `Stock transfer confirmed (${slot === "prod_head" ? "production head" : "purchaser"}): ${info.name}`,
      entity: "inventory",
      href: "/inventory",
    });
  }
  revalidatePath("/inventory");
}

/** Recall an in-transit transfer — the quantity returns to the source. */
export async function cancelTransfer(transferId: string): Promise<void> {
  const user = await requireInventoryManager();
  let cancelName = "";
  await prisma.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findUnique({ where: { id: transferId } });
    if (!t) throw new Error("Transfer not found");
    // Stock has left the source once IN_TRANSIT (2-party) or RELEASED/DELIVERING
    // (Office chain) — cancelling returns it. REQUESTED/APPROVED hold no stock yet.
    const returnsStock = t.status === "IN_TRANSIT" || t.status === "RELEASED" || t.status === "DELIVERING";
    if (!(returnsStock || t.status === "REQUESTED" || t.status === "APPROVED")) {
      throw new Error("Only a pending or in-transit transfer can be cancelled.");
    }
    cancelName = t.itemName;
    if (returnsStock && t.stockItemId) {
      const src = await tx.stockItem.findUnique({ where: { id: t.stockItemId } });
      if (src) {
        const bal = round3(Number(src.quantity) + Number(t.qty));
        await tx.stockItem.update({ where: { id: src.id }, data: { quantity: bal } });
        await tx.stockMovement.create({ data: { stockItemId: src.id, kind: "RECEIPT", delta: Number(t.qty), balanceAfter: bal, reason: `Transfer to ${t.toLocation} cancelled — returned`, byName: user.name } });
      }
    }
    await tx.stockTransfer.update({ where: { id: transferId }, data: { status: "CANCELLED", cancelledByName: user.name, cancelledAt: new Date() } });
  });
  await logActivity(user, {
    action: "inventory.transfer.cancel",
    category: "inventory",
    summary: `Stock transfer cancelled${cancelName ? `: ${cancelName}` : ""}`,
    entity: "inventory",
    href: "/inventory",
  });
  revalidatePath("/inventory");
}

// ───────────────────────── Office chain (Fans → Office) ─────────────────────────
// A 5-step approval flow for stock the Office resells: purchaser requests → Plant
// Manager approves → Warehouse releases (deducts source) → Logistics delivers →
// Sales confirms Office receipt (credits the Office stock item). No P&L on the
// move — Fans is credited its production cost at the eventual resale.

const requestOfficeSchema = z.object({
  items: z.array(z.object({ stockItemId: z.string().min(1), qty: z.number().positive() })).min(1),
  note: z.string().trim().max(200).optional(),
});

/** Purchaser requests a transfer of one or more items to the Office — each item
 *  becomes its own request row that runs the chain independently. No stock moves
 *  until the Warehouse releases each. */
export async function requestOfficeTransfer(input: z.infer<typeof requestOfficeSchema>): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  if (!(isAdmin(user) || isPurchaserRole(roles, user.id))) {
    throw new Error("Only the Purchaser or an admin can request a transfer to the Office.");
  }
  const d = requestOfficeSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    for (const line of d.items) {
      const item = await tx.stockItem.findUnique({ where: { id: line.stockItemId } });
      if (!item) throw new Error("Stock item not found");
      const fromLocation = item.location?.trim() || "—";
      if (fromLocation.toLowerCase() === "office") throw new Error(`${item.name} is already at the Office.`);
      await tx.stockTransfer.create({
        data: {
          stockItemId: item.id, itemName: item.name, unit: item.unit, qty: line.qty,
          fromLocation, toLocation: "Office", status: "REQUESTED",
          note: d.note || null, initiatedById: user.id, initiatedByName: user.name,
        },
      });
    }
  });
  await logActivity(user, {
    action: "inventory.transfer.request", category: "inventory",
    summary: `Office transfer requested: ${d.items.length} item${d.items.length === 1 ? "" : "s"} → Office`,
    entity: "inventory", href: "/inventory",
  });
  revalidatePath("/inventory");
}

/** Admin: permanently delete a CANCELLED transfer record (clean-up only). */
export async function deleteTransfer(transferId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can delete a transfer record.");
  const t = await prisma.stockTransfer.findUnique({ where: { id: transferId } });
  if (!t) return;
  if (t.status !== "CANCELLED") throw new Error("Only a cancelled transfer can be deleted.");
  await prisma.stockTransfer.delete({ where: { id: transferId } });
  await logActivity(user, { action: "inventory.transfer.delete", category: "inventory", summary: `Deleted cancelled transfer: ${t.itemName}`, entity: "inventory", href: "/inventory" });
  revalidatePath("/inventory");
}

/** Plant Manager approves the requested Office transfer. */
export async function approveOfficeTransfer(transferId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  if (!(isAdmin(user) || userHasWorkflowRole(roles, user.id, "plant_manager" as WorkflowRoleKey))) {
    throw new Error("Only the Plant Manager or an admin can approve the transfer.");
  }
  const t = await prisma.stockTransfer.findUnique({ where: { id: transferId } });
  if (!t) throw new Error("Transfer not found");
  if (t.status !== "REQUESTED") throw new Error("This transfer isn't awaiting approval.");
  await prisma.stockTransfer.update({ where: { id: transferId }, data: { status: "APPROVED", approvedById: user.id, approvedByName: user.name, approvedAt: new Date() } });
  await logActivity(user, { action: "inventory.transfer.approve", category: "inventory", summary: `Office transfer approved: ${t.itemName}`, entity: "inventory", href: "/inventory" });
  revalidatePath("/inventory");
}

/** Warehouse releases the approved transfer — the source stock is deducted (in transit). */
export async function releaseOfficeTransfer(transferId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  if (!(isAdmin(user) || userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey))) {
    throw new Error("Only the Warehouse or an admin can release the stock.");
  }
  let name = "";
  await prisma.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findUnique({ where: { id: transferId } });
    if (!t) throw new Error("Transfer not found");
    if (t.status !== "APPROVED") throw new Error("This transfer isn't approved for release.");
    if (!t.stockItemId) throw new Error("The source stock item is missing.");
    const item = await tx.stockItem.findUnique({ where: { id: t.stockItemId } });
    if (!item) throw new Error("Source stock item not found.");
    const onHand = Number(item.quantity);
    const agg = await tx.stockReservation.aggregate({ where: { stockItemId: item.id, active: true }, _sum: { qty: true } });
    const available = onHand - Number(agg._sum.qty ?? 0);
    const qty = Number(t.qty);
    if (qty > available) throw new Error(`Only ${available} ${item.unit} available to release.`);
    const bal = round3(onHand - qty);
    await tx.stockItem.update({ where: { id: item.id }, data: { quantity: bal } });
    await tx.stockMovement.create({ data: { stockItemId: item.id, kind: "ISSUE", delta: -qty, balanceAfter: bal, reason: `Office transfer released (in transit)`, byName: user.name } });
    await tx.stockTransfer.update({ where: { id: transferId }, data: { status: "RELEASED", releasedById: user.id, releasedByName: user.name, releasedAt: new Date() } });
    name = t.itemName;
  });
  await logActivity(user, { action: "inventory.transfer.release", category: "inventory", summary: `Office transfer released from stock: ${name}`, entity: "inventory", href: "/inventory" });
  revalidatePath("/inventory");
}

/** Logistics marks the released transfer out for delivery to the Office. */
export async function deliverOfficeTransfer(transferId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  if (!(isAdmin(user) || userHasWorkflowRole(roles, user.id, "logistics" as WorkflowRoleKey))) {
    throw new Error("Only Logistics or an admin can deliver the transfer.");
  }
  const t = await prisma.stockTransfer.findUnique({ where: { id: transferId } });
  if (!t) throw new Error("Transfer not found");
  if (t.status !== "RELEASED") throw new Error("This transfer hasn't been released yet.");
  await prisma.stockTransfer.update({ where: { id: transferId }, data: { status: "DELIVERING", deliveredById: user.id, deliveredByName: user.name, deliveredAt: new Date() } });
  await logActivity(user, { action: "inventory.transfer.deliver", category: "inventory", summary: `Office transfer out for delivery: ${t.itemName}`, entity: "inventory", href: "/inventory" });
  revalidatePath("/inventory");
}

/** Sales confirms the Office received the stock — credits the Office stock item. */
export async function receiveOfficeTransfer(transferId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || user.role === "SALES")) {
    throw new Error("Only Sales or an admin can confirm the Office received the stock.");
  }
  let name = "";
  await prisma.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findUnique({ where: { id: transferId } });
    if (!t) throw new Error("Transfer not found");
    if (t.status !== "DELIVERING") throw new Error("This transfer isn't out for delivery.");
    const qty = Number(t.qty);
    const dest = await tx.stockItem.findFirst({
      where: { active: true, name: { equals: t.itemName, mode: "insensitive" }, location: { equals: t.toLocation, mode: "insensitive" } },
    });
    let destId: string;
    if (dest) {
      const bal = round3(Number(dest.quantity) + qty);
      await tx.stockItem.update({ where: { id: dest.id }, data: { quantity: bal } });
      await tx.stockMovement.create({ data: { stockItemId: dest.id, kind: "RECEIPT", delta: qty, balanceAfter: bal, reason: `Office transfer received from ${t.fromLocation}`, byName: user.name } });
      destId = dest.id;
    } else {
      const src = t.stockItemId ? await tx.stockItem.findUnique({ where: { id: t.stockItemId } }) : null;
      const sku = await nextSku(tx);
      const created = await tx.stockItem.create({
        data: { sku, name: t.itemName, unit: t.unit, category: src?.category ?? null, location: t.toLocation, quantity: qty, reorderLevel: src?.reorderLevel ?? 0, unitCost: src?.unitCost ?? 0 },
      });
      await tx.stockMovement.create({ data: { stockItemId: created.id, kind: "RECEIPT", delta: qty, balanceAfter: qty, reason: `Office transfer received from ${t.fromLocation}`, byName: user.name } });
      destId = created.id;
    }
    await tx.stockTransfer.update({ where: { id: transferId }, data: { status: "RECEIVED", destStockItemId: destId, receivedById: user.id, receivedByName: user.name, receivedAt: new Date() } });
    name = t.itemName;
  });
  await logActivity(user, { action: "inventory.transfer.received", category: "inventory", summary: `Office transfer received into Office stock: ${name}`, entity: "inventory", href: "/inventory" });
  revalidatePath("/inventory");
}

/** Attach (replace) the transfer's proof document. */
export async function attachTransferProof(transferId: string, doc: StockDoc): Promise<void> {
  await requireTransferParty();
  const clean = coerceStockDoc(doc);
  if (!clean) throw new Error("Invalid file.");
  await prisma.stockTransfer.update({ where: { id: transferId }, data: { proof: clean as unknown as Prisma.InputJsonValue } });
  revalidatePath("/inventory");
}

export async function removeTransferProof(transferId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can delete or modify uploaded documents.");
  await prisma.stockTransfer.update({ where: { id: transferId }, data: { proof: Prisma.DbNull } });
  revalidatePath("/inventory");
}
