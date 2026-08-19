import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { websiteSellingPrice, isQuoteOnly, storeCategoryLabel, coerceStorePhotos } from "@/lib/store-product";
import { StoreProductsManager, type StoreRow } from "./store-products-manager";

export const dynamic = "force-dynamic";

/**
 * Store products (Phase A of store ⇄ ERP unification) — manage each catalogue
 * item's storefront listing (listed/draft, slug, category, description, photos)
 * on the same record that drives the ERP. The website price is DERIVED from the
 * AeroQuote price and shown read-only; fabricated fans are quote-only.
 */
export default async function StoreProductsPage() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) redirect("/dashboard");

  const items = await prisma.catalogueItem.findMany({
    where: { active: true },
    orderBy: [{ family: "asc" }, { name: "asc" }],
    include: { priceList: { where: { active: true }, orderBy: { effectiveDate: "desc" } } },
  });

  const rows: StoreRow[] = items.map((it) => {
    // Latest active price per variant; the "default" (or first) drives the display price.
    const byVariant = new Map<string, (typeof it.priceList)[number]>();
    for (const p of it.priceList) if (!byVariant.has(p.variantKey)) byVariant.set(p.variantKey, p);
    const priced = [...byVariant.values()];
    const def = priced.find((p) => p.variantKey === "default" || !p.variantKey) ?? priced[0];
    const aq = def ? Number(def.basePrice) : null;
    return {
      id: it.id,
      modelCode: it.modelCode,
      name: it.name,
      family: String(it.family),
      variants: priced.length,
      aeroquotePrice: aq != null && Number.isFinite(aq) ? aq : null,
      websitePrice: aq != null && Number.isFinite(aq) ? websiteSellingPrice(aq) : null,
      quoteOnly: isQuoteOnly(it.family),
      defaultCategory: storeCategoryLabel(it.family, it.storeCategory),
      storeListed: it.storeListed,
      storeSlug: it.storeSlug,
      storeCategory: it.storeCategory,
      storeDescription: it.storeDescription,
      storePhotos: coerceStorePhotos(it.storePhotos),
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Store products</h2>
        <p className="text-sm text-muted-foreground">
          The catalogue and the online store on one record. Toggle what&apos;s listed, set each product&apos;s slug,
          category, description and photos. The website price is derived from the AeroQuote price (÷&nbsp;0.95); fabricated
          fans are quote-only.
        </p>
      </div>
      <StoreProductsManager rows={rows} />
    </div>
  );
}
