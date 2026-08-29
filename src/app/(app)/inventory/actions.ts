"use server";

import { revalidatePath } from "next/cache";
import {
  assertCataloguePriceOwner,
  canSetCataloguePrice,
  canTransferCatalogueFiles,
  CATALOGUE_FILE_MESSAGE,
} from "@/lib/price-authority";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";

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

/**
 * Scan fast-path (receive / issue via the barcode box) — the Warehouse, Plant
 * Manager, Purchaser (goods receipt on deliveries) or an admin. This is the
 * direct-adjust path only; the per-row Edit / Adjust / Reserve / Transfer still
 * go through the double-handshake proposal flow.
 */
async function requireStockMover() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isAdmin(user)) return user;
  const roles = await getWorkflowRoles();
  const ok =
    userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, "plant_manager" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, "purchaser" as WorkflowRoleKey);
  if (!ok) throw new Error("Only the Warehouse, Plant Manager, Purchaser or an admin can receive / issue stock.");
  return user;
}

/**
 * Adding / merging catalogue items — the Warehouse or an admin.
 *
 * The Purchaser was dropped on the owner's instruction (*"hide … add stock item
 * button, merge duplicates button … for purchaser role"*). Dropped from the
 * guard as well as the screen: a hidden button whose action still answers is
 * theatre, and the next person to wire up a form would silently undo the rule.
 *
 * (Importing from a file is NOT here — that is the price owner's; see
 * `importStockItems` and lib/price-authority.)
 */
async function requireItemCreator() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isAdmin(user)) return user;
  const roles = await getWorkflowRoles();
  if (userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey)) return user;
  throw new Error("Only the Warehouse or an admin can add stock items.");
}

/** Only the Admin / Payment Approver may set an item's unit cost and selling price. */
async function requirePriceManager() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  // Owner's decision: the catalogue price belongs to the Admin and the Payment
  // Approver, not to the Purchaser who spends against it. See lib/price-authority.
  await assertCataloguePriceOwner();
  return user;
}

/**
 * Removing (soft-deleting) stock items — **admin only**.
 *
 * The Purchaser was the other holder and was dropped with the Delete-selected
 * button, on the owner's instruction. Removing an item is not reversible from
 * the screen (an admin recovers it), so it sits with the same person who owns
 * "Clear all".
 */
