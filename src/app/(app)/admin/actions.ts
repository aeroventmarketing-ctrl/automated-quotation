"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getGeofence, GEOFENCE_KEY } from "@/lib/geofence";
import { createServiceClient } from "@/lib/supabase/server";

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

/**
 * Wipe the entire catalogue (items + their prices + rating points). Used to
 * clear sample/practice data before importing the real catalog. Existing
 * quotation line items keep their stored snapshots; we just detach the FK so
 * the delete can't be blocked.
 */
export async function clearCatalogue() {
  await assertAdmin();
  await prisma.quotationItem.updateMany({
    where: { catalogueItemId: { not: null } },
    data: { catalogueItemId: null },
  });
  const { count } = await prisma.catalogueItem.deleteMany({});
  revalidatePath("/admin/catalogue");
  revalidatePath("/admin/import");
  return count;
}

// --- Users ------------------------------------------------------------------
const userSchema = z.object({
  id: z.string().optional(),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(["SALES", "ENGINEER", "ADMIN"]),
  // Single letter appended to quote numbers (e.g. "J").
  salesCode: z.string().trim().max(1).optional(),
});

export async function upsertUser(input: z.infer<typeof userSchema>) {
  await assertAdmin();
  const d = userSchema.parse(input);
  const salesCode = d.salesCode ? d.salesCode.toUpperCase() : null;
  const email = d.email.toLowerCase();
  const data = { email, name: d.name, role: d.role, salesCode };
  if (d.id) {
    // Editing an existing record by id — allows changing the email too.
    await prisma.user.update({ where: { id: d.id }, data });
  } else {
    await prisma.user.upsert({ where: { email }, update: { name: d.name, role: d.role, salesCode }, create: data });
  }
  revalidatePath("/admin/users");
}

export async function deleteUser(id: string) {
  await assertAdmin();
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/users");
}

// Set a user's login password in Supabase Auth (admin reset, any role).
const passwordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function setUserPassword(
  input: z.infer<typeof passwordSchema>,
): Promise<{ ok: true } | { error: string }> {
  try {
    await assertAdmin();
    const d = passwordSchema.parse(input);
    const email = d.email.toLowerCase();
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY — can't set passwords." };
    }
    const sb = createServiceClient();

    // Find the Supabase Auth user by email (paginate a few pages for safety).
    let authId: string | undefined;
    for (let page = 1; page <= 10 && !authId; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return { error: error.message };
      const match = data.users.find(
        (u: { id: string; email?: string }) => (u.email ?? "").toLowerCase() === email,
      );
      if (match) authId = match.id;
      if (data.users.length < 200) break;
    }
    if (!authId) {
      // No Auth login yet — create one with this email + password, pre-confirmed
      // so the user can sign in immediately. The app User row joins by email, so
      // no extra linking is needed.
      const { error: createErr } = await sb.auth.admin.createUser({
        email,
        password: d.password,
        email_confirm: true,
      });
      if (createErr) return { error: createErr.message };
      return { ok: true };
    }
    const { error } = await sb.auth.admin.updateUserById(authId, { password: d.password });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to set password" };
  }
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

// --- Location access (geofence) ---------------------------------------------
const geofenceLocationSchema = z.object({
  label: z.string().max(200).default(""),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().min(10).max(500000),
});
const geofenceSchema = z.object({
  enabled: z.boolean(),
  locations: z.array(geofenceLocationSchema),
});

export async function getGeofenceSetting() {
  await assertAdmin();
  return getGeofence();
}

export async function saveGeofenceSetting(input: z.infer<typeof geofenceSchema>) {
  await assertAdmin();
  const d = geofenceSchema.parse(input);
  if (d.enabled && d.locations.length === 0) {
    throw new Error("Add at least one location before enabling.");
  }
  await prisma.appSetting.upsert({
    where: { key: GEOFENCE_KEY },
    create: { key: GEOFENCE_KEY, value: d },
    update: { value: d },
  });
  // The gate lives in the (app) layout — refresh everything.
  revalidatePath("/", "layout");
  return d;
}
