"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { isProductionHead, isPurchaserRole, coerceStockDoc, type StockDoc } from "@/lib/stock-transfer";

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
  await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.findUnique({ where: { id: d.stockItemId } });
    if (!item) throw new Error("Stock item not found");
    const fromLocation = item.location?.trim() || "—";
    const toLocation = d.toLocation.trim();
    if (toLocation.toLowerCase() === fromLocation.toLowerCase()) throw new Error("Choose a different destination location.");

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
  });
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
  });
  revalidatePath("/inventory");
}

/** Recall an in-transit transfer — the quantity returns to the source. */
export async function cancelTransfer(transferId: string): Promise<void> {
  const user = await requireInventoryManager();
  await prisma.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findUnique({ where: { id: transferId } });
    if (!t) throw new Error("Transfer not found");
    if (t.status !== "IN_TRANSIT") throw new Error("Only an in-transit transfer can be cancelled.");
    if (t.stockItemId) {
      const src = await tx.stockItem.findUnique({ where: { id: t.stockItemId } });
      if (src) {
        const bal = round3(Number(src.quantity) + Number(t.qty));
        await tx.stockItem.update({ where: { id: src.id }, data: { quantity: bal } });
        await tx.stockMovement.create({ data: { stockItemId: src.id, kind: "RECEIPT", delta: Number(t.qty), balanceAfter: bal, reason: `Transfer to ${t.toLocation} cancelled — returned`, byName: user.name } });
      }
    }
    await tx.stockTransfer.update({ where: { id: transferId }, data: { status: "CANCELLED", cancelledByName: user.name, cancelledAt: new Date() } });
  });
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
  await requireTransferParty();
  await prisma.stockTransfer.update({ where: { id: transferId }, data: { proof: Prisma.DbNull } });
  revalidatePath("/inventory");
}
