/**
 * CSV import for catalogue, pricelist, and rating points.
 * Each importer validates per-row and reports errors without aborting the batch.
 *
 * Column specs (header row required):
 *  catalogue:  modelCode, family, name, description, sizeLabel, uom, basePrice, currency, specsJson, active?
 *  pricelist:  modelCode, variantKey, currency, basePrice, optionsJson, effectiveDate
 *  ratings:    modelCode, rpm, airflow_m3hr, staticPressure_pa, power_kw, efficiency
 */
import Papa from "papaparse";
import { prisma } from "@/lib/db";
import { Family } from "@prisma/client";
import { getAccountsRegistry, saveAccountsRegistry } from "@/lib/account";

export type ImportType = "catalogue" | "pricelist" | "ratings" | "customers";

export interface RowError {
  row: number;
  message: string;
}
export interface ImportResult {
  inserted: number;
  updated: number;
  errors: RowError[];
  /** Rows skipped because a matching client already exists (customers import). */
  skipped?: number;
}

function parse(csv: string): Record<string, string>[] {
  const out = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return out.data;
}

const FAMILIES = new Set(Object.values(Family));

const TRUTHY = new Set(["true", "yes", "y", "1", "active"]);
const FALSY = new Set(["false", "no", "n", "0", "inactive"]);

/**
 * Read an optional `active` column.
 *
 * Returns `undefined` when the column is missing or the cell is blank, and that
 * distinction matters: a partial spreadsheet that simply has no `active` column
 * must not switch every item it touches back on. `undefined` means "leave it as
 * it is" on an update, and falls back to the schema default on an insert.
 */
function readActive(raw: string | undefined): boolean | undefined {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return undefined;
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  throw new Error(`active "${raw}" is not true/false`);
}

export async function importCatalogue(csv: string): Promise<ImportResult> {
  const rows = parse(csv);
  const res: ImportResult = { inserted: 0, updated: 0, errors: [] };

  /**
   * The fields a row actually carried.
   *
   * A COLUMN THAT IS NOT IN THE SHEET IS LEFT ALONE on an existing item; only a
   * column that is present and empty clears the value. Without that distinction
   * a three-column sheet of corrected names would silently wipe every
   * description, size and spec on the items it touched — the sheet never
   * mentioned them, so it cannot have meant to blank them. `family` and `name`
   * stay mandatory, so a sheet must still say what it is editing.
   */
  interface Valid {
    modelCode: string;
    data: {
      family: Family;
      name: string;
      description?: string | null;
      sizeLabel?: string | null;
      uom?: string;
      specs?: object;
      active?: boolean;
    };
    basePrice: number | null;
    currency: string;
  }
  /** Defaults for a brand-new item, for the columns the sheet left out. */
  const CREATE_DEFAULTS = { description: null, sizeLabel: null, uom: "unit", specs: {} };

  // 1) Validate every row in memory (no DB) and collect per-row errors.
  const valid: Valid[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    try {
      if (!r.modelCode) throw new Error("modelCode is required");
      const family = (r.family || "").toUpperCase();
      if (!FAMILIES.has(family as Family)) throw new Error(`family "${r.family}" is invalid`);
      if (!r.name) throw new Error("name is required");

      const data: Valid["data"] = { family: family as Family, name: r.name };
      // `undefined` means the sheet has no such column; "" means it has one and
      // the cell was left empty, which is a deliberate clear.
      if (r.description !== undefined) data.description = r.description || null;
      if (r.sizeLabel !== undefined) data.sizeLabel = r.sizeLabel || null;
      if (r.uom !== undefined) data.uom = r.uom || "unit";
      if (r.specsJson !== undefined) {
        if (!r.specsJson) data.specs = {};
        else {
          try {
            data.specs = JSON.parse(r.specsJson);
          } catch {
            throw new Error("specsJson is not valid JSON");
          }
        }
      }
      const active = readActive(r.active);
      if (active !== undefined) data.active = active;

      let basePrice: number | null = null;
      if (r.basePrice) {
        const p = Number(r.basePrice);
        if (Number.isNaN(p)) throw new Error("basePrice is not a number");
        basePrice = p;
      }
      valid.push({ modelCode: r.modelCode, data, basePrice, currency: r.currency || "PHP" });
    } catch (e) {
      res.errors.push({ row: line, message: e instanceof Error ? e.message : "Unknown error" });
    }
  });
  if (valid.length === 0) return res;

  // 2) Split into inserts vs updates with a single lookup.
  const codes = valid.map((v) => v.modelCode);
  const existing = await prisma.catalogueItem.findMany({
    where: { modelCode: { in: codes } },
    select: { modelCode: true },
  });
  const existsSet = new Set(existing.map((e) => e.modelCode));
  const toCreate = valid.filter((v) => !existsSet.has(v.modelCode));
  const toUpdate = valid.filter((v) => existsSet.has(v.modelCode));

  // 3) Bulk insert; update the (usually few) existing ones individually.
  if (toCreate.length) {
    await prisma.catalogueItem.createMany({
      // A new item has nothing to preserve, so the columns the sheet left out
      // fall back to their defaults. `active` is not defaulted here — the schema
      // already makes a new item active.
      data: toCreate.map((v) => ({ modelCode: v.modelCode, ...CREATE_DEFAULTS, ...v.data })),
      skipDuplicates: true,
    });
  }
  for (const v of toUpdate) {
    // Only the columns the sheet carried; the rest keep their current values.
    await prisma.catalogueItem.update({ where: { modelCode: v.modelCode }, data: v.data });
  }
  res.inserted = toCreate.length;
  res.updated = toUpdate.length;

  // 4) Default prices: replace in two bulk statements.
  const withPrice = valid.filter((v) => v.basePrice != null);
  if (withPrice.length) {
    const items = await prisma.catalogueItem.findMany({
      where: { modelCode: { in: withPrice.map((v) => v.modelCode) } },
      select: { id: true, modelCode: true },
    });
    const idByCode = new Map(items.map((it) => [it.modelCode, it.id]));
    const priceRows = withPrice
      .map((v) => ({ catalogueItemId: idByCode.get(v.modelCode), basePrice: v.basePrice!, currency: v.currency }))
      .filter((p): p is { catalogueItemId: string; basePrice: number; currency: string } => !!p.catalogueItemId);
    await prisma.priceListEntry.deleteMany({
      where: { catalogueItemId: { in: priceRows.map((p) => p.catalogueItemId) }, variantKey: "default" },
    });
    await prisma.priceListEntry.createMany({
      data: priceRows.map((p) => ({ ...p, variantKey: "default" })),
    });
  }
  return res;
}

