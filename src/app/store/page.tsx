import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Factory, Truck, Wrench, ShieldCheck, Headset, Check, PackageSearch } from "lucide-react";
import { listStoreProducts, storeCategories, inStock, type StoreProduct } from "@/lib/store-catalog";
import { getStoreTheme, type StoreTheme } from "@/lib/store-theme";
import { jsonLd, itemListLd, storeUrl } from "@/lib/store-seo";
import { ProductGrid } from "./product-grid";
import { StoreSearch } from "./store-search";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const theme = await getStoreTheme();
  if (q?.trim()) {
    return {
      title: `Search: ${q.trim()}`,
      description: `Catalogue results for “${q.trim()}” — fans, blowers and ventilation equipment.`,
      // A search page has no canonical value of its own.
      robots: { index: false, follow: true },
    };
  }
  return { title: theme.seoTitle, description: theme.seoDescription, alternates: { canonical: storeUrl() } };
}

const FEATURE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  factory: Factory, truck: Truck, wrench: Wrench, shield: ShieldCheck, support: Headset, check: Check,
};

/** Match a product against a free-text query (name, model code, category). */
function matches(p: StoreProduct, q: string): boolean {
  const hay = `${p.name} ${p.modelCode} ${p.category} ${p.description ?? ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

export default async function StoreHome({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const [theme, all] = await Promise.all([getStoreTheme(), listStoreProducts()]);
  const categories = storeCategories(all);
  const products = query ? all.filter((p) => matches(p, query)) : all;

  // Buyable items lead the grid — a shopper should meet something they can
  // actually put in a basket before the made-to-order units.
  const sorted = [...products].sort((a, b) => {
    const rank = (p: StoreProduct) => (p.quoteOnly ? 2 : inStock(p) ? 0 : 1);
    return rank(a) - rank(b);
  });

  if (query) return <SearchResults theme={theme} query={query} results={sorted} />;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(itemListLd(sorted, storeUrl(), "Aerovent product catalogue")) }}
      />

      <Hero theme={theme} productCount={all.length} />
      <Features theme={theme} />

      {categories.length > 1 && <CategoryStrip categories={categories} />}

      <section id="products" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16 lg:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              The catalogue
            </h2>
            <p className="mt-1.5 text-[14px] text-slate-600">
              {all.length > 0
                ? `${all.length} product${all.length === 1 ? "" : "s"} available to order or quote.`
                : "Products appear here as soon as they're listed."}
            </p>
          </div>
          <div className="w-full sm:w-72 md:hidden"><StoreSearch /></div>
        </div>

        {sorted.length === 0 ? <EmptyCatalogue /> : <ProductGrid products={sorted} theme={theme} />}
      </section>

      <QuoteBanner />
    </>
  );
}

/* ---------------------------------------------------------------- sections */

function Hero({ theme, productCount }: { theme: StoreTheme; productCount: number }) {
  const hasImage = theme.heroImagePath.trim() !== "";
  return (
    <section className="relative overflow-hidden bg-[var(--store-ink)]">
      {hasImage && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/store-image?path=${encodeURIComponent(theme.heroImagePath)}`}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover opacity-30"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--store-ink)] via-[var(--store-ink)]/85 to-transparent" />
        </>
      )}
      {!hasImage && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
      )}
      {/* Accent wash, so the brand colour is present without shouting. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full opacity-25 blur-3xl"
        style={{ background: "var(--store-accent)" }}
      />

      <div className="relative mx-auto max-w-7xl px-4 py-20 sm:py-28 lg:px-8">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/90 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--store-accent)]" />
            Philippine manufacturer since 1994
          </span>

          <h1 className="mt-6 font-[family-name:var(--font-display)] text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
            {theme.heroHeadline}
          </h1>

          <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-white/70 sm:text-[17px]">{theme.heroSubhead}</p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={theme.heroCtaHref}
              className="group inline-flex items-center gap-2 rounded-full bg-[var(--store-accent)] px-6 py-3.5 text-[14.5px] font-bold text-white shadow-lg shadow-[var(--store-accent)]/25 transition-all hover:bg-[var(--store-accent-dark)] hover:shadow-xl"
            >
              {theme.heroCtaLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/rfq"
              className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              Request a quotation
            </Link>
          </div>

          {productCount > 0 && (
            <p className="mt-7 text-[12.5px] text-white/45">
              {productCount} product{productCount === 1 ? "" : "s"} listed · Nationwide delivery · VAT-inclusive pricing
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Features({ theme }: { theme: StoreTheme }) {
  return (
    <section className="border-b border-slate-200 bg-slate-50/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:grid-cols-2 lg:grid-cols-3 lg:px-8">
        {theme.features.map((f) => {
          const Icon = FEATURE_ICONS[f.icon] ?? Check;
          return (
            <div key={f.title} className="flex gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--store-accent)] shadow-sm ring-1 ring-slate-200">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-[family-name:var(--font-display)] text-[15px] font-bold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">{f.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CategoryStrip({ categories }: { categories: { slug: string; label: string; count: number }[] }) {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-14 lg:px-8">
      <h2 className="font-[family-name:var(--font-display)] text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
        Browse by category
      </h2>
      <div className="mt-4 flex flex-wrap gap-2.5">
        {categories.map((c) => (
          <Link
            key={c.slug}
            href={`/store/c/${c.slug}`}
            className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 transition-all hover:-translate-y-0.5 hover:border-[var(--store-accent)] hover:text-[var(--store-accent)] hover:shadow-sm"
          >
            {c.label}
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 transition-colors group-hover:bg-[var(--store-accent)]/10 group-hover:text-[var(--store-accent)]">
              {c.count}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function EmptyCatalogue() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 py-20 text-center">
      <PackageSearch className="mx-auto h-9 w-9 text-slate-300" />
      <p className="mt-4 font-[family-name:var(--font-display)] text-[15px] font-bold text-slate-900">
        No products are listed yet
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-slate-500">
        List them in Admin → Store products and they appear here automatically.
      </p>
      <Link
        href="/rfq"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--store-accent)] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
      >
        Request a quotation instead
      </Link>
    </div>
  );
}

function SearchResults({ theme, query, results }: { theme: StoreTheme; query: string; results: StoreProduct[] }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-[12.5px] text-slate-500">
        <Link href="/store" className="transition-colors hover:text-[var(--store-accent)]">Shop</Link>
        <span className="mx-1.5 text-slate-300">/</span>
        <span className="text-slate-700">Search</span>
      </nav>

      <h1 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
        “{query}”
      </h1>
      <p className="mt-1.5 text-[14px] text-slate-600">
        {results.length} result{results.length === 1 ? "" : "s"}
      </p>

      <div className="mt-6 max-w-md"><StoreSearch autoFocus /></div>

      <div className="mt-8">
        {results.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
            <PackageSearch className="mx-auto h-9 w-9 text-slate-300" />
            <p className="mt-4 font-[family-name:var(--font-display)] text-[15px] font-bold text-slate-900">
              Nothing matched “{query}”
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-slate-500">
              Try a model code or a broader term — or tell us what you need and we&rsquo;ll quote it.
            </p>
            <Link
              href="/rfq"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--store-accent)] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
            >
              Request a quotation
            </Link>
          </div>
        ) : (
          <ProductGrid products={results} theme={theme} />
        )}
      </div>
    </section>
  );
}

function QuoteBanner() {
  return (
    <section className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-4 py-16 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="max-w-2xl">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-slate-900">
            Can&rsquo;t find the exact unit?
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
            Most of what we build doesn&rsquo;t sit on a shelf. Send us the airflow, static pressure and application, and
            our engineers will size it and quote it — usually within the working day.
          </p>
        </div>
        <Link
          href="/rfq"
          className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--store-ink)] px-6 py-3.5 text-[14.5px] font-bold text-white transition-all hover:bg-slate-800"
        >
          Request a quotation
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
}
