"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Admin access required");
  return user!;
}

// --- Catalogue --------------------------------------------------------------
const catalogueSchema = z.object({
  id: z.string().optional(),
  modelCode: z.string().min(1),
  family: z.enum(["AXIAL", "CENTRIFUGAL", "PROPELLER", "TUBULAR_INLINE", "CABINET", "ACCESSORY", "SERVICE", "OTHER"]),
  name: z.string().min(1),
  description: z.string().optional(),
  sizeLabel: z.string().optional(),
  uom: z.string().default("unit"),
  specsJson: z.string().optional(), // raw JSON string
  active: z.boolean().default(true),
  basePrice: z.number().min(0).optional(),
});

export async function upsertCatalogueItem(input: z.infer<typeof catalogueSchema>) {
  await assertAdmin();
  const d = catalogueSchema.parse(input);
  let specs: object = {};
  if (d.specsJson) {
    try {
      specs = JSON.parse(d.specsJson);
    } catch {
      throw new Error("Specs must be valid JSON");
    }
  }

  const fields = {
    modelCode: d.modelCode,
    family: d.family,
    name: d.name,
    description: d.description,
    sizeLabel: d.sizeLabel,
    uom: d.uom,
    specs,
    active: d.active,
  };
  const item = d.id
    ? await prisma.catalogueItem.update({ where: { id: d.id }, data: fields })
    : await prisma.catalogueItem.create({ data: fields });

  if (d.basePrice != null) {
    const existing = await prisma.priceListEntry.findFirst({
      where: { catalogueItemId: item.id, variantKey: "default" },
    });
    if (existing) {
      await prisma.priceListEntry.update({ where: { id: existing.id }, data: { basePrice: d.basePrice } });
    } else {
      await prisma.priceListEntry.create({
        data: { catalogueItemId: item.id, variantKey: "default", basePrice: d.basePrice },
      });
    }
  }

  revalidatePath("/admin/catalogue");
}

export async function deleteCatalogueItem(id: string) {
  await assertAdmin();
  await prisma.catalogueItem.delete({ where: { id } });
  revalidatePath("/admin/catalogue");
}

// --- Users ------------------------------------------------------------------
const userSchema = z.object({
  id: z.string().optional(),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(["SALES", "ENGINEER", "ADMIN"]),
});

export async function upsertUser(input: z.infer<typeof userSchema>) {
  await assertAdmin();
  const d = userSchema.parse(input);
  await prisma.user.upsert({
    where: { email: d.email.toLowerCase() },
    update: { name: d.name, role: d.role },
    create: { email: d.email.toLowerCase(), name: d.name, role: d.role },
  });
  revalidatePath("/admin/users");
}

export async function deleteUser(id: string) {
  await assertAdmin();
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/users");
}

// --- Templates --------------------------------------------------------------
const templateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  layoutKey: z.string().min(1),
  configJson: z.string().optional(),
  active: z.boolean().default(true),
});

export async function upsertTemplate(input: z.infer<typeof templateSchema>) {
  await assertAdmin();
  const d = templateSchema.parse(input);
  let config: object = {};
  if (d.configJson) {
    try {
      config = JSON.parse(d.configJson);
    } catch {
      throw new Error("Config must be valid JSON");
    }
  }
  await prisma.quotationTemplate.upsert({
    where: { layoutKey: d.layoutKey },
    update: { name: d.name, config, active: d.active },
    create: { name: d.name, layoutKey: d.layoutKey, config, active: d.active },
  });
  revalidatePath("/admin/templates");
}

export async function deleteTemplate(id: string) {
  await assertAdmin();
  await prisma.quotationTemplate.delete({ where: { id } });
  revalidatePath("/admin/templates");
}

// --- Rating points ----------------------------------------------------------
export async function deleteRatingPoint(id: string) {
  await assertAdmin();
  const rp = await prisma.fanRatingPoint.delete({ where: { id } });
  revalidatePath("/admin/ratings");
  return rp;
}
