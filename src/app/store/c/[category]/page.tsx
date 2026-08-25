import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listStoreProducts, storeCategories } from "@/lib/store-catalog";
import { ProductCard } from "../../product-card";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const cat = storeCategories(await listStoreProducts()).find((c) => c.slug === category);
  return { title: cat ? `${cat.label} — Aerovent Fans & Blowers` : "Shop — Aerovent Fans & Blowers" };
}

/** One storefront category — every listed product whose category matches. */
export default async function StoreCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const products = await listStoreProducts();
  const cat = storeCategories(products).find((c) => c.slug === category);
  if (!cat) notFound();

  const shown = products.filter((p) => p.categorySlug === category);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{cat.label}</h1>
        <p className="text-sm text-gray-600">{shown.length} product{shown.length === 1 ? "" : "s"}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}
