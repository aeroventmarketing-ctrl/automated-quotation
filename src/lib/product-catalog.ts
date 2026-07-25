/**
 * Server-side product catalogue helpers (no "use server" — internal use). Reads
 * the Product table. Products are added only by the Purchaser or an admin on the
 * Products page (with a supplier and price) — nothing is auto-saved from forms.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { coerceProductSuppliers, type ProductSupplierLink } from "@/lib/products";

export interface ProductRow {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  category: string | null;
  note: string | null;
  suppliers: ProductSupplierLink[];
}

/** Claim the next product SKU (e.g. "PRD10001"). Runs inside a transaction. */
export async function nextProductSku(tx: Prisma.TransactionClient): Promise<string> {
  const KEY = "product_sku_counter";
  const row = await tx.appSetting.findUnique({ where: { key: KEY } });
  const cur = typeof (row?.value as { n?: unknown } | null)?.n === "number" ? (row!.value as { n: number }).n : 10000;
  const n = cur + 1;
  await tx.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: { n } as Prisma.InputJsonValue },
    update: { value: { n } as Prisma.InputJsonValue },
  });
  return `PRD${n}`;
}

/** All active products, alphabetically, with their supplier links. */
export async function getProducts(): Promise<ProductRow[]> {
  const list = await prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return list.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    category: p.category,
    note: p.note,
    suppliers: coerceProductSuppliers(p.suppliers),
  }));
}