async function requireItemRemover() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!isAdmin(user)) throw new Error("Only an admin can remove stock items.");
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
    // Place each cell at its TRUE column index (colNumber). Pushing in iteration
    // order instead would let an empty/merged leading cell shift every later
    // value one column left — e.g. dropping an adjacent value into the "unit"
    // column for just that row. Fill any gaps with "".
    const vals: string[] = [];
    let maxCol = 0;
    r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      vals[colNumber - 1] = cell.text == null ? "" : String(cell.text);
      if (colNumber > maxCol) maxCol = colNumber;
    });
    for (let i = 0; i < maxCol; i++) if (vals[i] === undefined) vals[i] = "";
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
): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
  // A spreadsheet writes the whole stock list at once — unit costs and selling
  // prices included — so it is the price owner's to upload (lib/price-authority).
  // The screen hides the panel; this is the control, because a Server Action can
  // be called without the screen.
  //
  // This REPLACES `requireItemCreator` rather than adding to it. That guard is
  // Warehouse / admin, which is the wrong set here in both directions — it would
  // let the Warehouse upload prices, and turn away a Payment Approver who holds
  // no other role. Running both would leave the owner's own rule unenforceable.
  const user = await getCurrentUser();
  if (!user) return { created: 0, updated: 0, skipped: 0, errors: ["Unauthorized"] };
  if (!(await canTransferCatalogueFiles())) return { created: 0, updated: 0, skipped: 0, errors: [CATALOGUE_FILE_MESSAGE] };
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { created: 0, updated: 0, skipped: 0, errors: ["Choose a CSV or Excel file."] };

  const lower = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  let rows: string[][];
  try {
    rows = lower.endsWith(".xlsx") || lower.endsWith(".xlsm") ? await parseXlsx(buf) : parseCsv(buf.toString("utf8"));
  } catch (e) {
    return { created: 0, updated: 0, skipped: 0, errors: [`Couldn't read the file: ${e instanceof Error ? e.message : "unknown error"}. Save it as a valid .xlsx or .csv and try again.`] };
  }
  if (rows.length < 2) return { created: 0, updated: 0, skipped: 0, errors: ["The file has no data rows — it needs a header row plus at least one item."] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = col(["name", "item", "description"]);
  const iSku = col(["sku", "item code", "itemcode", "code"]);
  const iBarcode = col(["barcode", "gtin", "upc", "ean"]);
  const iUnit = col(["unit", "uom"]);
  const iCat = col(["category"]);
  const iLoc = col(["location", "bin"]);
  const iQty = col(["quantity", "qty", "on hand", "onhand", "opening qty", "opening"]);
  const iReorder = col(["reorderlevel", "reorder level", "reorder at", "reorder"]);
  const iCost = col(["unitcost", "unit cost", "cost"]);
  const iSell = col(["sellprice", "sell price", "selling price", "price"]);
  if (iName < 0) {
    return { created: 0, updated: 0, skipped: 0, errors: ['The first row must be headers with a "name" column (e.g. name, sku, unit, category, location, quantity, reorderLevel, unitCost). Add an "sku" (Item Code) column to set each item\'s code.'] };
  }

  // The cost / price columns are always honoured now: the gate at the top means
  // only the Admin / Payment Approver ever reaches this line, so the file's
  // prices are theirs. `mayPrice` stays as the single expression of the rule
  // rather than a hard-coded `true`, so the two can't drift apart.
  const mayPrice = await canSetCataloguePrice();
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[iName] ?? "").trim();
    if (!name) { skipped++; continue; }
    // A cell's trimmed value, and whether the column exists AND the cell is
    // non-empty (only non-empty cells overwrite existing data on re-import).
    const cell = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
    const has = (i: number) => i >= 0 && cell(i) !== "";
    try {
      // Per-row transaction: a failure here (e.g. a bad value) is isolated so
      // the rest of the batch still imports. Match an existing active item by
      // name (case-insensitive) and UPDATE it, so re-uploading a master list
      // refreshes items instead of creating duplicates.
      const wantLoc = has(iLoc) ? cell(iLoc) : "";
      await prisma.$transaction(async (tx) => {
        // Item Code (SKU) identifies the item.
        //
        // This used to reject any row whose code was held under a different
        // NAME, which made a RENAME impossible: the round trip this panel
        // advertises — Download Excel, edit, re-import — could change every
        // field except the one people most often fix, the name. Worse, "Clear
        // all" and "Merge duplicates" only DEACTIVATE, and the old check
        // ignored `active`, so a merged-away ghost kept its code and blocked
        // the live item forever with a message that never said which item was
        // in the way.
        //
        // The code now decides: when exactly one item holds it, that IS this
        // row's item and the name may change. An error is raised only when the
        // code is genuinely ambiguous, or when renaming would collide with a
        // different item that already answers to the new name — and it names
        // the offender either way.
        const wantSku = has(iSku) ? cell(iSku).toUpperCase() : "";
        let skuOwnerId: string | null = null;
        if (wantSku) {
          const owners = await tx.stockItem.findMany({
            where: { sku: wantSku },
            select: { id: true, name: true, active: true },
            orderBy: [{ active: "desc" }, { createdAt: "asc" }],
          });
          const sameName = (o: { name: string }) => o.name.toLowerCase() === name.toLowerCase();
          const live = owners.filter((o) => o.active);
          // Only LIVE items can compete for a code. A deactivated row is a ghost
          // left by "Clear all" or "Merge duplicates", and treating it as a rival
          // is what made a merged-away duplicate block its own live item forever.
          const rivals = live.filter((o) => !sameName(o));
          if (rivals.length > 0 || (live.length === 0 && owners.length > 0 && !owners.some(sameName))) {
            const pool = rivals.length > 0 ? rivals : owners;
            const distinct = [...new Set(pool.map((o) => o.name.toLowerCase()))];
            if (distinct.length > 1 || live.some(sameName)) {
              // Either the code is spread across several live items, or one of
              // them already answers to this row's name — which of them the row
              // means would be a guess.
              throw new Error(
                `Item Code "${wantSku}" is shared by more than one item (${pool
                  .slice(0, 3)
                  .map((o) => `“${o.name}”`)
                  .join(", ")}). Merge or re-code them first.`,
              );
            }
            // A single item holds the code under a different name — a rename.
            // Refuse only if some OTHER item already answers to the new name.
            const nameTaken = await tx.stockItem.findFirst({
              where: { name: { equals: name, mode: "insensitive" }, id: { notIn: owners.map((o) => o.id) } },
              select: { sku: true },
            });
            if (nameTaken) {
              throw new Error(
                `Renaming Item Code "${wantSku}" (currently “${pool[0].name}”) to “${name}” clashes with the existing item ${nameTaken.sku ?? ""}. Merge them first.`,
              );
            }
            skuOwnerId = pool[0].id;
          }
        }
        const wantBarcode = has(iBarcode) ? cell(iBarcode) : "";
        if (wantBarcode) {
          const bOwners = await tx.stockItem.findMany({ where: { barcode: wantBarcode }, select: { name: true } });
          if (bOwners.some((o) => o.name.toLowerCase() !== name.toLowerCase())) {
            throw new Error(`Barcode "${wantBarcode}" is already used by another item.`);
          }
        }
        // Pick the row to update, in order — INCLUDING inactive ones (a "Clear
        // all" only deactivates, keeping the unique code), preferring an active
        // match, and reactivate it:
        //  1. The row that ALREADY owns this (code, location) — updating it in
        //     place is a no-op on those fields, so it can't collide with a
        //     leftover duplicate that owns the code.
        //  2. Else a same-name row at this location.
        //  3. Else, when the file gives a location, a same-name row with no
        //     location — adopt it and set the location instead of creating a
        //     clashing new row.
        // The same item in a genuinely new location becomes its own row.
        // A rename resolved above already knows its target, and must use it —
        // looking it up by the NEW name would find nothing and create a
        // duplicate under the code that is about to move.
        let existing = skuOwnerId ? await tx.stockItem.findUnique({ where: { id: skuOwnerId } }) : null;
        if (!existing && wantSku) {
          existing = await tx.stockItem.findFirst({
            where: { sku: wantSku, ...(wantLoc ? { location: { equals: wantLoc, mode: "insensitive" } } : {}) },
            orderBy: { active: "desc" },
          });
        }
        if (!existing) {
          existing = await tx.stockItem.findFirst({
            where: {
              name: { equals: name, mode: "insensitive" },
              ...(wantLoc ? { location: { equals: wantLoc, mode: "insensitive" } } : {}),
            },
            orderBy: { active: "desc" },
          });
        }
        if (!existing && wantLoc) {
          existing = await tx.stockItem.findFirst({
            where: { name: { equals: name, mode: "insensitive" }, location: null },
            orderBy: { active: "desc" },
          });
        }
        if (existing) {
          // Overwrite only the fields whose column is present and non-empty.
          const data: Prisma.StockItemUpdateInput = {};
          if (!existing.active) data.active = true; // reactivate a previously-cleared item
          // The name is editable too, so correcting one in the spreadsheet and
          // re-importing actually corrects it. Only written when it really
          // changed, so a re-upload of an unedited file is still a no-op.
          if (existing.name !== name) data.name = name;
          if (wantSku) data.sku = wantSku;
          if (wantBarcode) data.barcode = wantBarcode;
          if (has(iUnit)) data.unit = cell(iUnit);
          if (has(iCat)) data.category = cell(iCat);
          if (has(iLoc)) data.location = cell(iLoc);
          if (has(iReorder)) data.reorderLevel = num(cell(iReorder));
          if (mayPrice && has(iCost)) data.unitCost = num(cell(iCost));
          if (mayPrice && has(iSell)) data.sellPrice = num(cell(iSell));
          if (Object.keys(data).length > 0) await tx.stockItem.update({ where: { id: existing.id }, data });
          // Quantity: only when a non-empty quantity is given; record the change
          // in the ledger. A blank quantity leaves on-hand untouched (so a
          // price-only re-upload never zeroes stock).
          if (has(iQty)) {
            const newQty = num(cell(iQty));
            const current = Number(existing.quantity);
            if (newQty !== current) {
              await tx.stockItem.update({ where: { id: existing.id }, data: { quantity: newQty } });
              await tx.stockMovement.create({
                data: { stockItemId: existing.id, kind: "ADJUSTMENT", delta: Math.round((newQty - current) * 1000) / 1000, balanceAfter: newQty, reason: "Bulk import update", byName: user.name },
              });
            }
          }
          updated++;
        } else {
          const sku = wantSku || (await nextSku(tx));
          const quantity = has(iQty) ? num(cell(iQty)) : 0;
          const item = await tx.stockItem.create({
            data: {
              sku,
              barcode: wantBarcode || null,
              name,
              unit: cell(iUnit) || "pcs",
              category: cell(iCat) || null,
              location: cell(iLoc) || null,
              quantity,
              reorderLevel: has(iReorder) ? num(cell(iReorder)) : 0,
              unitCost: mayPrice && has(iCost) ? num(cell(iCost)) : 0,
              sellPrice: mayPrice && has(iSell) ? num(cell(iSell)) : 0,
            },
          });
          if (quantity > 0) {
            await tx.stockMovement.create({
              data: { stockItemId: item.id, kind: "ADJUSTMENT", delta: quantity, balanceAfter: quantity, reason: "Opening balance (import)", byName: user.name },
            });
          }
          created++;
        }
      });
    } catch (e) {
      errors.push(`Row ${r + 1} (“${name}”): ${e instanceof Error ? e.message.slice(0, 140) : "could not be imported."}`);
    }
  }
  if (created > 0 || updated > 0) {
    await logActivity(user, {
      action: "inventory.import",
      category: "inventory",
      summary: `Import: ${created} new, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}`,
      entity: "inventory",
      href: "/inventory",
    });
  }
  revalidatePath("/inventory");
  return { created, updated, skipped, errors: errors.slice(0, 20) };
}

