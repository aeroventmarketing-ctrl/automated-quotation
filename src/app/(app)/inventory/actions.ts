"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";

async function requireInventoryManager() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isAdmin(user)) return user;
  const roles = await getWorkflowRoles();
  const ok =
    userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, "plant_manager" as WorkflowRoleKey);
  if (!ok) throw new Error("Only the Warehouse, Plant Manager, or an admin can manage inventory.");
  return user;
}

/** Claim the next SKU number (starts at 10001). Runs inside a transaction. */
async function nextSku(tx: Prisma.TransactionClient): Promise<string> {
  const KEY = "sku_counter";
  const row = await tx.appSetting.findUnique({ where: { key: KEY } });
  const cur = typeof (row?.value as { n?: unknown } | null)?.n === "number" ? (row!.value as { n: number }).n : 10000;
  const n = cur + 1;
  await tx.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: { n } as Prisma.InputJsonValue },
    update: { value: { n } as Prisma.InputJsonValue },
  });
  return String(n);
}

/** Assign SKUs to every active item that doesn't have one yet. */
export async function assignMissingSkus(): Promise<void> {
  await requireInventoryManager();
  await prisma.$transaction(async (tx) => {
    const missing = await tx.stockItem.findMany({ where: { active: true, sku: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
    for (const m of missing) {
      const sku = await nextSku(tx);
      await tx.stockItem.update({ where: { id: m.id }, data: { sku } });
    }
  });
  revalidatePath("/inventory");
  revalidatePath("/inventory/labels");
}

const createSchema = z.object({
  name: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  category: z.string().trim().optional(),
  location: z.string().trim().optional(),
  quantity: z.number().min(0),
  reorderLevel: z.number().min(0),
  unitCost: z.number().min(0).optional(),
});

/** Add a stock item. A non-zero opening quantity records an ADJUSTMENT movement. */
export async function createStockItem(input: z.infer<typeof createSchema>): Promise<void> {
  const user = await requireInventoryManager();
  const d = createSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    const sku = await nextSku(tx);
    const item = await tx.stockItem.create({
      data: {
        sku,
        name: d.name,
        unit: d.unit,
        category: d.category || null,
        location: d.location || null,
        quantity: d.quantity,
        reorderLevel: d.reorderLevel,
        unitCost: d.unitCost ?? 0,
      },
    });
    if (d.quantity > 0) {
      await tx.stockMovement.create({
        data: { stockItemId: item.id, kind: "ADJUSTMENT", delta: d.quantity, balanceAfter: d.quantity, reason: "Opening balance", byName: user.name },
      });
    }
  });
  revalidatePath("/inventory");
}

const metaSchema = z.object({
  stockItemId: z.string().min(1),
  category: z.string().trim().optional(),
  location: z.string().trim().optional(),
  reorderLevel: z.number().min(0),
  unitCost: z.number().min(0),
});

/** Edit an item's location, unit cost, category and reorder level (no movement). */
export async function updateStockItemMeta(input: z.infer<typeof metaSchema>): Promise<void> {
  await requireInventoryManager();
  const d = metaSchema.parse(input);
  await prisma.stockItem.update({
    where: { id: d.stockItemId },
    data: {
      category: d.category?.trim() || null,
      location: d.location?.trim() || null,
      reorderLevel: d.reorderLevel,
      unitCost: d.unitCost,
    },
  });
  revalidatePath("/inventory");
  revalidatePath("/inventory/reorder");
}

const reserveSchema = z.object({
  stockItemId: z.string().min(1),
  qty: z.number().positive(),
  forRef: z.string().trim().min(1),
  note: z.string().trim().max(200).optional(),
});

/** Reserve (soft-hold) stock against an order/job. Can't reserve beyond available. */
export async function reserveStock(input: z.infer<typeof reserveSchema>): Promise<void> {
  const user = await requireInventoryManager();
  const d = reserveSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.findUnique({ where: { id: d.stockItemId } });
    if (!item) throw new Error("Stock item not found");
    const agg = await tx.stockReservation.aggregate({ where: { stockItemId: d.stockItemId, active: true }, _sum: { qty: true } });
    const available = Number(item.quantity) - Number(agg._sum.qty ?? 0);
    if (d.qty > available) throw new Error(`Only ${available} ${item.unit} available to reserve.`);
    await tx.stockReservation.create({
      data: { stockItemId: d.stockItemId, qty: d.qty, forRef: d.forRef, note: d.note || null, byName: user.name },
    });
  });
  revalidatePath("/inventory");
}

/** Release an active reservation (frees the held quantity back to available). */
export async function releaseReservation(id: string): Promise<void> {
  const user = await requireInventoryManager();
  await prisma.stockReservation.update({
    where: { id },
    data: { active: false, releasedByName: user.name, releasedAt: new Date() },
  });
  revalidatePath("/inventory");
}

const adjustSchema = z.object({
  stockItemId: z.string().min(1),
  kind: z.enum(["RECEIPT", "ISSUE", "ADJUSTMENT"]),
  qty: z.number().min(0),
  reason: z.string().trim().optional(),
});

/**
 * Adjust stock. RECEIPT adds, ISSUE subtracts (never below zero), ADJUSTMENT sets
 * the on-hand to the given quantity. Records a ledger movement with the new balance.
 */
export async function adjustStock(input: z.infer<typeof adjustSchema>): Promise<void> {
  const user = await requireInventoryManager();
  const d = adjustSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.findUnique({ where: { id: d.stockItemId } });
    if (!item) throw new Error("Stock item not found");
    const current = Number(item.quantity);

    let delta: number;
    if (d.kind === "RECEIPT") delta = d.qty;
    else if (d.kind === "ISSUE") {
      if (d.qty > current) throw new Error(`Not enough stock — only ${current} ${item.unit} on hand.`);
      delta = -d.qty;
    } else {
      delta = d.qty - current; // ADJUSTMENT = set-to
    }
    const balanceAfter = Math.round((current + delta) * 1000) / 1000;

    await tx.stockItem.update({ where: { id: item.id }, data: { quantity: balanceAfter } });
    await tx.stockMovement.create({
      data: { stockItemId: item.id, kind: d.kind, delta, balanceAfter, reason: d.reason || null, byName: user.name },
    });
  });
  revalidatePath("/inventory");
}
