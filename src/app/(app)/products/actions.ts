"use server";

import { revalidatePath } from "next/cache";
import {
  canSetCataloguePrice,
  canTransferCatalogueFiles,
  CATALOGUE_FILE_MESSAGE,
  PRICE_OWNER_CONFIRMS,
  PRICE_OWNER_MESSAGE,
} from "@/lib/price-authority";
import { z } from "zod";
import { Prisma, type ProductChangeKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import { nextProductSku } from "@/lib/product-catalog";
import { coerceProductSuppliers, type ProductSupplierLink } from "@/lib/products";
import { getSuppliers, rememberSupplier, isPricedSupplierName } from "@/lib/suppliers";
import { setOfficeResaleProduct } from "@/lib/office-resale";
import { productChangeSummary, type ProductChangePayload } from "@/lib/product-change";

async function requireProductManager() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isAdmin(user)) return user;
  const roles = await getWorkflowRoles();
  // The Payment Approver is here because they OWN the supplier price (see
  // lib/price-authority) and the price lives inside the product record — without
  // this they would own a figure they could not reach, and there would be nobody
  // whose Save writes straight through to the catalogue.
  const ok =
    userHasWorkflowRole(roles, user.id, "purchaser" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, "payment_approver" as WorkflowRoleKey);
  if (!ok) throw new Error("Only the Purchaser, Payment Approver or an admin can manage the product list.");
  return user;
}

const supplierLinkSchema = z.object({
  supplierId: z.string().trim().default(""),
  company: z.string().trim().min(1),
  code: z.string().trim().optional(),
  price: z.number().nonnegative().optional(),
});

const productSchema = z.object({
  name: z.string().trim().min(1, "Enter a product name."),
  unit: z.string().trim().default("pcs"),
  category: z.string().trim().optional(),
  note: z.string().trim().optional(),
  suppliers: z.array(supplierLinkSchema).max(50).default([]),
});

/**
 * What a Save / Add / Delete did.
 *
 * Returned, not thrown, on every outcome: a production build strips the message
 * off anything a Server Action throws, and "your change is waiting for approval"
 * is precisely the sentence the user must read.
 *
 * `applied: false` is not a failure — it is the change parked for the Admin /
 * Payment Approver, so the screen must say so rather than imply a save.
 */
export type ProductSaveResult =
  | { ok: true; applied: true }
  | { ok: true; applied: false; message: string }
  | { ok: false; error: string };

const APPLIED: ProductSaveResult = { ok: true, applied: true };
const PARKED: ProductSaveResult = { ok: true, applied: false, message: PRICE_OWNER_CONFIRMS };

/** Run a save, returning any failure's real reason instead of throwing it away. */
async function asSaveResult(fn: () => Promise<ProductSaveResult>): Promise<ProductSaveResult> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    // The approval queue is a table; before its migration runs, a proposal has
    // nowhere to go. Say that, rather than a Prisma stack trace.
    return { ok: false, error: /ProductChange/i.test(msg) ? "The product-approval table isn't set up yet. Run migration 0047 in Supabase." : msg };
  }
}

const asPayload = (d: z.infer<typeof productSchema>): ProductChangePayload => ({
  name: d.name,
  unit: d.unit || "pcs",
  category: d.category || null,
  note: d.note || null,
  suppliers: coerceProductSuppliers(d.suppliers),
});

/** The product as it stands now, in the same shape, for the reviewer's diff. */
async function snapshot(id: string): Promise<ProductChangePayload | null> {
  const p = await prisma.product.findUnique({ where: { id } });
  if (!p) return null;
  return { name: p.name, unit: p.unit, category: p.category, note: p.note, suppliers: coerceProductSuppliers(p.suppliers) };
}

/**
 * Park a proposed change for the price owner.
 *
 * Kept whole — prices included — because the owner is about to read it and
 * decide. This is the ONE path on which a non-owner's price reaches the
 * database, and only through the owner's own click; everywhere else
 * `canSetCataloguePrice` still strips it.
 */
