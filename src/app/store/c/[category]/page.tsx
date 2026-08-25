import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { listStoreProducts, storeCategories, inStock, type StoreProduct } from "@/lib/store-catalog";
import { getStoreTheme } from "@/lib/store-theme";
import { jsonLd, itemListLd, breadcrumbLd, storeUrl } from "@/lib/store-seo";
import { COMPANY } from "@/lib/config";
import { ProductGrid } from "../../product-grid";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const cat = storeCategories(await listStoreProducts()).find((c) => c.slug === category);
  if (!cat) return { title: "Category not found" };
  const description = `${cat.label} from ${COMPANY.name} — ${cat.count} product${cat.count === 1 ? "" : "s"} available to order or quote, with nationwide delivery across the Philippines.`;
  return {
    title: cat.label,
    description,
    alternates: { canonical: storeUrl(`/c/${cat.slug}`) },
    openGraph: { type: "website", title: cat.label, description, url: storeUrl(`/c/${cat.slug}`) },
  };
}

export default async function StoreCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const [theme, products] = await Promise.all([getStoreTheme(), listStoreProducts()]);
  const cat = storeCategories(products).find((c) => c.slug === category);
  if (!cat) notFound();

  // Buyable first, then out of stock, then made-to-order.
  const shown = products
    .filter((p) => p.categorySlug === category)
    .sort((a, b) => {
      const rank = (p: StoreProduct) => (p.quoteOnly ? 2 : inStock(p) ? 0 : 1);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

  const trail = [
    { name: "Shop", url: storeUrl() },
    { name: cat.label, url: storeUrl(`/c/${cat.slug}`) },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(itemListLd(shown, storeUrl(`/c/${cat.slug}`), cat.label)) }}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbLd(trail)) }} />

      <div className="border-b border-slate-200 bg-slate-50/60">
        <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
            <Link href="/store" className="transition-colors hover:text-[var(--store-accent)]">Shop</Link>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
            <span className="text-slate-700">{cat.label}</span>
          </nav>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {cat.label}
          </h1>
          <p className="mt-2 text-[14.5px] text-slate-600">
            {shown.length} product{shown.length === 1 ? "" : "s"} · ordered online or quoted to specification
          </p>
        </div>
      </div>

      <section className="mx-auto max-w-7xl px-4 py-12 lg:px-8">
        <ProductGrid products={shown} theme={theme} />
      </section>
    </>
  );
}
