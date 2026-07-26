"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import type { StockActionKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import {
  coerceStockDoc,
  type AdjustPayload,
  type EditPayload,
  type ReservePayload,
  type TransferPayload,
} from "@/lib/stock-action";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

interface Parties {
  admin: boolean;
  warehouse: boolean;
  purchaser: boolean;
}
async function viewerParties(): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; p: Parties }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const admin = isAdmin(user);
  return {
    user,
    p: {
      admin,
      warehouse: admin || userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey),
      purchaser: admin || userHasWorkflowRole(roles, user.id, "purchaser" as WorkflowRoleKey),
    },
  };
}

function summaryFor(kind: StockActionKind, item: { name: string; unit: string; quantity: unknown }, payload: unknown): string {
  const on = Number(item.quantity as number);
  if (kind === "EDIT") {
    const d = payload as EditPayload;
    return `Edit ${item.name}: location ${d.location || "—"}, reorder ${d.reorderLevel}, unit cost ${peso(d.unitCost)}, sell ${peso(d.sellPrice)}, category ${d.category || "—"}`;
  }
  if (kind === "ADJUST") {
    const d = payload as AdjustPayload;
    const verb = d.kind === "RECEIPT" ? `Receive +${d.qty}` : d.kind === "ISSUE" ? `Issue −${d.qty}` : `Set to ${d.qty}`;
    return `${verb} ${item.unit} · ${item.name} (now ${on} ${item.unit})${d.reason ? ` · ${d.reason}` : ""}`;
  }
  if (kind === "RESERVE") {
    const d = payload as ReservePayload;
    return `Reserve ${d.qty} ${item.unit} · ${item.name} for ${d.forRef}${d.note ? ` · ${d.note}` : ""}`;
  }
  const d = payload as TransferPayload;
  return `Transfer ${d.qty} ${item.unit} · ${item.name} → ${d.toLocation}${d.note ? ` · ${d.note}` : ""}`;
}

/** Propose a stock action — held pending until a Warehouseman AND a Purchaser approve. */
export async function proposeStockAction(kind: StockActionKind, stockItemId: string, payloadRaw: unknown): Promise<void> {
  const { user, p } = await viewerParties();
  if (!(p.admin || p.warehouse || p.purchaser)) {
    throw new Error("Only the Warehouseman, Purchaser or an admin can propose a stock action.");
  }
  const item = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
  if (!item) throw new Error("Stock item not found");

  // Normalise + validate the payload per kind.
  let payload: unknown;
  if (kind === "EDIT") {
    const d = payloadRaw as EditPayload;
    payload = {
      category: (d.category ?? "").trim() || null,
      location: (d.location ?? "").trim() || null,
      reorderLevel: Number(d.reorderLevel) || 0,
      unitCost: Number(d.unitCost) || 0,
      sellPrice: Number(d.sellPrice) || 0,
    } satisfies EditPayload;
  } else if (kind === "ADJUST") {
    const d = payloadRaw as AdjustPayload;
    if (!["RECEIPT", "ISSUE", "ADJUSTMENT"].includes(d.kind)) throw new Error("Invalid adjustment type.");
    if (!(Number(d.qty) >= 0)) throw new Error("Enter a quantity.");
    payload = { kind: d.kind, qty: Number(d.qty), reason: (d.reason ?? "").trim() || null } satisfies AdjustPayload;
  } else if (kind === "RESERVE") {
    const d = payloadRaw as ReservePayload;
    if (!(Number(d.qty) > 0)) throw new Error("Enter a quantity.");
    if (!(d.forRef ?? "").trim()) throw new Error("Enter what it's reserved for.");
    payload = { qty: Number(d.qty), forRef: d.forRef.trim(), note: (d.note ?? "").trim() || null } satisfies ReservePayload;
  } else {
    const d = payloadRaw as TransferPayload;
    if (!(Number(d.qty) > 0)) throw new Error("Enter a quantity.");
    if (!(d.toLocation ?? "").trim()) throw new Error("Choose a destination location.");
    const proof = coerceStockDoc(d.proof);
    if (!proof) throw new Error("Upload the stock transfer form first.");
    payload = { qty: Number(d.qty), toLocation: d.toLocation.trim(), note: (d.note ?? "").trim() || null, proof } satisfies TransferPayload;
  }

  const proposedRole = !p.warehouse && !p.purchaser ? "admin" : p.warehouse ? "warehouse" : "purchaser";
  const now = new Date();
  await prisma.stockAction.create({
    data: {
      stockItemId,
      itemName: item.name,
      kind,
      payload: payload as Prisma.InputJsonValue,
      summary: summaryFor(kind, item, payload),
      proposedById: user.id,
      proposedByName: user.name,
      proposedRole,
      // The proposer's own handshake slot is filled by proposing.
      ...(proposedRole === "warehouse" ? { warehouseByName: user.name, warehouseAt: now } : {}),
      ...(proposedRole === "purchaser" ? { purchaserByName: user.name, purchaserAt: now } : {}),
    },
  });
  await logActivity(user, {
    action: "inventory.action.propose",
    category: "inventory",
    summary: `Stock action proposed — ${summaryFor(kind, item, payload)}`,
    entity: "inventory",
    entityId: stockItemId,
    href: "/inventory",
  });
  revalidatePath("/inventory");
  revalidatePath("/my-dashboard");
}

