"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { nextProductSku } from "@/lib/product-catalog";
import { coerceProductSuppliers, type ProductSupplierLink } from "@/lib/products";
import { getSuppliers, rememberSupplier } from "@/lib/suppliers";

async function requireProductManager() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (isAdmin(user)) return user;
  const roles = await getWorkflowRoles();
  const ok =
    userHasWorkflowRole(roles, user.id, "purchaser" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey);
  if (!ok) throw new Error("Only the Purchaser, Warehouse, or an admin can manage the product list.");
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

export async function createProduct(input: z.infer<typeof productSchema>): Promise<void> {
  await requireProductManager();
  const d = productSchema.parse(input);
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
}

export async function updateProduct(input: { id: string } & z.infer<typeof productSchema>): Promise<void> {
  await requireProductManager();
  const d = productSchema.parse(input);
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
}

export async function deleteProduct(id: string): Promise<void> {
  await requireProductManager();
  await prisma.product.update({ where: { id }, data: { active: false } });
  revalidatePath("/products");
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
  suppliers: ProductSupplierLink[];
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
  await requireProductManager();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) throw new Error("Choose a CSV or Excel file.");
  const buf = Buffer.from(await file.arrayBuffer());
  const rows = file.name.toLowerCase().endsWith(".xlsx") ? await parseXlsx(buf) : parseCsv(buf.toString("utf8"));
  if (rows.length < 2) throw new Error("The file has no data rows (needs a header row + products).");

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = col(["name", "item", "product", "description"]);
  const iUnit = col(["unit", "uom"]);
  const iCat = col(["category"]);
  const iNote = col(["note", "remarks", "remark"]);
  const iSup = col(["supplier", "supplier name", "company"]);
  const iCode = col(["code", "supplier code", "sku"]);
  const iPrice = col(["price", "unit price", "cost"]);
  if (iName < 0) throw new Error('The file needs a "name" column.');

  // Group rows by product name; collect a supplier link per row that has one.
  const groups = new Map<string, ImportGroup>();
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[iName] ?? "").trim();
    if (!name) { skipped++; continue; }
    const key = name.toLowerCase();
    const g = groups.get(key) ?? { name, suppliers: [] };
    if (!g.unit && iUnit >= 0 && row[iUnit]?.trim()) g.unit = row[iUnit].trim();
    if (!g.category && iCat >= 0 && row[iCat]?.trim()) g.category = row[iCat].trim();
    if (!g.note && iNote >= 0 && row[iNote]?.trim()) g.note = row[iNote].trim();
    const company = iSup >= 0 ? (row[iSup] ?? "").trim() : "";
    if (company && !g.suppliers.some((s) => s.company.toLowerCase() === company.toLowerCase())) {
      g.suppliers.push({
        supplierId: "",
        company,
        code: iCode >= 0 ? row[iCode]?.trim() || undefined : undefined,
        price: iPrice >= 0 ? importNum(row[iPrice]) : undefined,
      });
    }
    groups.set(key, g);
  }

  // Ensure imported supplier companies exist in the directory, then resolve ids.
  const distinctCompanies = [...new Set([...groups.values()].flatMap((g) => g.suppliers.map((s) => s.company)))];
  for (const company of distinctCompanies) await rememberSupplier({ company });
  const dir = await getSuppliers();
  const idByCompany = new Map(dir.map((s) => [s.company.toLowerCase(), s.id]));
  for (const g of groups.values()) {
    for (const s of g.suppliers) s.supplierId = idByCompany.get(s.company.toLowerCase()) ?? "";
  }

  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  for (const g of groups.values()) {
    try {
      const existing = await prisma.product.findFirst({ where: { active: true, name: { equals: g.name, mode: "insensitive" } } });
      if (existing) {
        // Merge new suppliers into the existing ones (dedup by company).
        const cur = coerceProductSuppliers(existing.suppliers);
        const merged = [...cur];
        for (const s of g.suppliers) if (!merged.some((m) => m.company.toLowerCase() === s.company.toLowerCase())) merged.push(s);
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            unit: g.unit || existing.unit,
            category: g.category ?? existing.category,
            note: g.note ?? existing.note,
            suppliers: coerceProductSuppliers(merged) as unknown as Prisma.InputJsonValue,
          },
        });
        updated++;
      } else {
        await prisma.$transaction(async (tx) => {
          const sku = await nextProductSku(tx);
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
    } catch {
      errors.push(`Product “${g.name}” could not be imported.`);
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
