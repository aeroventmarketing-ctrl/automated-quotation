/**
 * Server-side product catalogue helpers (no "use server" — internal use). Reads
 * the Product table and auto-saves products typed on the material request form.
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

/**
 * Auto-save a product typed on the material request form. Adds it (with a SKU)
 * only when no active product with that name exists yet; never overwrites. The
 * new product starts with no supplier — the purchaser attaches suppliers later.
 */
export async function rememberProduct(name: string, unit?: string): Promise<void> {
  const n = (name ?? "").trim();
  if (!n) return;
  const existing = await prisma.product.findFirst({ where: { active: true, name: { equals: n, mode: "insensitive" } } });
  if (existing) return;
  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction to avoid a duplicate race.
    const dup = await tx.product.findFirst({ where: { active: true, name: { equals: n, mode: "insensitive" } } });
    if (dup) return;
    const sku = await nextProductSku(tx);
    await tx.product.create({ data: { name: n, unit: (unit ?? "").trim() || "pcs", sku } });
  });
}
