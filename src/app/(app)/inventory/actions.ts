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

// --- Bulk import (CSV / Excel) ----------------------------------------------

/** Minimal RFC-4180-ish CSV parser (handles quoted fields and embedded commas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws?.eachRow({ includeEmpty: false }, (r) => {
    const vals: string[] = [];
    r.eachCell({ includeEmpty: true }, (cell) => vals.push(cell.text == null ? "" : String(cell.text)));
    rows.push(vals);
  });
  return rows;
}

const num = (s: string | undefined) => {
  const n = Number((s ?? "").toString().replace(/,/g, "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Import stock items from an uploaded CSV or .xlsx file. Returns a result rather
 * than throwing (server-action errors are hidden in production), and imports
 * each row in its own transaction so one bad row can't abort the whole batch.
 */
export async function importStockItems(
  formData: FormData,
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const user = await requireInventoryManager();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { created: 0, skipped: 0, errors: ["Choose a CSV or Excel file."] };

  const lower = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  let rows: string[][];
  try {
    rows = lower.endsWith(".xlsx") || lower.endsWith(".xlsm") ? await parseXlsx(buf) : parseCsv(buf.toString("utf8"));
  } catch (e) {
    return { created: 0, skipped: 0, errors: [`Couldn't read the file: ${e instanceof Error ? e.message : "unknown error"}. Save it as a valid .xlsx or .csv and try again.`] };
  }
  if (rows.length < 2) return { created: 0, skipped: 0, errors: ["The file has no data rows — it needs a header row plus at least one item."] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = col(["name", "item", "description"]);
  const iUnit = col(["unit", "uom"]);
  const iCat = col(["category"]);
  const iLoc = col(["location", "bin"]);
  const iQty = col(["quantity", "qty", "on hand", "onhand", "opening qty", "opening"]);
  const iReorder = col(["reorderlevel", "reorder level", "reorder at", "reorder"]);
  const iCost = col(["unitcost", "unit cost", "cost"]);
  if (iName < 0) {
    return { created: 0, skipped: 0, errors: ['The first row must be headers with a "name" column (e.g. name, unit, category, location, quantity, reorderLevel, unitCost).'] };
  }

  const errors: string[] = [];
  let created = 0;
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[iName] ?? "").trim();
    if (!name) { skipped++; continue; }
    const quantity = iQty >= 0 ? num(row[iQty]) : 0;
    try {
      // Per-row transaction: a failure here (e.g. a bad value) is isolated so
      // the rest of the batch still imports.
      await prisma.$transaction(async (tx) => {
        const sku = await nextSku(tx);
        const item = await tx.stockItem.create({
          data: {
            sku,
            name,
            unit: (iUnit >= 0 ? row[iUnit]?.trim() : "") || "pcs",
            category: (iCat >= 0 ? row[iCat]?.trim() : "") || null,
            location: (iLoc >= 0 ? row[iLoc]?.trim() : "") || null,
            quantity,
            reorderLevel: iReorder >= 0 ? num(row[iReorder]) : 0,
            unitCost: iCost >= 0 ? num(row[iCost]) : 0,
          },
        });
        if (quantity > 0) {
          await tx.stockMovement.create({
            data: { stockItemId: item.id, kind: "ADJUSTMENT", delta: quantity, balanceAfter: quantity, reason: "Opening balance (import)", byName: user.name },
          });
        }
      });
      created++;
    } catch (e) {
      errors.push(`Row ${r + 1} (“${name}”): ${e instanceof Error ? e.message.slice(0, 140) : "could not be imported."}`);
    }
  }
  revalidatePath("/inventory");
  return { created, skipped, errors: errors.slice(0, 20) };
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
