/**
 * CSV import for catalogue, pricelist, and rating points.
 * Each importer validates per-row and reports errors without aborting the batch.
 *
 * Column specs (header row required):
 *  catalogue:  modelCode, family, name, description, sizeLabel, uom, basePrice, currency, specsJson
 *  pricelist:  modelCode, variantKey, currency, basePrice, optionsJson, effectiveDate
 *  ratings:    modelCode, rpm, airflow_m3hr, staticPressure_pa, power_kw, efficiency
 */
import Papa from "papaparse";
import { prisma } from "@/lib/db";
import { Family } from "@prisma/client";

export type ImportType = "catalogue" | "pricelist" | "ratings";

export interface RowError {
  row: number;
  message: string;
}
export interface ImportResult {
  inserted: number;
  updated: number;
  errors: RowError[];
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

export async function importCatalogue(csv: string): Promise<ImportResult> {
  const rows = parse(csv);
  const res: ImportResult = { inserted: 0, updated: 0, errors: [] };

  interface Valid {
    modelCode: string;
    data: {
      family: Family;
      name: string;
      description: string | null;
      sizeLabel: string | null;
      uom: string;
      specs: object;
    };
    basePrice: number | null;
    currency: string;
  }

  // 1) Validate every row in memory (no DB) and collect per-row errors.
  const valid: Valid[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    try {
      if (!r.modelCode) throw new Error("modelCode is required");
      const family = (r.family || "").toUpperCase();
      if (!FAMILIES.has(family as Family)) throw new Error(`family "${r.family}" is invalid`);
      if (!r.name) throw new Error("name is required");
      let specs: object = {};
      if (r.specsJson) {
        try {
          specs = JSON.parse(r.specsJson);
        } catch {
          throw new Error("specsJson is not valid JSON");
        }
      }
      let basePrice: number | null = null;
      if (r.basePrice) {
        const p = Number(r.basePrice);
        if (Number.isNaN(p)) throw new Error("basePrice is not a number");
        basePrice = p;
      }
      valid.push({
        modelCode: r.modelCode,
        data: {
          family: family as Family,
          name: r.name,
          description: r.description || null,
          sizeLabel: r.sizeLabel || null,
          uom: r.uom || "unit",
          specs,
        },
        basePrice,
        currency: r.currency || "PHP",
      });
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
      data: toCreate.map((v) => ({ modelCode: v.modelCode, ...v.data })),
      skipDuplicates: true,
    });
  }
  for (const v of toUpdate) {
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

export async function runImport(type: ImportType, csv: string): Promise<ImportResult> {
  switch (type) {
    case "catalogue":
      return importCatalogue(csv);
    case "pricelist":
      return importPricelist(csv);
    case "ratings":
      return importRatings(csv);
    default:
      return { inserted: 0, updated: 0, errors: [{ row: 0, message: "Unknown import type" }] };
  }
}
