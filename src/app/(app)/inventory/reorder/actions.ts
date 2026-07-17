"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { applyStockChange } from "@/lib/inventory";
import { REORDER_KEY, coerceReorderMap, type ReorderMap } from "@/lib/reorder";

/** Purchaser, Warehouse, Plant Manager, or an admin may drive reordering. */
async function requirePurchaser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isAdmin(user)) return user;
  const roles = await getWorkflowRoles();
  const ok = (["purchaser", "warehouse", "plant_manager"] as WorkflowRoleKey[]).some((r) =>
    userHasWorkflowRole(roles, user.id, r),
  );
  if (!ok) throw new Error("Only the Purchaser, Warehouse, Plant Manager, or an admin can manage reorders.");
  return user;
}

async function writeMap(tx: Prisma.TransactionClient, map: ReorderMap): Promise<void> {
  await tx.appSetting.upsert({
    where: { key: REORDER_KEY },
    create: { key: REORDER_KEY, value: map as unknown as Prisma.InputJsonValue },
    update: { value: map as unknown as Prisma.InputJsonValue },
  });
}

const markSchema = z.object({
  stockItemId: z.string().min(1),
  qty: z.number().positive(),
  note: z.string().trim().max(200).optional(),
});

/** Record that a replenishment order was placed for an item. */
export async function markOnOrder(input: z.infer<typeof markSchema>): Promise<void> {
  const user = await requirePurchaser();
  const d = markSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.findUnique({ where: { id: d.stockItemId } });
    if (!item) throw new Error("Stock item not found");
    const row = await tx.appSetting.findUnique({ where: { key: REORDER_KEY } });
    const map = coerceReorderMap(row?.value);
    map[d.stockItemId] = { qty: d.qty, byName: user.name, at: new Date().toISOString(), note: d.note || undefined };
    await writeMap(tx, map);
  });
  revalidatePath("/inventory/reorder");
}

const bulkSchema = z.object({
  items: z
    .array(z.object({ stockItemId: z.string().min(1), qty: z.number().positive(), note: z.string().trim().max(200).optional() }))
    .min(1),
});

/** Place replenishment orders for many low/out items at once. */
export async function markAllOnOrder(input: z.infer<typeof bulkSchema>): Promise<void> {
  const user = await requirePurchaser();
  const d = bulkSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    const row = await tx.appSetting.findUnique({ where: { key: REORDER_KEY } });
    const map = coerceReorderMap(row?.value);
    const now = new Date().toISOString();
    const ids = new Set((await tx.stockItem.findMany({ where: { id: { in: d.items.map((i) => i.stockItemId) } }, select: { id: true } })).map((r) => r.id));
    for (const it of d.items) {
      if (!ids.has(it.stockItemId)) continue;
      map[it.stockItemId] = { qty: it.qty, byName: user.name, at: now, note: it.note || undefined };
    }
    await writeMap(tx, map);
  });
  revalidatePath("/inventory/reorder");
}

/** Cancel an outstanding reorder without receiving anything. */
export async function cancelOnOrder(stockItemId: string): Promise<void> {
  await requirePurchaser();
  await prisma.$transaction(async (tx) => {
    const row = await tx.appSetting.findUnique({ where: { key: REORDER_KEY } });
    const map = coerceReorderMap(row?.value);
    delete map[stockItemId];
    await writeMap(tx, map);
  });
  revalidatePath("/inventory/reorder");
}

const poReqSchema = z.object({
  items: z
    .array(z.object({ stockItemId: z.string().min(1), qty: z.number().positive(), note: z.string().trim().max(200).optional() }))
    .min(1),
});

/**
 * Raise formal replenishment purchase request(s) — one per item — that walk the
 * purchasing approval chain (approve → voucher → buy → check → receive). On
 * receive, stock is posted back to the item. Not tied to any order.
 */
export async function requestReplenishmentPO(input: z.infer<typeof poReqSchema>): Promise<void> {
  const user = await requirePurchaser();
  const d = poReqSchema.parse(input);
  const items = await prisma.stockItem.findMany({ where: { id: { in: d.items.map((i) => i.stockItemId) } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  await prisma.$transaction(async (tx) => {
    for (const it of d.items) {
      const item = byId.get(it.stockItemId);
      if (!item) continue;
      await tx.purchaseRequest.create({
        data: {
          quotationId: null,
          kind: "replenishment",
          stockItemId: it.stockItemId,
          dept: null,
          items: [`${item.name} — ${it.qty} ${item.unit}`],
          note: it.note || null,
          createdById: user.id,
          createdByName: user.name,
          status: "PENDING_APPROVAL",
        },
      });
    }
  });
  revalidatePath("/inventory/reorder");
  revalidatePath("/purchasing");
}

const receiveSchema = z.object({
  stockItemId: z.string().min(1),
  qty: z.number().positive(),
});

/** Goods arrived: add them to stock (RECEIPT) and clear the reorder entry. */
export async function receiveReorder(input: z.infer<typeof receiveSchema>): Promise<void> {
  const user = await requirePurchaser();
  const d = receiveSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    await applyStockChange(tx, { stockItemId: d.stockItemId, kind: "RECEIPT", qty: d.qty, reason: "Reorder received" }, user.name);
    const row = await tx.appSetting.findUnique({ where: { key: REORDER_KEY } });
    const map = coerceReorderMap(row?.value);
    delete map[d.stockItemId];
    await writeMap(tx, map);
  });
  revalidatePath("/inventory/reorder");
  revalidatePath("/inventory");
}
