import type { MetadataRoute } from "next";
import { listStoreProducts, storeCategories } from "@/lib/store-catalog";
import { siteOrigin, storeUrl } from "@/lib/store-seo";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

/**
 * Sitemap for the public surfaces only — the storefront, its categories and
 * every listed product. The signed-in ERP is deliberately absent (it's behind
 * auth and must never be indexed).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const products = await listStoreProducts().catch(() => []);
  const categories = storeCategories(products);

  return [
    { url: siteOrigin(), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: storeUrl(), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${siteOrigin()}/rfq`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...categories.map((c) => ({
      url: storeUrl(`/c/${c.slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((p) => ({
      url: storeUrl(`/p/${p.slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
