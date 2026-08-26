import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listStoreProducts, storeCategories, inStock, type StoreProduct } from "@/lib/store-catalog";
import { getStoreTheme } from "@/lib/store-theme";
import { jsonLd, itemListLd, breadcrumbLd, storeUrl } from "@/lib/store-seo";
import { WRAP, DISPLAY, KICKER } from "@/lib/store-ui";
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

      <div className="bg-[linear-gradient(115deg,#07101f_0%,#101c30_58%,#26111b_100%)] text-white">
        <div className={`${WRAP} py-14`}>
          <nav aria-label="Breadcrumb" className="text-[12px] text-[#8998aa]">
            <Link href="/store" className="transition-colors hover:text-white">Shop</Link>
            <span className="mx-2 text-white/25">/</span>
            <span className="text-white/80">{cat.label}</span>
          </nav>
          <div className={`${KICKER} mt-4`}>Industrial-grade equipment</div>
          <h1 className={`${DISPLAY} mt-2 text-[clamp(38px,5vw,56px)] leading-none tracking-[-0.02em]`}>{cat.label}</h1>
          <p className="mt-3 text-[14px] text-[#b9c4d2]">
            {shown.length} product{shown.length === 1 ? "" : "s"} · ordered online or quoted to specification
          </p>
        </div>
      </div>

      <section className="bg-white py-[60px]">
        <div className={WRAP}>
          <ProductGrid products={shown} theme={theme} />
        </div>
      </section>
    </>
  );
}
