"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveSupplier, deleteSupplier, deleteSuppliers, clearSuppliers, bulkUpsertSuppliers, removeInvalidSuppliers, isPricedSupplierName, type Supplier, type BulkResult } from "@/lib/suppliers";
import { coerceProductSuppliers } from "@/lib/products";
import { AEROVENT_SUPPLIERS } from "@/lib/supplier-seed";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can manage suppliers.");
}

const supplierSchema = z.object({
  id: z.string().optional(),
  company: z.string().trim().min(1, "Company name is required"),
  contactPerson: z.string().trim().optional().default(""),
  contactNumber: z.string().trim().optional().default(""),
  email: z.string().trim().optional().default(""),
  address: z.string().trim().optional().default(""),
  tin: z.string().trim().optional().default(""),
  zip: z.string().trim().optional().default(""),
  bankName: z.string().trim().optional().default(""),
  accountNumber: z.string().trim().optional().default(""),
  ewt: z.boolean().optional().default(false),
  terms: z.boolean().optional().default(false),
  remarks: z.string().trim().optional().default(""),
});

export async function saveSupplierAction(input: z.infer<typeof supplierSchema>): Promise<Supplier[]> {
  await assertAdmin();
  const d = supplierSchema.parse(input);
  const list = await saveSupplier(d);
  revalidatePath("/admin/suppliers");
  return list;
}

export async function deleteSupplierAction(id: string): Promise<Supplier[]> {
  await assertAdmin();
  const list = await deleteSupplier(id);
  revalidatePath("/admin/suppliers");
  return list;
}

/** Remove several suppliers at once. Admin only. */
export async function deleteSuppliersAction(ids: string[]): Promise<Supplier[]> {
  await assertAdmin();
  const list = await deleteSuppliers(ids);
  revalidatePath("/admin/suppliers");
  return list;
}

/** Clear the whole supplier directory so a fresh Excel/CSV can be imported. */
export async function clearSuppliersAction(): Promise<Supplier[]> {
  await assertAdmin();
  const list = await clearSuppliers();
  revalidatePath("/admin/suppliers");
  return list;
}

const bulkSchema = z.object({
  rows: z.array(
    z.object({
      company: z.string().trim().optional().default(""),
      contactPerson: z.string().trim().optional().default(""),
      contactNumber: z.string().trim().optional().default(""),
      email: z.string().trim().optional().default(""),
      address: z.string().trim().optional().default(""),
      tin: z.string().trim().optional().default(""),
      zip: z.string().trim().optional().default(""),
      bankName: z.string().trim().optional().default(""),
      accountNumber: z.string().trim().optional().default(""),
      ewt: z.boolean().optional(),
      terms: z.boolean().optional(),
      remarks: z.string().trim().optional().default(""),
    }),
  ),
});

export async function bulkImportSuppliersAction(input: z.infer<typeof bulkSchema>): Promise<BulkResult> {
  await assertAdmin();
  const d = bulkSchema.parse(input);
  const result = await bulkUpsertSuppliers(d.rows);
  revalidatePath("/admin/suppliers");
  return result;
}

/**
 * One-click loader for the AEROVENT master supplier list (bundled from the
 * committed "suppliers-template with remarks.xlsx"). Upserts every supplier by
 * company name, filling in the complete details and remarks. Existing suppliers
 * are updated (non-blank fields only); new ones are added.
 */
export async function importBundledSuppliersAction(): Promise<BulkResult> {
  await assertAdmin();
  const result = await bulkUpsertSuppliers(AEROVENT_SUPPLIERS);
  revalidatePath("/admin/suppliers");
  return result;
}

/**
 * Purge junk suppliers created by importing a product export's "Suppliers" cell
 * (a company name with a price / semicolon, e.g. "RITE PRODUCTS INC. ₱8078.02")
 * — from BOTH the supplier directory and every product's supplier links, so a PO
 * no longer offers the priced duplicate. Admin only.
 */
export async function removeInvalidSuppliersAction(): Promise<{ removedSuppliers: number; cleanedProducts: number; list: Supplier[] }> {
  await assertAdmin();
  const { removed, list } = await removeInvalidSuppliers();
  // Strip the same junk supplier links from every product.
  const products = await prisma.product.findMany({ select: { id: true, suppliers: true } });
  let cleanedProducts = 0;
  for (const p of products) {
    const links = coerceProductSuppliers(p.suppliers);
    const kept = links.filter((l) => !isPricedSupplierName(l.company));
    if (kept.length !== links.length) {
      await prisma.product.update({
        where: { id: p.id },
        data: { suppliers: coerceProductSuppliers(kept) as unknown as Prisma.InputJsonValue },
      });
      cleanedProducts++;
    }
  }
  revalidatePath("/admin/suppliers");
  revalidatePath("/products");
  return { removedSuppliers: removed, cleanedProducts, list };
}
