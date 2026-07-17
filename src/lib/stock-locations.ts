/**
 * Managed list of warehouse stock locations (bins/shelves). Admin edits the list;
 * the Inventory location field then becomes a dropdown. Stored in the AppSetting
 * key/value table (no migration).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const STOCK_LOCATIONS_KEY = "stock_locations";

/** The configured locations (deduped, trimmed, in saved order). */
export async function getStockLocations(): Promise<string[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: STOCK_LOCATIONS_KEY } });
  const v = (row?.value as { locations?: unknown } | null)?.locations;
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((s) => s.trim());
}

/** Replace the location list (deduped, trimmed). Returns what was stored. */
export async function setStockLocations(locations: string[]): Promise<string[]> {
  const clean: string[] = [];
  for (const raw of locations) {
    const s = (raw ?? "").trim();
    if (s && !clean.includes(s)) clean.push(s);
  }
  await prisma.appSetting.upsert({
    where: { key: STOCK_LOCATIONS_KEY },
    create: { key: STOCK_LOCATIONS_KEY, value: { locations: clean } as Prisma.InputJsonValue },
    update: { value: { locations: clean } as Prisma.InputJsonValue },
  });
  return clean;
}