/**
 * Merge duplicate stock items created by earlier re-imports. Items are grouped
 * by name (case-insensitive); within each group the richest record is kept
 * (prefers one that has a selling price, then a unit cost, then the oldest), and
 * the duplicates are deactivated. Missing selling price / unit cost on the kept
 * record are backfilled from a duplicate. On-hand quantity is NOT summed (the
 * duplicates were accidental copies, not extra stock) — the kept record's
 * quantity stands. Admin / warehouse / plant manager only.
 */
export async function mergeDuplicateStockItems(): Promise<{ groups: number; removed: number }> {
  const user = await requireItemCreator();
  const list = await prisma.stockItem.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  const byName = new Map<string, typeof list>();
  for (const it of list) {
    // Group by name AND location: the same item held in two different locations
    // (multi-location stock) is NOT a duplicate — only same-name, same-location
    // rows are accidental copies to merge.
    const key = `${it.name.trim().toLowerCase()}||${(it.location ?? "").trim().toLowerCase()}`;
    (byName.get(key) ?? byName.set(key, []).get(key)!).push(it);
  }
  let groups = 0;
  let removed = 0;
  for (const dupes of byName.values()) {
    if (dupes.length < 2) continue;
    // Rank: has sell price first, then has unit cost, then oldest.
    const ranked = [...dupes].sort((a, b) => {
      const sp = (Number(b.sellPrice) > 0 ? 1 : 0) - (Number(a.sellPrice) > 0 ? 1 : 0);
      if (sp) return sp;
      const uc = (Number(b.unitCost) > 0 ? 1 : 0) - (Number(a.unitCost) > 0 ? 1 : 0);
      if (uc) return uc;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keep = ranked[0];
    const rest = ranked.slice(1);
    const bestSell = Math.max(...dupes.map((d) => Number(d.sellPrice)));
    const bestCost = Math.max(...dupes.map((d) => Number(d.unitCost)));
    try {
      await prisma.$transaction(async (tx) => {
        const patch: Prisma.StockItemUpdateInput = {};
        if (Number(keep.sellPrice) <= 0 && bestSell > 0) patch.sellPrice = bestSell;
        if (Number(keep.unitCost) <= 0 && bestCost > 0) patch.unitCost = bestCost;
        if (Object.keys(patch).length > 0) await tx.stockItem.update({ where: { id: keep.id }, data: patch });
        await tx.stockItem.updateMany({ where: { id: { in: rest.map((d) => d.id) } }, data: { active: false } });
      });
      groups++;
      removed += rest.length;
    } catch {
      /* skip a group that fails; the rest still merge */
    }
  }
  if (removed > 0) {
    await logActivity(user, {
      action: "inventory.dedupe",
      category: "inventory",
      summary: `Merged duplicates: removed ${removed} across ${groups} item${groups === 1 ? "" : "s"}`,
      entity: "inventory",
      href: "/inventory",
    });
  }
  revalidatePath("/inventory");
  return { groups, removed };
}

/**
 * Merge chosen duplicate stock items into a primary (admin only). Sums the
 * others' on-hand into the primary, moves their active reservations across,
 * backfills missing SKU / sell price / unit cost, then deactivates them. Unlike
 * the bulk auto-merge this DOES sum quantities — for genuine same-item duplicates.
 */
const mergeIntoSchema = z.object({ primaryId: z.string().min(1), otherIds: z.array(z.string().min(1)).min(1) });
export async function mergeStockItemsInto(input: z.infer<typeof mergeIntoSchema>): Promise<void> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Only an admin can merge stock items.");
  const { primaryId, otherIds } = mergeIntoSchema.parse(input);
  const ids = [...new Set([primaryId, ...otherIds])];
  const items = await prisma.stockItem.findMany({ where: { id: { in: ids } } });
  const primary = items.find((i) => i.id === primaryId);
  if (!primary) throw new Error("Primary item not found.");
  const others = items.filter((i) => i.id !== primaryId);
  if (others.length === 0) throw new Error("Choose at least one duplicate to merge in.");
  const addQty = others.reduce((s, o) => s + Number(o.quantity), 0);
  const bestSell = Math.max(Number(primary.sellPrice), ...others.map((o) => Number(o.sellPrice)));
  const bestCost = Math.max(Number(primary.unitCost), ...others.map((o) => Number(o.unitCost)));
  const otherIdList = others.map((o) => o.id);
  await prisma.$transaction(async (tx) => {
    await tx.stockReservation.updateMany({ where: { stockItemId: { in: otherIdList }, active: true }, data: { stockItemId: primaryId } });
    const patch: Prisma.StockItemUpdateInput = { quantity: Number(primary.quantity) + addQty };
    if (Number(primary.sellPrice) <= 0 && bestSell > 0) patch.sellPrice = bestSell;
    if (Number(primary.unitCost) <= 0 && bestCost > 0) patch.unitCost = bestCost;
    if (!primary.sku) { const withSku = others.find((o) => o.sku); if (withSku?.sku) patch.sku = withSku.sku; }
    await tx.stockItem.update({ where: { id: primaryId }, data: patch });
    await tx.stockItem.updateMany({ where: { id: { in: otherIdList } }, data: { active: false, quantity: 0 } });
  });
  await logActivity(user, {
    action: "inventory.merge", category: "inventory",
    summary: `Merged ${others.length} duplicate${others.length === 1 ? "" : "s"} into ${primary.name} (+${addQty} ${primary.unit})`,
    entity: "inventory", href: "/inventory",
  });
  revalidatePath("/inventory");
}

/** Remove (deactivate) a stock item — admin only. History is preserved. */
export async function removeStockItem(id: string): Promise<void> {
  const user = await requireItemRemover();
  const item = await prisma.stockItem.findUnique({ where: { id } });
  if (!item) throw new Error("Item not found.");
  await prisma.stockItem.update({ where: { id }, data: { active: false } });
  await logActivity(user, {
    action: "inventory.remove", category: "inventory",
    summary: `Removed stock item ${item.name}${item.sku ? ` (${item.sku})` : ""}`,
    entity: "inventory", href: "/inventory",
  });
  revalidatePath("/inventory");
}

/** Remove several stock items at once (soft-delete). Admin only. */
export async function removeStockItems(ids: string[]): Promise<{ removed: number }> {
  const user = await requireItemRemover();
  const clean = [...new Set((ids ?? []).filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (clean.length === 0) return { removed: 0 };
  const res = await prisma.stockItem.updateMany({ where: { id: { in: clean }, active: true }, data: { active: false } });
  await logActivity(user, {
    action: "inventory.remove_bulk", category: "inventory",
    summary: `Removed ${res.count} stock item${res.count === 1 ? "" : "s"}`,
    entity: "inventory", href: "/inventory",
  });
  revalidatePath("/inventory");
  return { removed: res.count };
}

/**
 * Clear the whole inventory (soft-delete every active stock item) so a fresh
 * Excel/CSV can be imported. Admin only — deactivates (never hard-deletes), so
 * historical movements/references are preserved and an admin can recover them.
 */
export async function clearAllStockItems(): Promise<{ removed: number }> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Only an admin can clear the inventory.");
  const res = await prisma.stockItem.updateMany({ where: { active: true }, data: { active: false } });
  await logActivity(user, {
    action: "inventory.clear_all", category: "inventory",
    summary: `Cleared the inventory (${res.count} item${res.count === 1 ? "" : "s"})`,
    entity: "inventory", href: "/inventory",
  });
  revalidatePath("/inventory");
  return { removed: res.count };
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

/** Normalise an Item Code / SKU: trim + UPPERCASE, per the Item Listing Standard. */
function normalizeSku(raw: string | undefined | null): string {
  return (raw ?? "").trim().toUpperCase();
}

const createSchema = z.object({
  name: z.string().trim().min(1),
  // Item Code (SKU). Optional — a blank one auto-generates the next serial, so
  // existing flows are unchanged; set it to the catalogue Item Code to make the
  // quote↔stock match exact (see the Item Listing Standard).
  sku: z.string().trim().optional(),
  // External supplier/manufacturer barcode (GS1 GTIN / UPC / EAN) — separate
  // from the internal SKU. Optional.
  barcode: z.string().trim().optional(),
  unit: z.string().trim().min(1),
  category: z.string().trim().optional(),
  location: z.string().trim().optional(),
  quantity: z.number().min(0),
  reorderLevel: z.number().min(0),
  unitCost: z.number().min(0).optional(),
  sellPrice: z.number().min(0).optional(),
});

/** Add a stock item. A non-zero opening quantity records an ADJUSTMENT movement. */
export async function createStockItem(input: z.infer<typeof createSchema>): Promise<void> {
  const user = await requireItemCreator();
  const d = createSchema.parse(input);
  // Anyone who may add an item may add it — but only the Admin / Payment
  // Approver may PRICE it. A new item from anyone else starts unpriced rather
  // than being refused, so adding stock is never blocked on a price.
  const mayPrice = await canSetCataloguePrice();
  const wantSku = normalizeSku(d.sku);
  const barcode = (d.barcode ?? "").trim() || null;
  await prisma.$transaction(async (tx) => {
    // Use the given Item Code when provided, else auto-generate the next serial.
    // Uniqueness is per (SKU, location): the same code may sit in another
    // location, but not twice in the same one.
    const loc = d.location?.trim() || null;
    let sku = wantSku || (await nextSku(tx));
    if (wantSku) {
      const clash = await tx.stockItem.findFirst({ where: { sku: wantSku, location: loc }, select: { id: true } });
      if (clash) throw new Error(`Item Code "${wantSku}" is already used by another stock item at this location.`);
      sku = wantSku;
    }
    if (barcode) {
      const bClash = await tx.stockItem.findFirst({ where: { barcode, location: loc }, select: { id: true } });
      if (bClash) throw new Error(`Barcode "${barcode}" is already used by another stock item at this location.`);
    }
    const item = await tx.stockItem.create({
      data: {
        sku,
        barcode,
        name: d.name,
        unit: d.unit,
        category: d.category || null,
        location: d.location || null,
        quantity: d.quantity,
        reorderLevel: d.reorderLevel,
        unitCost: mayPrice ? d.unitCost ?? 0 : 0,
        sellPrice: mayPrice ? d.sellPrice ?? 0 : 0,
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
  // Item Code (SKU). Optional — omit to leave it unchanged; set it to align an
  // existing item with the catalogue Item Code.
  sku: z.string().trim().optional(),
  // External barcode (GTIN). Optional — omit to leave unchanged.
  barcode: z.string().trim().optional(),
  category: z.string().trim().optional(),
  location: z.string().trim().optional(),
  reorderLevel: z.number().min(0),
  unitCost: z.number().min(0),
  sellPrice: z.number().min(0),
});

/** Edit an item's Item Code, location, unit cost, selling price, category and reorder level (no movement). */
export async function updateStockItemMeta(input: z.infer<typeof metaSchema>): Promise<void> {
  await requireInventoryManager();
  const d = metaSchema.parse(input);
  const mayPrice = await canSetCataloguePrice();
  const wantSku = normalizeSku(d.sku);
  // Uniqueness is per (SKU / barcode, location): the same code may sit in another
  // location, but not twice in the location this item is being set to.
  const loc = d.location?.trim() || null;
  if (wantSku) {
    const clash = await prisma.stockItem.findFirst({
      where: { sku: wantSku, location: loc, id: { not: d.stockItemId } },
      select: { id: true },
    });
    if (clash) throw new Error(`Item Code "${wantSku}" is already used by another stock item at this location.`);
  }
  const wantBarcode = d.barcode === undefined ? undefined : ((d.barcode ?? "").trim() || null);
  if (wantBarcode) {
    const bClash = await prisma.stockItem.findFirst({
      where: { barcode: wantBarcode, location: loc, id: { not: d.stockItemId } },
      select: { id: true },
    });
    if (bClash) throw new Error(`Barcode "${wantBarcode}" is already used by another stock item at this location.`);
  }
  await prisma.stockItem.update({
    where: { id: d.stockItemId },
    data: {
      ...(wantSku ? { sku: wantSku } : {}),
      ...(wantBarcode !== undefined ? { barcode: wantBarcode } : {}),
      category: d.category?.trim() || null,
      location: d.location?.trim() || null,
      reorderLevel: d.reorderLevel,
      // Prices are the Admin / Payment Approver's to set. Everyone else may edit
      // the rest of the row; the price fields are simply left as they are rather
      // than the whole save being refused.
      ...(mayPrice ? { unitCost: d.unitCost, sellPrice: d.sellPrice } : {}),
    },
  });
  revalidatePath("/inventory");
  revalidatePath("/inventory/reorder");
}

const priceSchema = z.object({
  stockItemId: z.string().min(1),
  unitCost: z.number().min(0),
  sellPrice: z.number().min(0),
});

/**
 * Set an item's unit cost and selling price. Available to the Purchaser and
 * admins (who see prices) even when they aren't the item's stock manager — so a
 * purchaser can fill in missing selling prices without warehouse rights.
 */
export async function updateStockItemPrices(input: z.infer<typeof priceSchema>): Promise<void> {
  await requirePriceManager();
  const d = priceSchema.parse(input);
  await prisma.stockItem.update({
    where: { id: d.stockItemId },
    data: { unitCost: d.unitCost, sellPrice: d.sellPrice },
  });
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
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
  const user = await requireStockMover();
  const d = adjustSchema.parse(input);
  let logInfo: { name: string; unit: string; balanceAfter: number } | null = null;
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
    logInfo = { name: item.name, unit: item.unit, balanceAfter };
  });
  if (logInfo) {
    const info = logInfo as { name: string; unit: string; balanceAfter: number };
    const verb = d.kind === "RECEIPT" ? "Received" : d.kind === "ISSUE" ? "Issued" : "Adjusted";
    await logActivity(user, {
      action: `inventory.${d.kind.toLowerCase()}`,
      category: "inventory",
      summary: `${verb} stock: ${info.name} → ${info.balanceAfter} ${info.unit} on hand`,
      entity: "inventory",
      entityId: d.stockItemId,
      href: "/inventory",
    });
  }
  revalidatePath("/inventory");
}
