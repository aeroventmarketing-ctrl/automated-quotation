/**
 * "Office / resale" products — finished goods the company buys and resells, not
 * fabricated in-house. A sale of one of these is booked entirely to the Office
 * profit centre (sale + supplier cost), never to a production department, in the
 * Departmental P&L — regardless of the product's technical category.
 *
 * Stored as a set of Product IDs in the AppSetting key/value table (no schema
 * change), mirroring the sales-personnel / marketing-list flags.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const OFFICE_RESALE_KEY = "office_resale_products";

export async function getOfficeResaleProductIds(): Promise<string[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: OFFICE_RESALE_KEY } }).catch(() => null);
  const v = (row?.value as { productIds?: unknown } | null) ?? null;
  return v && Array.isArray(v.productIds) ? v.productIds.filter((x): x is string => typeof x === "string") : [];
}

export async function setOfficeResaleProduct(productId: string, on: boolean): Promise<string[]> {
  const cur = new Set(await getOfficeResaleProductIds());
  if (on) cur.add(productId);
  else cur.delete(productId);
  const productIds = [...cur];
  await prisma.appSetting.upsert({
    where: { key: OFFICE_RESALE_KEY },
    create: { key: OFFICE_RESALE_KEY, value: { productIds } as Prisma.InputJsonValue },
    update: { value: { productIds } as Prisma.InputJsonValue },
  });
  return productIds;
}