/** Fill the viewer's handshake slot; when both are filled, apply the change. */
export async function approveStockAction(id: string): Promise<void> {
  const { user, p } = await viewerParties();
  let appliedSummary: string | null = null;
  await prisma.$transaction(async (tx) => {
    const a = await tx.stockAction.findUnique({ where: { id } });
    if (!a) throw new Error("Stock action not found");
    if (a.status !== "PENDING") throw new Error("This action is no longer pending.");
    const now = new Date();
    const data: Prisma.StockActionUpdateInput = {};
    if (a.warehouseAt == null && p.warehouse) {
      data.warehouseByName = user.name;
      data.warehouseAt = now;
    } else if (a.purchaserAt == null && p.purchaser) {
      data.purchaserByName = user.name;
      data.purchaserAt = now;
    } else {
      throw new Error(
        a.warehouseAt != null && a.purchaserAt != null
          ? "Both approvals are already in."
          : "You can't approve this side (needs the other party).",
      );
    }
    const bothIn = (a.warehouseAt != null || data.warehouseAt != null) && (a.purchaserAt != null || data.purchaserAt != null);
    if (bothIn) {
      await applyAction(tx, a, user.name);
      data.status = "APPLIED";
      data.appliedAt = now;
      appliedSummary = a.summary;
    }
    await tx.stockAction.update({ where: { id }, data });
  });
  if (appliedSummary) {
    await logActivity(user, {
      action: "inventory.action.applied",
      category: "inventory",
      summary: `Stock action applied — ${appliedSummary}`,
      entity: "inventory",
      href: "/inventory",
    });
  }
  revalidatePath("/inventory");
  revalidatePath("/my-dashboard");
}

/** Reject a pending action (either party or an admin). */
export async function rejectStockAction(id: string, reason?: string): Promise<void> {
  const { user, p } = await viewerParties();
  if (!(p.admin || p.warehouse || p.purchaser)) throw new Error("You can't reject this action.");
  await prisma.stockAction.update({
    where: { id },
    data: { status: "REJECTED", rejectedByName: user.name, rejectedAt: new Date(), rejectReason: (reason ?? "").trim() || null },
  });
  revalidatePath("/inventory");
  revalidatePath("/my-dashboard");
}

/** Apply the pending change to the real stock (called once both parties approve). */
async function applyAction(tx: Prisma.TransactionClient, a: { kind: StockActionKind; stockItemId: string; payload: unknown }, byName: string): Promise<void> {
  const item = await tx.stockItem.findUnique({ where: { id: a.stockItemId } });
  if (!item) throw new Error("Stock item no longer exists.");

  if (a.kind === "EDIT") {
    const d = a.payload as EditPayload;
    await tx.stockItem.update({
      where: { id: item.id },
      data: { category: d.category, location: d.location, reorderLevel: d.reorderLevel, unitCost: d.unitCost, sellPrice: d.sellPrice },
    });
    return;
  }

  if (a.kind === "ADJUST") {
    const d = a.payload as AdjustPayload;
    const current = Number(item.quantity);
    let delta: number;
    if (d.kind === "RECEIPT") delta = d.qty;
    else if (d.kind === "ISSUE") {
      if (d.qty > current) throw new Error(`Not enough stock — only ${current} ${item.unit} on hand.`);
      delta = -d.qty;
    } else delta = d.qty - current;
    const balanceAfter = round3(current + delta);
    await tx.stockItem.update({ where: { id: item.id }, data: { quantity: balanceAfter } });
    await tx.stockMovement.create({ data: { stockItemId: item.id, kind: d.kind, delta, balanceAfter, reason: d.reason, byName } });
    return;
  }

  if (a.kind === "RESERVE") {
    const d = a.payload as ReservePayload;
    const agg = await tx.stockReservation.aggregate({ where: { stockItemId: item.id, active: true }, _sum: { qty: true } });
    const available = Number(item.quantity) - Number(agg._sum.qty ?? 0);
    if (d.qty > available) throw new Error(`Only ${available} ${item.unit} available to reserve.`);
    await tx.stockReservation.create({ data: { stockItemId: item.id, qty: d.qty, forRef: d.forRef, note: d.note, byName } });
    return;
  }

  // TRANSFER — issue from source (in transit); the existing transfer receipt
  // handshake still receives it into the destination.
  const d = a.payload as TransferPayload;
  const fromLocation = item.location?.trim() || "—";
  const toLocation = d.toLocation.trim();
  if (toLocation.toLowerCase() === fromLocation.toLowerCase()) throw new Error("Choose a different destination location.");
  const onHand = Number(item.quantity);
  const agg = await tx.stockReservation.aggregate({ where: { stockItemId: item.id, active: true }, _sum: { qty: true } });
  const available = onHand - Number(agg._sum.qty ?? 0);
  if (d.qty > available) throw new Error(`Only ${available} ${item.unit} available to transfer.`);
  const srcBalance = round3(onHand - d.qty);
  await tx.stockItem.update({ where: { id: item.id }, data: { quantity: srcBalance } });
  await tx.stockMovement.create({
    data: { stockItemId: item.id, kind: "ISSUE", delta: -d.qty, balanceAfter: srcBalance, reason: `Transfer to ${toLocation} (in transit)${d.note ? ` · ${d.note}` : ""}`, byName },
  });
  await tx.stockTransfer.create({
    data: {
      stockItemId: item.id, itemName: item.name, unit: item.unit, qty: d.qty, fromLocation, toLocation,
      note: d.note, proof: (d.proof ?? undefined) as Prisma.InputJsonValue | undefined, initiatedById: "", initiatedByName: byName,
    },
  });
}