async function park(
  user: { id: string; name: string | null },
  kind: ProductChangeKind,
  productId: string | null,
  payload: ProductChangePayload,
): Promise<ProductSaveResult> {
  const before = productId ? await snapshot(productId) : null;
  const summary = productChangeSummary(kind, payload);
  await prisma.productChange.create({
    data: {
      productId,
      productName: payload.name,
      kind,
      payload: payload as unknown as Prisma.InputJsonValue,
      before: (before as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
      summary,
      proposedById: user.id,
      proposedByName: user.name ?? "Unknown",
    },
  });
  await logActivity(user, {
    action: "products.change.propose",
    category: "inventory",
    summary: `Product change proposed — ${summary}`,
    entity: "product",
    entityId: productId ?? undefined,
    href: "/products",
  });
  revalidatePath("/products");
  revalidatePath("/my-dashboard");
  return PARKED;
}

export async function createProduct(input: z.infer<typeof productSchema>): Promise<ProductSaveResult> {
  return asSaveResult(async () => {
    const user = await requireProductManager();
    const d = productSchema.parse(input);
    if (!(await canSetCataloguePrice())) return park(user, "CREATE", null, asPayload(d));
    await prisma.$transaction(async (tx) => {
      const sku = await nextProductSku(tx);
      await tx.product.create({
        data: {
          name: d.name,
          unit: d.unit || "pcs",
          category: d.category || null,
          note: d.note || null,
          sku,
          suppliers: coerceProductSuppliers(d.suppliers) as unknown as Prisma.InputJsonValue,
        },
      });
    });
    revalidatePath("/products");
    return APPLIED;
  });
}

export async function updateProduct(input: { id: string } & z.infer<typeof productSchema>): Promise<ProductSaveResult> {
  return asSaveResult(async () => {
    const user = await requireProductManager();
    const d = productSchema.parse(input);
    if (!(await canSetCataloguePrice())) return park(user, "UPDATE", input.id, asPayload(d));
    await prisma.product.update({
      where: { id: input.id },
      data: {
        name: d.name,
        unit: d.unit || "pcs",
        category: d.category || null,
        note: d.note || null,
        suppliers: coerceProductSuppliers(d.suppliers) as unknown as Prisma.InputJsonValue,
      },
    });
    revalidatePath("/products");
    return APPLIED;
  });
}

/**
 * Flag a product as "Office / resale" (a bought-and-resold finished good). Its
 * sales are then booked entirely to the Office profit centre in the Departmental
 * P&L, never to a production department. Purchaser / admin only.
 */
export async function setProductOfficeResaleAction(id: string, on: boolean): Promise<boolean> {
  await requireProductManager();
  await setOfficeResaleProduct(id, on);
  revalidatePath("/products");
  revalidatePath("/management");
  return on;
}

/**
 * Remove one product (soft-delete). Sits beside Save in the same panel and goes
 * the same way: the price owner confirms it, because removing a product removes
 * the price a purchase order prices against.
 *
 * The BULK tools below (`deleteProducts`, `removeUnsourcedProducts`,
 * `clearAllProducts`) are deliberately NOT routed through the queue — they are
 * list-maintenance actions taken deliberately, with their own confirmations, and
 * parking hundreds of rows one at a time would make the queue useless.
 */
export async function deleteProduct(id: string): Promise<ProductSaveResult> {
  return asSaveResult(async () => {
    const user = await requireProductManager();
    if (!(await canSetCataloguePrice())) {
      const before = await snapshot(id);
      if (!before) throw new Error("Product not found.");
      return park(user, "DELETE", id, before);
    }
    await prisma.product.update({ where: { id }, data: { active: false } });
    revalidatePath("/products");
    return APPLIED;
  });
}

// --- The price owner's queue -------------------------------------------------

/** Only the Admin / Payment Approver decides a parked product change. */
async function requirePriceOwner() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(await canSetCataloguePrice())) throw new Error(PRICE_OWNER_MESSAGE);
  return user;
}

