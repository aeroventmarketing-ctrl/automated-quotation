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

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2; // +1 header, +1 to 1-index
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

      const existing = await prisma.catalogueItem.findUnique({ where: { modelCode: r.modelCode } });
      const data = {
        family: family as Family,
        name: r.name,
        description: r.description || null,
        sizeLabel: r.sizeLabel || null,
        uom: r.uom || "unit",
        specs,
      };
      const item = existing
        ? await prisma.catalogueItem.update({ where: { modelCode: r.modelCode }, data })
        : await prisma.catalogueItem.create({ data: { modelCode: r.modelCode, ...data } });

      if (r.basePrice) {
        const price = Number(r.basePrice);
        if (Number.isNaN(price)) throw new Error("basePrice is not a number");
        const pe = await prisma.priceListEntry.findFirst({
          where: { catalogueItemId: item.id, variantKey: "default" },
        });
        if (pe) {
          await prisma.priceListEntry.update({
            where: { id: pe.id },
            data: { basePrice: price, currency: r.currency || "PHP" },
          });
        } else {
          await prisma.priceListEntry.create({
            data: { catalogueItemId: item.id, variantKey: "default", basePrice: price, currency: r.currency || "PHP" },
          });
        }
      }
      existing ? res.updated++ : res.inserted++;
    } catch (e) {
      res.errors.push({ row: line, message: e instanceof Error ? e.message : "Unknown error" });
    }
  }
  return res;
}

export async function importPricelist(csv: string): Promise<ImportResult> {
  const rows = parse(csv);
  const res: ImportResult = { inserted: 0, updated: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2;
    try {
      if (!r.modelCode) throw new Error("modelCode is required");
      const item = await prisma.catalogueItem.findUnique({ where: { modelCode: r.modelCode } });
      if (!item) throw new Error(`catalogue item "${r.modelCode}" not found`);

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
      const variantKey = r.variantKey || "default";
      const effectiveDate = r.effectiveDate ? new Date(r.effectiveDate) : undefined;

      const existing = await prisma.priceListEntry.findFirst({
        where: { catalogueItemId: item.id, variantKey },
      });
      if (existing) {
        await prisma.priceListEntry.update({
          where: { id: existing.id },
          data: { basePrice: price, currency: r.currency || "PHP", optionsJson, effectiveDate },
        });
        res.updated++;
      } else {
        await prisma.priceListEntry.create({
          data: {
            catalogueItemId: item.id,
            variantKey,
            basePrice: price,
            currency: r.currency || "PHP",
            optionsJson,
            ...(effectiveDate ? { effectiveDate } : {}),
          },
        });
        res.inserted++;
      }
    } catch (e) {
      res.errors.push({ row: line, message: e instanceof Error ? e.message : "Unknown error" });
    }
  }
  return res;
}

export async function importRatings(csv: string): Promise<ImportResult> {
  const rows = parse(csv);
  const res: ImportResult = { inserted: 0, updated: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2;
    try {
      if (!r.modelCode) throw new Error("modelCode is required");
      const item = await prisma.catalogueItem.findUnique({ where: { modelCode: r.modelCode } });
      if (!item) throw new Error(`catalogue item "${r.modelCode}" not found`);

      const rpm = Number(r.rpm);
      const airflow = Number(r.airflow_m3hr);
      const sp = Number(r.staticPressure_pa);
      const power = Number(r.power_kw);
      const eff = r.efficiency ? Number(r.efficiency) : null;
      if ([rpm, airflow, sp, power].some((n) => Number.isNaN(n))) {
        throw new Error("rpm, airflow_m3hr, staticPressure_pa, power_kw must be numbers");
      }

      await prisma.fanRatingPoint.create({
        data: {
          catalogueItemId: item.id,
          rpm,
          airflow_m3hr: airflow,
          staticPressure_pa: sp,
          power_kw: power,
          efficiency: eff,
        },
      });
      res.inserted++;
    } catch (e) {
      res.errors.push({ row: line, message: e instanceof Error ? e.message : "Unknown error" });
    }
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