export async function importPricelist(csv: string): Promise<ImportResult> {
  const rows = parse(csv);
  const res: ImportResult = { inserted: 0, updated: 0, errors: [] };

  const codes = Array.from(new Set(rows.map((r) => r.modelCode).filter(Boolean)));
  const items = await prisma.catalogueItem.findMany({
    where: { modelCode: { in: codes } },
    select: { id: true, modelCode: true },
  });
  const idByCode = new Map(items.map((it) => [it.modelCode, it.id]));

  interface PRow {
    catalogueItemId: string;
    variantKey: string;
    basePrice: number;
    currency: string;
    optionsJson: object;
    effectiveDate?: Date;
  }
  const valid: PRow[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    try {
      if (!r.modelCode) throw new Error("modelCode is required");
      const id = idByCode.get(r.modelCode);
      if (!id) throw new Error(`catalogue item "${r.modelCode}" not found`);
      const price = Number(r.basePrice);
      if (Number.isNaN(price)) throw new Error("basePrice is not a number");
      let optionsJson: object = {};
      if (r.optionsJson) {
        try {
          optionsJson = JSON.parse(r.optionsJson);
        } catch {
          throw new Error("optionsJson is not valid JSON");
        }
      }
      valid.push({
        catalogueItemId: id,
        variantKey: r.variantKey || "default",
        basePrice: price,
        currency: r.currency || "PHP",
        optionsJson,
        ...(r.effectiveDate ? { effectiveDate: new Date(r.effectiveDate) } : {}),
      });
    } catch (e) {
      res.errors.push({ row: line, message: e instanceof Error ? e.message : "Unknown error" });
    }
  });
  if (valid.length === 0) return res;

  // Replace the affected (item, variant) entries in two bulk statements.
  res.inserted = valid.length;
  await prisma.priceListEntry.deleteMany({
    where: { OR: valid.map((v) => ({ catalogueItemId: v.catalogueItemId, variantKey: v.variantKey })) },
  });
  await prisma.priceListEntry.createMany({ data: valid });
  return res;
}

