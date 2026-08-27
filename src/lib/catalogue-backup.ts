/**
 * Catalogue backup — the whole catalogue as one table, in the exact shape the
 * catalogue importer reads back.
 *
 * The point is a ROUND TRIP: download, keep the file, upload it later and get
 * the catalogue you had. That only works if the two sides agree on columns, so
 * the header below is the importer's column spec (see `importCatalogue` in
 * src/lib/import/csv.ts) plus `active` — without `active`, restoring a backup
 * would quietly switch every disabled item back on.
 *
 * This is deliberately NOT the same as /api/catalogue/export, which is a short
 * SKU list for pickers (code, name, family, size, unit, store_listed) and drops
 * price, description and specs. That one is for looking things up; this one is
 * for putting things back.
 */
import { prisma } from "@/lib/db";

/** Header row. Order is the file's column order, so keep it stable. */
export const CATALOGUE_BACKUP_COLUMNS = [
  "modelCode",
  "family",
  "name",
  "description",
  "sizeLabel",
  "uom",
  "basePrice",
  "currency",
  "specsJson",
  "active",
] as const;

export type CatalogueBackupRow = Record<(typeof CATALOGUE_BACKUP_COLUMNS)[number], string>;

/**
 * Every catalogue item, active and inactive alike — a backup that silently drops
 * the disabled ones is not a backup. Each item's default-variant price comes
 * along, since that is the price the editor shows and the importer writes.
 */
export async function buildCatalogueBackup(): Promise<CatalogueBackupRow[]> {
  const items = await prisma.catalogueItem.findMany({
    orderBy: [{ family: "asc" }, { modelCode: "asc" }],
    include: { priceList: { where: { variantKey: "default" }, take: 1 } },
  });

  return items.map((i) => {
    const price = i.priceList[0];
    return {
      modelCode: i.modelCode,
      family: i.family,
      name: i.name,
      description: i.description ?? "",
      sizeLabel: i.sizeLabel ?? "",
      uom: i.uom,
      // Blank rather than "0" when an item has no price row: 0 is a price, and
      // writing it back would invent one the catalogue never had.
      basePrice: price ? Number(price.basePrice).toFixed(2) : "",
      currency: price ? price.currency : "",
      specsJson: JSON.stringify(i.specs ?? {}),
      active: i.active ? "TRUE" : "FALSE",
    };
  });
}

/** RFC-4180 cell: quote when the value could otherwise break the row. */
function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV text. Leads with a BOM so Excel opens it as UTF-8 instead of mangling the
 * peso sign and any accented product names, and uses CRLF for the same reason.
 */
export function catalogueBackupCsv(rows: CatalogueBackupRow[]): string {
  const lines = [
    CATALOGUE_BACKUP_COLUMNS.join(","),
    ...rows.map((r) => CATALOGUE_BACKUP_COLUMNS.map((c) => csvCell(r[c])).join(",")),
  ];
  return "﻿" + lines.join("\r\n");
}
