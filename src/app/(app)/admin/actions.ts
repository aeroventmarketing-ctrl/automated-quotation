"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getGeofence, GEOFENCE_KEY } from "@/lib/geofence";
import { setUserSignatureValue } from "@/lib/signature";
import { getPropellerSpLock, setPropellerSpLock } from "@/lib/propeller-lock";
import { getAxialSpLock, setAxialSpLock } from "@/lib/axial-lock";
import { setHideOrderProgress } from "@/lib/order-progress-visibility";
import { setNotificationsEnabled } from "@/lib/notification-settings";
import { setDocCheckGateEnabled } from "@/lib/doc-check-gate";
import { setStockLocations } from "@/lib/stock-locations";
import { setDocViewers } from "@/lib/doc-viewers";
import { setFollowUpSettings, type FollowUpConfig } from "@/lib/follow-up-settings";
import { runFollowUps, type FollowUpRunResult } from "@/lib/follow-up-runner";
import { setUserWorkflowRoles } from "@/lib/workflow-roles";
import { saveAiUsageLimit } from "@/lib/ai/usage";
import { createServiceClient } from "@/lib/supabase/server";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Admin access required");
  return user!;
}

/** Grant/revoke which users may view sale/order documents. */
export async function saveDocViewersAction(input: { ids: string[] }): Promise<string[]> {
  await assertAdmin();
  const ids = z.object({ ids: z.array(z.string()).max(1000) }).parse(input).ids;
  const saved = await setDocViewers(ids);
  revalidatePath("/admin/document-access");
  return saved;
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
export async function clearCatalogue(password?: string) {
  await assertAdmin();
  // Password gate so the catalogue can't be wiped by an accidental click. The
  // expected password is set by the operator via the CLEAR_CATALOG_PASSWORD
  // environment variable (never stored in the repo). Locked until it is set.
  const expected = process.env.CLEAR_CATALOG_PASSWORD;
  if (!expected) {
    throw new Error(
      "Clearing is locked. Set the CLEAR_CATALOG_PASSWORD environment variable to your chosen password to enable it.",
    );
  }
  if ((password ?? "") !== expected) {
    throw new Error("Incorrect password — catalogue was not cleared.");
  }
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

// A user's signature image (PNG/JPEG data URL) shown on their quotation exports.
const signatureSchema = z.object({
  userId: z.string().min(1),
  dataUrl: z.string().nullable(), // null clears the signature
});

export async function saveUserSignature(input: z.infer<typeof signatureSchema>) {
  await assertAdmin();
  const d = signatureSchema.parse(input);
  if (d.dataUrl) {
    if (!/^data:image\/(png|jpe?g);base64,/i.test(d.dataUrl)) {
      throw new Error("Signature must be a PNG or JPEG image.");
    }
    // ~1.5 MB base64 cap (uploads are downscaled client-side well below this).
    if (d.dataUrl.length > 1_600_000) {
      throw new Error("Signature image is too large — please upload a smaller file.");
    }
  }
  await setUserSignatureValue(d.userId, d.dataUrl);
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

// --- Propeller Type static-pressure lock ------------------------------------
export async function getPropellerSpLockSetting(): Promise<boolean> {
  await assertAdmin();
  return getPropellerSpLock();
}

const spLockSchema = z.object({ enabled: z.boolean() });
export async function savePropellerSpLockSetting(input: z.infer<typeof spLockSchema>): Promise<boolean> {
  await assertAdmin();
  const d = spLockSchema.parse(input);
  await setPropellerSpLock(d.enabled);
  revalidatePath("/admin");
  return d.enabled;
}

// --- Axial Type static-pressure lock (Tubeaxial 1.5" / Vaneaxial 4" w.g.) -----
export async function saveAxialSpLockSetting(input: z.infer<typeof spLockSchema>): Promise<boolean> {
  await assertAdmin();
  const d = spLockSchema.parse(input);
  await setAxialSpLock(d.enabled);
  revalidatePath("/admin");
  return d.enabled;
}

// --- Hide order progress from Sales & Engineer ------------------------------
export async function saveHideOrderProgressSetting(input: z.infer<typeof spLockSchema>): Promise<boolean> {
  await assertAdmin();
  const d = spLockSchema.parse(input);
  await setHideOrderProgress(d.enabled);
  revalidatePath("/admin");
  return d.enabled;
}

// --- Approver notification alarm --------------------------------------------
export async function saveNotificationsSetting(input: z.infer<typeof spLockSchema>): Promise<boolean> {
  await assertAdmin();
  const d = spLockSchema.parse(input);
  await setNotificationsEnabled(d.enabled);
  revalidatePath("/admin");
  return d.enabled;
}

// --- Documents-required gate for "Mark documents checked" -------------------
export async function saveDocCheckGateSetting(input: z.infer<typeof spLockSchema>): Promise<boolean> {
  await assertAdmin();
  const d = spLockSchema.parse(input);
  await setDocCheckGateEnabled(d.enabled);
  revalidatePath("/admin");
  revalidatePath("/orders");
  return d.enabled;
}

// --- Stock locations (dropdown list for Inventory) --------------------------
const locationsSchema = z.object({ locations: z.array(z.string()).max(500) });
export async function saveStockLocationsAction(input: z.infer<typeof locationsSchema>): Promise<string[]> {
  await assertAdmin();
  const d = locationsSchema.parse(input);
  const saved = await setStockLocations(d.locations);
  revalidatePath("/admin");
  revalidatePath("/inventory");
  return saved;
}

// --- Client follow-up cadence + delivery ------------------------------------
const followUpSettingsSchema = z.object({
  offsetsDays: z.array(z.number()),
  maxNudges: z.number(),
  enabled: z.boolean(),
  dryRun: z.boolean(),
});
export async function saveFollowUpSettingsAction(
  input: z.infer<typeof followUpSettingsSchema>,
): Promise<FollowUpConfig> {
  await assertAdmin();
  const d = followUpSettingsSchema.parse(input);
  const saved = await setFollowUpSettings(d);
  revalidatePath("/admin");
  revalidatePath("/follow-ups");
  return saved;
}

/** Dry-run the follow-up pass now (never sends) and return the summary. */
export async function runFollowUpPreviewAction(): Promise<FollowUpRunResult> {
  await assertAdmin();
  return runFollowUps({ live: false });
}

// --- Material Request Form numbering ----------------------------------------
const MRF_COUNTER_KEY = "mrf_counter";
const mrfNextSchema = z.object({ next: z.number().int().min(1) });
/** Set the next Material Request Form number (stored as last = next - 1). */
export async function setMrfNextNo(input: z.infer<typeof mrfNextSchema>): Promise<number> {
  await assertAdmin();
  const d = mrfNextSchema.parse(input);
  await prisma.appSetting.upsert({
    where: { key: MRF_COUNTER_KEY },
    create: { key: MRF_COUNTER_KEY, value: { last: d.next - 1 } },
    update: { value: { last: d.next - 1 } },
  });
  revalidatePath("/admin");
  return d.next;
}

// --- Purchase Order numbering -----------------------------------------------
const PO_COUNTER_KEY = "po_counter";
const poNextSchema = z.object({ next: z.number().int().min(1) });
/** Set the next Purchase Order sequence number (stored as last = next - 1). */
export async function setPoNextNo(input: z.infer<typeof poNextSchema>): Promise<number> {
  await assertAdmin();
  const d = poNextSchema.parse(input);
  await prisma.appSetting.upsert({
    where: { key: PO_COUNTER_KEY },
    create: { key: PO_COUNTER_KEY, value: { last: d.next - 1 } },
    update: { value: { last: d.next - 1 } },
  });
  revalidatePath("/admin");
  return d.next;
}

// --- Fans & Blowers Job Order numbering -------------------------------------
const JO_COUNTER_KEY = "jo_counter";
const joNextSchema = z.object({ next: z.number().int().min(1) });
/** Set the next Job Order base sequence number (stored as last = next - 1). */
export async function setJoNextNo(input: z.infer<typeof joNextSchema>): Promise<number> {
  await assertAdmin();
  const d = joNextSchema.parse(input);
  await prisma.appSetting.upsert({
    where: { key: JO_COUNTER_KEY },
    create: { key: JO_COUNTER_KEY, value: { last: d.next - 1 } },
    update: { value: { last: d.next - 1 } },
  });
  revalidatePath("/admin");
  return d.next;
}

// --- Workflow (ERP) roles ---------------------------------------------------
const workflowRolesSchema = z.object({ userId: z.string(), roles: z.array(z.string()) });
export async function setUserWorkflowRolesAction(
  input: z.infer<typeof workflowRolesSchema>,
): Promise<string[]> {
  await assertAdmin();
  const d = workflowRolesSchema.parse(input);
  const saved = await setUserWorkflowRoles(d.userId, d.roles);
  revalidatePath("/admin/workflow-roles");
  return saved;
}

// --- Quotation numbering ----------------------------------------------------
// The running sequence lives in QuoteCounter (single row keyed 0). The number a
// quote receives is lastValue + 1 after an atomic increment, so "next number" =
// lastValue + 1. Format: "YYYY - AFBM{00000000}{sales letter}".
const QUOTE_COUNTER_KEY = 0;

/** The 8-digit running number the next quotation will receive (admin). */
export async function getNextQuoteSeq(): Promise<number> {
  await assertAdmin();
  const c = await prisma.quoteCounter.findUnique({ where: { year: QUOTE_COUNTER_KEY } });
  return (c?.lastValue ?? 0) + 1;
}

const nextSeqSchema = z.object({ next: z.number().int().min(1) });
/** Set the running number the next quotation will receive (admin only). */
export async function setNextQuoteSeq(input: z.infer<typeof nextSeqSchema>): Promise<number> {
  await assertAdmin();
  const d = nextSeqSchema.parse(input);
  await prisma.quoteCounter.upsert({
    where: { year: QUOTE_COUNTER_KEY },
    create: { year: QUOTE_COUNTER_KEY, lastValue: d.next - 1 },
    update: { lastValue: d.next - 1 },
  });
  revalidatePath("/admin");
  return d.next;
}

const quoteNumSchema = z.object({ id: z.string().min(1), quoteNumber: z.string().trim().min(1) });
/** Edit a single quotation's number (admin only). Must stay unique. */
export async function updateQuoteNumber(
  input: z.infer<typeof quoteNumSchema>,
): Promise<{ ok: true } | { error: string }> {
  try {
    await assertAdmin();
    const d = quoteNumSchema.parse(input);
    const clash = await prisma.quotation.findFirst({
      where: { quoteNumber: d.quoteNumber, NOT: { id: d.id } },
      select: { id: true },
    });
    if (clash) return { error: "That quotation number is already in use." };
    await prisma.quotation.update({ where: { id: d.id }, data: { quoteNumber: d.quoteNumber } });
    revalidatePath(`/quotations/${d.id}`);
    revalidatePath("/quotations");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update quotation number" };
  }
}

// --- Login audit ------------------------------------------------------------
// Cross-reference app User rows against Supabase Auth logins (matched by email)
// to surface: app users who can't sign in (no login) and logins that have no
// app user (these cause the post-login redirect loop).
export interface LoginAudit {
  appUsers: number;
  authUsers: number;
  missingLogin: { email: string; name: string; role: string }[];
  orphanAuth: string[];
}
export async function auditLogins(): Promise<LoginAudit | { error: string }> {
  try {
    await assertAdmin();
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY — can't read Auth logins." };
    }
    const sb = createServiceClient();
    const appUsers = await prisma.user.findMany({ select: { email: true, name: true, role: true } });
    const appEmails = new Set(appUsers.map((u) => u.email.toLowerCase()));

    const authEmails = new Set<string>();
    for (let page = 1; page <= 25; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return { error: error.message };
      for (const u of data.users as { email?: string }[]) {
        if (u.email) authEmails.add(u.email.toLowerCase());
      }
      if (data.users.length < 200) break;
    }

    const missingLogin = appUsers
      .filter((u) => !authEmails.has(u.email.toLowerCase()))
      .map((u) => ({ email: u.email, name: u.name, role: String(u.role) }));
    const orphanAuth = [...authEmails].filter((e) => !appEmails.has(e)).sort();

    return { appUsers: appUsers.length, authUsers: authEmails.size, missingLogin, orphanAuth };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Audit failed" };
  }
}

/** Save the monthly AI-usage alert thresholds (0 = no limit). */
export async function saveAiUsageLimitAction(input: { monthlyCalls: number; monthlyTokens: number }): Promise<void> {
  await assertAdmin();
  await saveAiUsageLimit({ monthlyCalls: input.monthlyCalls, monthlyTokens: input.monthlyTokens });
  revalidatePath("/admin/ai-usage");
  revalidatePath("/admin");
}
