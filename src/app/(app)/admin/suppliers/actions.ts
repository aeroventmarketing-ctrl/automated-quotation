"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { saveSupplier, deleteSupplier, bulkUpsertSuppliers, type Supplier, type BulkResult } from "@/lib/suppliers";

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
