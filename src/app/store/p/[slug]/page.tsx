import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck, Truck, Headset, FileText, ChevronRight } from "lucide-react";
import { inStock, storeProductBySlug, listStoreProducts } from "@/lib/store-catalog";
import { getStoreTheme } from "@/lib/store-theme";
import { jsonLd, productLd, breadcrumbLd, storeUrl, photoUrl } from "@/lib/store-seo";
import { peso, ProductCard } from "../../product-card";
import { AddToCart } from "../../add-to-cart";
import { Gallery } from "./gallery";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await storeProductBySlug(slug);
  if (!p) return { title: "Product not found" };

  const priceNote = p.fromPrice != null ? ` from ${peso(p.fromPrice)}.` : ".";
  const description =
    p.description?.slice(0, 300) ??
    `${p.name} (${p.modelCode}) — ${p.category} supplied by Aerovent Fans & Blowers Manufacturing, Philippines${priceNote}`;

  return {
    title: p.name,
    description,
    alternates: { canonical: storeUrl(`/p/${p.slug}`) },
    openGraph: {
      type: "website",
      title: p.name,
      description,
      url: storeUrl(`/p/${p.slug}`),
      images: p.photos.slice(0, 1).map((ph) => ({ url: photoUrl(ph.path), alt: p.name })),
    },
  };
}

export default async function StoreProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [p, theme] = await Promise.all([storeProductBySlug(slug), getStoreTheme()]);
  if (!p) notFound();

  const available = inStock(p);
  const related = (await listStoreProducts())
    .filter((r) => r.categorySlug === p.categorySlug && r.id !== p.id)
    .slice(0, 4);

  const trail = [
    { name: "Shop", url: storeUrl() },
    { name: p.category, url: storeUrl(`/c/${p.categorySlug}`) },
    { name: p.name, url: storeUrl(`/p/${p.slug}`) },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(productLd(p)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbLd(trail)) }} />

      <div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
          <Link href="/store" className="transition-colors hover:text-[var(--store-accent)]">Shop</Link>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
          <Link href={`/store/c/${p.categorySlug}`} className="transition-colors hover:text-[var(--store-accent)]">
            {p.category}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
          <span className="truncate text-slate-700">{p.name}</span>
        </nav>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-14">
          <Gallery photos={p.photos} name={p.name} fit={theme.imageFit} />

          {/* Buy box — sticks alongside the gallery on desktop. */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{p.category}</div>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-[26px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[32px]">
              {p.name}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
              <span className="font-mono">{p.modelCode}</span>
              {p.sizeLabel && <><span className="text-slate-300">·</span><span>{p.sizeLabel}</span></>}
              <span className="text-slate-300">·</span>
              <span>per {p.uom}</span>
            </div>

            <div className="mt-7">
              {p.quoteOnly ? (
                <QuoteBox fabricated={p.fabricated} />
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_14px_-6px_rgba(15,23,42,0.12)]">
                  <div className="flex items-baseline gap-2">
                    {p.variants.length > 1 && (
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">from</span>
                    )}
                    <span className="font-[family-name:var(--font-display)] text-[30px] font-extrabold tracking-tight text-slate-900">
                      {peso(p.variants[0].websitePrice)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-500">VAT-inclusive · online processing included</p>

                  {p.variants.length > 1 && (
                    <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 text-[13.5px]">
                      {p.variants.map((v) => (
                        <li key={v.key} className="flex items-center justify-between bg-slate-50/50 px-3.5 py-2.5">
                          <span className="text-slate-700">{v.label || "Standard"}</span>
                          <span className="font-semibold tabular-nums text-slate-900">{peso(v.websitePrice)}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-5">
                    {available ? (
                      <>
                        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {p.available != null && p.available <= 5 ? `Only ${p.available} left in stock` : "In stock"}
                        </div>
                        <AddToCart slug={p.slug} variants={p.variants} max={p.available ?? undefined} />
                      </>
                    ) : (
                      <OutOfStockBox />
                    )}
                  </div>
                </div>
              )}
            </div>

            <ul className="mt-6 grid gap-3 text-[13px] text-slate-600">
              <TrustRow icon={Truck} text="Nationwide delivery — scheduled after your order is confirmed" />
              <TrustRow icon={ShieldCheck} text="Secure checkout via card, GCash, Maya or PayPal" />
              <TrustRow icon={Headset} text="Engineering support before and after you buy" />
            </ul>
          </div>
        </div>

        {p.description && (
          <section className="mt-16 max-w-3xl border-t border-slate-200 pt-10">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-extrabold tracking-tight text-slate-900">
              About this product
            </h2>
            <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.description}</p>
          </section>
        )}

        <section className="mt-14 max-w-3xl">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-extrabold tracking-tight text-slate-900">
            Specifications
          </h2>
          <dl className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 text-[13.5px]">
            <SpecRow label="Model code" value={p.modelCode} mono />
            <SpecRow label="Category" value={p.category} />
            {p.sizeLabel && <SpecRow label="Size" value={p.sizeLabel} />}
            <SpecRow label="Unit of measure" value={p.uom} />
            <SpecRow
              label="Availability"
              value={p.quoteOnly ? "Made to order" : available ? "In stock" : "Out of stock"}
            />
          </dl>
        </section>

        {related.length > 0 && (
          <section className="mt-16 border-t border-slate-200 pt-12">
            <div className="mb-6 flex items-end justify-between gap-4">
              <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold tracking-tight text-slate-900">
                More in {p.category}
              </h2>
              <Link
                href={`/store/c/${p.categorySlug}`}
                className="text-[13px] font-semibold text-[var(--store-accent)] transition-opacity hover:opacity-70"
              >
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
              {related.map((r) => <ProductCard key={r.id} product={r} theme={theme} />)}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function TrustRow({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <span>{text}</span>
    </li>
  );
}

function SpecRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-white px-4 py-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right font-medium text-slate-900 ${mono ? "font-mono text-[12.5px]" : ""}`}>{value}</dd>
    </div>
  );
}

function QuoteBox({ fabricated }: { fabricated: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-5">
      <FileText className="h-5 w-5 text-[var(--store-accent)]" />
      <h2 className="mt-3 font-[family-name:var(--font-display)] text-[16px] font-bold text-slate-900">
        {fabricated ? "Built to your specification" : "Price on request"}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
        {fabricated
          ? "This unit is fabricated to your airflow, static pressure and configuration, so it's priced per project rather than sold at a list price. Send us the requirement and our engineers will size and quote it."
          : "Tell us the quantity and delivery point and we'll come back with a price."}
      </p>
      <Link
        href="/rfq"
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--store-accent)] px-5 py-3 text-[14px] font-bold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
      >
        Request a quotation
      </Link>
    </div>
  );
}

function OutOfStockBox() {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-[13.5px] font-bold text-slate-800">Out of stock</div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
        We can tell you when it&rsquo;s back, or quote an equivalent unit that&rsquo;s available now.
      </p>
      <Link
        href="/rfq"
        className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-[var(--store-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--store-accent)] transition-colors hover:bg-[var(--store-accent)]/5"
      >
        Enquire about this item
      </Link>
    </div>
  );
}