export async function importRatings(csv: string): Promise<ImportResult> {
  const rows = parse(csv);
  const res: ImportResult = { inserted: 0, updated: 0, errors: [] };

  // Resolve all referenced models in one query.
  const codes = Array.from(new Set(rows.map((r) => r.modelCode).filter(Boolean)));
  const items = await prisma.catalogueItem.findMany({
    where: { modelCode: { in: codes } },
    select: { id: true, modelCode: true },
  });
  const idByCode = new Map(items.map((it) => [it.modelCode, it.id]));

  const data: {
    catalogueItemId: string;
    rpm: number;
    airflow_m3hr: number;
    staticPressure_pa: number;
    power_kw: number;
    efficiency: number | null;
  }[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    try {
      if (!r.modelCode) throw new Error("modelCode is required");
      const id = idByCode.get(r.modelCode);
      if (!id) throw new Error(`catalogue item "${r.modelCode}" not found`);
      const rpm = Number(r.rpm);
      const airflow = Number(r.airflow_m3hr);
      const sp = Number(r.staticPressure_pa);
      const power = Number(r.power_kw);
      const eff = r.efficiency ? Number(r.efficiency) : null;
      if ([rpm, airflow, sp, power].some((n) => Number.isNaN(n))) {
        throw new Error("rpm, airflow_m3hr, staticPressure_pa, power_kw must be numbers");
      }
      data.push({ catalogueItemId: id, rpm, airflow_m3hr: airflow, staticPressure_pa: sp, power_kw: power, efficiency: eff });
    } catch (e) {
      res.errors.push({ row: line, message: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  if (data.length) {
    // Replace each referenced model's rating points so re-importing the same
    // file refreshes the curve instead of appending duplicate points.
    const itemIds = Array.from(new Set(data.map((d) => d.catalogueItemId)));
    await prisma.fanRatingPoint.deleteMany({ where: { catalogueItemId: { in: itemIds } } });
    await prisma.fanRatingPoint.createMany({ data });
    res.inserted = data.length;
  }
  return res;
}

/**
 * Import clients into the Customer table (for the client list / email marketing).
 * Columns: company (required), contactName, email, phone, address, notes.
 * Skips rows whose client already exists — matched by email (case-insensitive)
 * when present, otherwise by company name — and de-duplicates within the file.
 */
export async function importCustomers(csv: string, opts?: { toMarketingList?: boolean }): Promise<ImportResult> {
  const rows = parse(csv);
  const res: ImportResult = { inserted: 0, updated: 0, errors: [], skipped: 0 };
  const clean = (s: string | undefined) => (s ?? "").trim();

  interface CRow {
    company: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    notes: string | null;
  }
  const valid: CRow[] = [];
  const seenEmail = new Set<string>();
  const seenCompany = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    try {
      const company = clean(r.company);
      if (!company) throw new Error("company is required");
      const email = clean(r.email) || null;
      // De-duplicate within the uploaded file.
      if (email) {
        const k = email.toLowerCase();
        if (seenEmail.has(k)) throw new Error(`duplicate email "${email}" in file`);
        seenEmail.add(k);
      } else {
        const k = company.toLowerCase();
        if (seenCompany.has(k)) throw new Error(`duplicate company "${company}" in file (add an email to distinguish)`);
        seenCompany.add(k);
      }
      valid.push({
        company,
        contactName: clean(r.contactName) || null,
        email,
        phone: clean(r.phone) || null,
        address: clean(r.address) || null,
        notes: clean(r.notes) || null,
      });
    } catch (e) {
      res.errors.push({ row: line, message: e instanceof Error ? e.message : "Unknown error" });
    }
  });
  if (valid.length === 0) return res;

  // Skip clients that already exist. The customer table is modest, so a single
  // fetch + in-memory match is simplest and avoids case-sensitive `in` filters.
  const existing = await prisma.customer.findMany({ select: { email: true, company: true } });
  const existEmails = new Set(existing.map((e) => (e.email ?? "").trim().toLowerCase()).filter(Boolean));
  const existCompanies = new Set(existing.map((e) => e.company.trim().toLowerCase()));
  const toCreate = valid.filter((v) =>
    v.email ? !existEmails.has(v.email.toLowerCase()) : !existCompanies.has(v.company.toLowerCase()),
  );
  res.skipped = valid.length - toCreate.length;
  if (toCreate.length) {
    await prisma.customer.createMany({ data: toCreate });
  }
  res.inserted = toCreate.length;

  // Optionally add the newly-created clients to the email-marketing list.
  if (opts?.toMarketingList && toCreate.length) {
    const emails = toCreate.map((v) => v.email).filter((x): x is string => !!x);
    const companies = toCreate.filter((v) => !v.email).map((v) => v.company);
    const created = await prisma.customer.findMany({
      where: { OR: [...(emails.length ? [{ email: { in: emails } }] : []), ...(companies.length ? [{ company: { in: companies } }] : [])] },
      select: { id: true },
    });
    if (created.length) {
      const accounts = await getAccountsRegistry();
      for (const c of created) {
        const a = accounts[c.id] ?? { history: [], conversations: [] };
        a.marketingList = true;
        accounts[c.id] = a;
      }
      await saveAccountsRegistry(accounts);
    }
  }
  return res;
}

export async function runImport(type: ImportType, csv: string, opts?: { toMarketingList?: boolean }): Promise<ImportResult> {
  switch (type) {
    case "catalogue":
      return importCatalogue(csv);
    case "pricelist":
      return importPricelist(csv);
    case "ratings":
      return importRatings(csv);
    case "customers":
      return importCustomers(csv, opts);
    default:
      return { inserted: 0, updated: 0, errors: [{ row: 0, message: "Unknown import type" }] };
  }
}