/** Confirm a parked change — this is the moment it reaches the catalogue. */
export async function approveProductChange(id: string): Promise<ProductSaveResult> {
  return asSaveResult(async () => {
    const user = await requirePriceOwner();
    const c = await prisma.productChange.findUnique({ where: { id } });
    if (!c) throw new Error("That change is no longer there.");
    if (c.status !== "PENDING") throw new Error("That change has already been decided.");
    const d = c.payload as unknown as ProductChangePayload;
    const suppliers = coerceProductSuppliers(d.suppliers) as unknown as Prisma.InputJsonValue;

    await prisma.$transaction(async (tx) => {
      if (c.kind === "CREATE") {
        const sku = await nextProductSku(tx);
        await tx.product.create({
          data: { name: d.name, unit: d.unit || "pcs", category: d.category, note: d.note, sku, suppliers },
        });
      } else if (c.kind === "UPDATE") {
        // The product may have been removed while the change waited — say so
        // rather than resurrect it behind the reviewer's back.
        const exists = await tx.product.findUnique({ where: { id: c.productId! }, select: { id: true } });
        if (!exists) throw new Error("That product no longer exists.");
        await tx.product.update({
          where: { id: c.productId! },
          data: { name: d.name, unit: d.unit || "pcs", category: d.category, note: d.note, suppliers },
        });
      } else {
        await tx.product.update({ where: { id: c.productId! }, data: { active: false } });
      }
      await tx.productChange.update({
        where: { id },
        data: { status: "APPLIED", decidedByName: user.name, decidedAt: new Date() },
      });
    });

    await logActivity(user, {
      action: "products.change.approved",
      category: "inventory",
      summary: `Product change approved — ${c.summary}`,
      entity: "product",
      entityId: c.productId ?? undefined,
      href: "/products",
    });
    revalidatePath("/products");
    revalidatePath("/my-dashboard");
    return APPLIED;
  });
}

/** Turn a parked change down. The proposer keeps the reason on the card. */
export async function rejectProductChange(id: string, reason?: string): Promise<ProductSaveResult> {
  return asSaveResult(async () => {
    const user = await requirePriceOwner();
    const c = await prisma.productChange.findUnique({ where: { id } });
    if (!c) throw new Error("That change is no longer there.");
    if (c.status !== "PENDING") throw new Error("That change has already been decided.");
    await prisma.productChange.update({
      where: { id },
      data: { status: "REJECTED", decidedByName: user.name, decidedAt: new Date(), rejectReason: (reason ?? "").trim() || null },
    });
    await logActivity(user, {
      action: "products.change.rejected",
      category: "inventory",
      summary: `Product change rejected — ${c.summary}`,
      entity: "product",
      entityId: c.productId ?? undefined,
      href: "/products",
    });
    revalidatePath("/products");
    revalidatePath("/my-dashboard");
    return APPLIED;
  });
}

/**
 * Withdraw one's own parked change. Without this a mistyped proposal would sit
 * in the owner's queue with nobody able to clear it but them.
 */
export async function withdrawProductChange(id: string): Promise<ProductSaveResult> {
  return asSaveResult(async () => {
    const user = await requireProductManager();
    const c = await prisma.productChange.findUnique({ where: { id } });
    if (!c) throw new Error("That change is no longer there.");
    if (c.status !== "PENDING") throw new Error("That change has already been decided.");
    if (c.proposedById !== user.id && !(await canSetCataloguePrice())) throw new Error("Only the person who proposed it can withdraw it.");
    await prisma.productChange.update({
      where: { id },
      data: { status: "REJECTED", decidedByName: user.name, decidedAt: new Date(), rejectReason: "Withdrawn by the proposer" },
    });
    revalidatePath("/products");
    revalidatePath("/my-dashboard");
    return APPLIED;
  });
}

/**
 * Purge products that have neither a supplier nor a price — the leftovers from
 * the old auto-save behaviour. Purchaser/warehouse/admin only. Deactivates
 * (never hard-deletes) so any historical reference is preserved.
 */
