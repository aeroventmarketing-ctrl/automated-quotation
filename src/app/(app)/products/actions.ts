"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { nextProductSku } from "@/lib/product-catalog";
import { coerceProductSuppliers } from "@/lib/products";

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
