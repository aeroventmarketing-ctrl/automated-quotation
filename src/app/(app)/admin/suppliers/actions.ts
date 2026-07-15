"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { saveSupplier, deleteSupplier, type Supplier } from "@/lib/suppliers";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can manage suppliers.");
}

const supplierSchema = z.object({
  id: z.string().optional(),
  company: z.string().trim().min(1, "Company name is required"),
  attention: z.string().trim().optional().default(""),
  address: z.string().trim().optional().default(""),
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