export async function removeUnsourcedProducts(): Promise<{ removed: number }> {
  await requireProductManager();
  const list = await prisma.product.findMany({ where: { active: true }, select: { id: true, suppliers: true } });
  const ids = list
    .filter((p) => {
      const sups = coerceProductSuppliers(p.suppliers);
      const hasSupplier = sups.some((s) => s.company && s.company.trim() !== "");
      const hasPrice = sups.some((s) => typeof s.price === "number" && s.price > 0);
      return !hasSupplier && !hasPrice;
    })
    .map((p) => p.id);
  if (ids.length > 0) {
    await prisma.product.updateMany({ where: { id: { in: ids } }, data: { active: false } });
  }
  revalidatePath("/products");
  return { removed: ids.length };
}

/** Remove several products at once (soft-delete). Purchaser / admin. */
export async function deleteProducts(ids: string[]): Promise<{ removed: number }> {
  await requireProductManager();
  const clean = [...new Set((ids ?? []).filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (clean.length === 0) return { removed: 0 };
  const res = await prisma.product.updateMany({ where: { id: { in: clean }, active: true }, data: { active: false } });
  revalidatePath("/products");
  return { removed: res.count };
}

/**
 * Clear the whole product list (soft-delete every active product) so a fresh
 * Excel/CSV can be imported. Admin only — deactivates (never hard-deletes), so
 * historical references are preserved and an admin can recover them.
 */
export async function clearAllProducts(): Promise<{ removed: number }> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Only an admin can clear all products.");
  const res = await prisma.product.updateMany({ where: { active: true }, data: { active: false } });
  revalidatePath("/products");
  return { removed: res.count };
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

const importNum = (s: string | undefined) => {
  const n = Number((s ?? "").toString().replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

interface ImportGroup {
  name: string;
  unit?: string;
  category?: string;
  note?: string;
  /** Product's own Item Code / SKU from the file (blank → auto-generated). */
  sku?: string;
  suppliers: ProductSupplierLink[];
}

/**
 * Parse a products-export "Suppliers" cell into per-supplier links. The export
 * packs everything into one cell — `NAME ₱price` pairs separated by ";", e.g.
 * "SMARTPLUS PAINT CENTER ₱800; YALE HARDWARE CORPORATION ₱800" — so the embedded
 * price attaches to its supplier instead of becoming part of a junk company name.
 * A plain cell with no ₱ keeps working (one company; the row's price column, e.g.
 * "Lowest price", supplies the price when the cell names a single supplier).
 */
function parseSupplierCell(raw: string, rowPrice?: number): { company: string; price?: number }[] {
  const parts = raw.split(";").map((p) => p.trim()).filter(Boolean);
  const fallback = rowPrice && rowPrice > 0 ? rowPrice : undefined;
  return parts
    .map((part) => {
      const m = part.match(/\s*(?:₱|PHP)\s*([\d,]+(?:\.\d+)?)\s*$/iu);
      const company = (m ? part.slice(0, part.length - m[0].length) : part).trim();
      const embedded = m ? Number(m[1].replace(/,/g, "")) : undefined;
      // An embedded "₱price" always wins. Otherwise fall back to the row's price
      // column ("Lowest price" in the export) — INCLUDING for multi-supplier
      // cells, where the file often names several suppliers with one price for
      // the product. Leaving those blank meant ~40% of the catalogue carried no
      // price at all, so a PO could never auto-fill. Approximate for the dearer
      // supplier, but a figure the purchaser can see and correct beats nothing.
      const price = embedded && embedded > 0 ? embedded : fallback;
      return { company, price };
    })
    .filter((s) => s.company);
}

/**
 * Import products from an uploaded CSV or .xlsx file. Columns: name, unit,
 * category, note, supplier, code, price — only "name" is required. Rows with the
 * same product name are merged (so a product can list several suppliers, one per
 * row). New supplier companies are added to the supplier directory.
 */
export async function importProducts(
  formData: FormData,
): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
  // Validation problems are returned (not thrown) so the real reason reaches the
  // user — production redacts every error thrown from a Server Action to a
  // generic "Server Components render" message.
  const fail = (message: string) => ({ created: 0, updated: 0, skipped: 0, errors: [message] });

  // A spreadsheet writes the whole catalogue at once, so it is the price owner's
  // to upload (see lib/price-authority). The screen hides the panel; this is the
  // control, because a Server Action can be called without the screen.
  //
  // This stands in for `requireProductManager`, which it is strictly stricter
  // than — the Purchaser it would admit is exactly who must not upload prices.
  if (!(await canTransferCatalogueFiles())) return fail(CATALOGUE_FILE_MESSAGE);

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return fail("Choose a CSV or Excel file.");
  const buf = Buffer.from(await file.arrayBuffer());
  let rows: string[][];
  try {
    // Strip a UTF-8 BOM (Excel / Google Sheets add one on save) so the first
    // header cell reads "name", not "﻿name".
    rows = file.name.toLowerCase().endsWith(".xlsx") ? await parseXlsx(buf) : parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  } catch {
    return fail("Could not read the file. Save it as a plain CSV or .xlsx and try again.");
  }
  if (rows.length < 2) return fail("The file has no data rows (needs a header row + at least one product).");

  const header = rows[0].map((h) => h.replace(/^﻿/, "").trim().toLowerCase());
  // Flexible header matching: an exact match wins, otherwise a header that
  // *contains* the keyword (so "item description" → name, "supplier's name" →
  // supplier). Each column is claimed once; the more specific columns are
  // assigned first so a generic keyword can't steal a labelled one (e.g. "name"
  // must not grab "supplier's name").
  const used = new Set<number>();
  const pick = (keywords: string[]): number => {
    for (const kw of keywords) {
      const i = header.findIndex((h, idx) => !used.has(idx) && h === kw);
      if (i >= 0) { used.add(i); return i; }
    }
    for (const kw of keywords) {
      const i = header.findIndex((h, idx) => !used.has(idx) && h.includes(kw));
      if (i >= 0) { used.add(i); return i; }
    }
    return -1;
  };
  const iSup = pick(["supplier", "supplier's name", "supplier name", "vendor", "company"]);
  // The product's OWN Item Code / SKU (e.g. CAT00001) — claimed before the
  // supplier code so a "sku" / "item code" column sets the product SKU, not the
  // supplier's code. Blank → auto-generated as before.
  const iSku = pick(["sku", "product sku", "product code", "itemcode", "item code"]);
  const iCode = pick(["supplier code", "supplier's code", "code"]);
  const iPrice = pick(["price", "unit price", "unit cost", "cost"]);
  const iUnit = pick(["unit", "uom", "units"]);
  const iCat = pick(["category", "categories"]);
  const iNote = pick(["note", "notes", "remarks", "remark"]);
  const iName = pick(["name", "item description", "description", "item", "product", "particulars"]);
  if (iName < 0) return fail(`The file needs a product-name column (e.g. "name", "item description" or "product"). Columns found: ${header.filter(Boolean).join(", ") || "(none)"}.`);

  // Group rows by product name; collect a supplier link per row that has one.
  const groups = new Map<string, ImportGroup>();
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[iName] ?? "").trim();
    if (!name) { skipped++; continue; }
    const key = name.toLowerCase();
    const g = groups.get(key) ?? { name, suppliers: [] };
    if (!g.sku && iSku >= 0 && row[iSku]?.trim()) g.sku = row[iSku].trim().toUpperCase();
    if (!g.unit && iUnit >= 0 && row[iUnit]?.trim()) g.unit = row[iUnit].trim();
    if (!g.category && iCat >= 0 && row[iCat]?.trim()) g.category = row[iCat].trim();
    if (!g.note && iNote >= 0 && row[iNote]?.trim()) g.note = row[iNote].trim();
    const supCell = iSup >= 0 ? (row[iSup] ?? "").trim() : "";
    if (supCell) {
      const rowPrice = iPrice >= 0 ? importNum(row[iPrice]) : undefined;
      const parsed = parseSupplierCell(supCell, rowPrice);
      // A supplier code column describes a single supplier — only attach it when
      // the cell names exactly one.
      const code = parsed.length === 1 && iCode >= 0 ? row[iCode]?.trim() || undefined : undefined;
      for (const s of parsed) {
        if (!g.suppliers.some((x) => x.company.toLowerCase() === s.company.toLowerCase())) {
          g.suppliers.push({ supplierId: "", company: s.company, code, price: s.price });
        }
      }
    }
    groups.set(key, g);
  }

  if (groups.size === 0) return fail("No products found in the file (every row was missing a name).");

  // Ensure imported supplier companies exist in the directory, then resolve ids.
  const idByCompany = new Map<string, string>();
  try {
    const distinctCompanies = [...new Set([...groups.values()].flatMap((g) => g.suppliers.map((s) => s.company)))];
    for (const company of distinctCompanies) await rememberSupplier({ company });
    const dir = await getSuppliers();
    for (const s of dir) idByCompany.set(s.company.toLowerCase(), s.id);
  } catch {
    return fail("Could not update the supplier directory. Please try again.");
  }
  for (const g of groups.values()) {
    for (const s of g.suppliers) s.supplierId = idByCompany.get(s.company.toLowerCase()) ?? "";
  }

  // No price-stripping pass here any more: the gate at the top means only the
  // Admin / Payment Approver ever reaches this line, so the file's prices are
  // theirs and are written as given.
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  for (const g of groups.values()) {
    try {
      // Match the product to update by the file's Item Code FIRST — regardless of
      // active state — so re-importing (even after a "Clear all", which only
      // deactivates) reuses the SAME product and its code instead of creating a
      // duplicate. Otherwise match an active product by name.
      let existing = g.sku ? await prisma.product.findUnique({ where: { sku: g.sku } }) : null;
      if (!existing) existing = await prisma.product.findFirst({ where: { active: true, name: { equals: g.name, mode: "insensitive" } } });
      if (existing) {
        // Merge new suppliers into the existing ones (dedup by company). Stale
        // junk links from raw-export imports ("NAME ₱price" as a company) are
        // dropped — the parsed clean link replaces them — and the file's price
        // refreshes an existing link's price.
        const cur = coerceProductSuppliers(existing.suppliers).filter((s) => !isPricedSupplierName(s.company));
        const merged = [...cur];
        for (const s of g.suppliers) {
          const at = merged.findIndex((m) => m.company.toLowerCase() === s.company.toLowerCase());
          if (at < 0) merged.push(s);
          else merged[at] = { ...merged[at], price: s.price ?? merged[at].price, code: s.code ?? merged[at].code, supplierId: merged[at].supplierId || s.supplierId };
        }
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            active: true, // reactivate a previously-cleared product on re-import
            name: g.name,
            // When matched by code this is a no-op; when matched by name it sets
            // the file's (free) code. A code owned elsewhere can't reach here — it
            // would have been matched as `existing` above.
            ...(g.sku ? { sku: g.sku } : {}),
            unit: g.unit || existing.unit,
            category: g.category ?? existing.category,
            note: g.note ?? existing.note,
            suppliers: coerceProductSuppliers(merged) as unknown as Prisma.InputJsonValue,
          },
        });
        updated++;
      } else {
        await prisma.$transaction(async (tx) => {
          // Use the file's Item Code when provided (it's free — an owned code
          // would have matched above), else auto-generate the next PRD serial.
          const sku = g.sku || (await nextProductSku(tx));
          await tx.product.create({
            data: {
              name: g.name,
              unit: g.unit || "pcs",
              category: g.category || null,
              note: g.note || null,
              sku,
              suppliers: coerceProductSuppliers(g.suppliers) as unknown as Prisma.InputJsonValue,
            },
          });
        });
        created++;
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message.replace(/\s+/g, " ").slice(0, 160) : "";
      errors.push(`Product “${g.name}” could not be imported${detail ? `: ${detail}` : "."}`);
    }
  }
  revalidatePath("/products");
  return { created, updated, skipped, errors: errors.slice(0, 20) };
}

/** Backfill SKUs for any products missing one (e.g. auto-saved before SKUs). */
export async function assignMissingProductSkus(): Promise<void> {
  await requireProductManager();
  const missing = await prisma.product.findMany({ where: { active: true, sku: null }, select: { id: true } });
  for (const p of missing) {
    await prisma.$transaction(async (tx) => {
      const sku = await nextProductSku(tx);
      await tx.product.update({ where: { id: p.id }, data: { sku } });
    });
  }
  revalidatePath("/products");
}
