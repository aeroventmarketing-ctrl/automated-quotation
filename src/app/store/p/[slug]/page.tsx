import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { inStock, storeProductBySlug, listStoreProducts } from "@/lib/store-catalog";
import { getStoreTheme } from "@/lib/store-theme";
import { peso } from "@/lib/store-product";
import { jsonLd, productLd, breadcrumbLd, storeUrl, photoUrl } from "@/lib/store-seo";
import { WRAP, DISPLAY, KICKER } from "@/lib/store-ui";
import { ProductCard } from "../../product-card";
import { AddToCart } from "../../add-to-cart";
import { QuoteButton } from "../../store-actions";
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
  const subject = `${p.name} (${p.modelCode})`;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(productLd(p)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbLd(trail)) }} />

      <div className="bg-white">
        <div className={`${WRAP} py-10`}>
          <nav aria-label="Breadcrumb" className="text-[12px] text-[var(--store-steel)]">
            <Link href="/store" className="transition-colors hover:text-[var(--store-accent)]">Shop</Link>
            <span className="mx-2 text-[#c3ccd6]">/</span>
            <Link href={`/store/c/${p.categorySlug}`} className="transition-colors hover:text-[var(--store-accent)]">
              {p.category}
            </Link>
            <span className="mx-2 text-[#c3ccd6]">/</span>
            <span className="text-[var(--store-ink)]">{p.name}</span>
          </nav>

          <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-14">
            <Gallery photos={p.photos} name={p.name} category={p.category} fit={theme.imageFit} />

            {/* Buy box — sticks alongside the gallery on desktop. */}
            <div className="lg:sticky lg:top-28 lg:self-start">
              <div className={KICKER}>{p.category}</div>
              <h1 className={`${DISPLAY} mt-2 text-[34px] leading-none tracking-[-0.02em] sm:text-[42px]`}>{p.name}</h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 text-[12px] text-[#8a96a5]">
                <span>MODEL {p.modelCode}</span>
                {p.sizeLabel && <><span className="text-[#c3ccd6]">·</span><span>{p.sizeLabel}</span></>}
                <span className="text-[#c3ccd6]">·</span>
                <span>per {p.uom}</span>
              </div>

              <div className="mt-7">
                {p.quoteOnly ? (
                  <QuoteBox fabricated={p.fabricated} subject={subject} />
                ) : (
                  <div className="rounded-md border border-[var(--store-line)] bg-white p-5 shadow-[0_8px_28px_-16px_rgba(9,20,38,0.35)]">
                    <div className="flex items-baseline gap-2">
                      {p.variants.length > 1 && (
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--store-steel)]">from</span>
                      )}
                      <span className={`${DISPLAY} text-[36px] leading-none`}>{peso(p.variants[0].websitePrice)}</span>
                    </div>
                    <p className="mt-1.5 text-[12px] text-[var(--store-steel)]">
                      VAT-inclusive · online processing included
                    </p>

                    {p.variants.length > 1 && (
                      <ul className="mt-4 divide-y divide-[#edf0f2] overflow-hidden rounded border border-[var(--store-line)] text-[13px]">
                        {p.variants.map((v) => (
                          <li key={v.key} className="flex items-center justify-between bg-[#f8fafb] px-3.5 py-2.5">
                            <span>{v.label || "Standard"}</span>
                            <span className="font-bold tabular-nums">{peso(v.websitePrice)}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-5">
                      {available ? (
                        <>
                          <div className="mb-3 flex items-center gap-2 text-[12.5px] font-bold text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {p.available != null && p.available <= 5 ? `Only ${p.available} left in stock` : "In stock"}
                          </div>
                          <AddToCart slug={p.slug} name={p.name} variants={p.variants} max={p.available ?? undefined} />
                        </>
                      ) : (
                        <OutOfStockBox subject={subject} />
                      )}
                    </div>
                  </div>
                )}
              </div>

              <ul className="mt-6 space-y-2.5 text-[13px] text-[#536275]">
                <li><span aria-hidden className="mr-2 font-black text-[var(--store-accent)]">→</span>Nationwide delivery — scheduled once your order is confirmed</li>
                <li><span aria-hidden className="mr-2 font-black text-[var(--store-accent)]">✦</span>Secure checkout via card, GCash, Maya or PayPal</li>
                <li><span aria-hidden className="mr-2 font-black text-[var(--store-accent)]">⚙</span>Engineering support before and after you buy</li>
              </ul>
            </div>
          </div>

          {p.description && (
            <section className="mt-16 max-w-3xl border-t border-[var(--store-line)] pt-10">
              <h2 className={`${DISPLAY} text-[28px] leading-none`}>About this product</h2>
              <p className="mt-3.5 whitespace-pre-line leading-[1.85] text-[#536275]">{p.description}</p>
            </section>
          )}

          <section className="mt-12 max-w-3xl">
            <h2 className={`${DISPLAY} text-[28px] leading-none`}>Specifications</h2>
            <dl className="mt-4 divide-y divide-[#edf0f2] overflow-hidden rounded-md border border-[var(--store-line)] text-[13.5px]">
              <SpecRow label="Model code" value={p.modelCode} />
              <SpecRow label="Category" value={p.category} />
              {p.sizeLabel && <SpecRow label="Size" value={p.sizeLabel} />}
              <SpecRow label="Unit of measure" value={p.uom} />
              <SpecRow
                label="Availability"
                value={p.quoteOnly ? (p.fabricated ? "Made to order" : "On request") : available ? "In stock" : "Out of stock"}
              />
            </dl>
          </section>

          {related.length > 0 && (
            <section className="mt-16 border-t border-[var(--store-line)] pt-12">
              <div className="mb-6 flex items-end justify-between gap-4">
                <h2 className={`${DISPLAY} text-[30px] leading-none`}>More in {p.category}</h2>
                <Link
                  href={`/store/c/${p.categorySlug}`}
                  className="text-[13px] font-extrabold text-[var(--store-accent)] transition-opacity hover:opacity-70"
                >
                  View all →
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-[18px] min-[620px]:grid-cols-2 lg:grid-cols-4">
                {related.map((r) => <ProductCard key={r.id} product={r} theme={theme} />)}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-white px-4 py-3">
      <dt className="text-[var(--store-steel)]">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}

function QuoteBox({ fabricated, subject }: { fabricated: boolean; subject: string }) {
  return (
    <div className="rounded-md border border-[var(--store-line)] bg-gradient-to-b from-white to-[#f3f6f8] p-5">
      <div className={KICKER}>Engineering support</div>
      <h2 className={`${DISPLAY} mt-2 text-[26px] leading-none`}>
        {fabricated ? "Built to your specification" : "Price on request"}
      </h2>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-[#536275]">
        {fabricated
          ? "This unit is fabricated to your airflow, static pressure and configuration, so it's priced per project rather than sold at a list price. Send us the requirement and our engineers will size and quote it."
          : "Tell us the quantity and delivery point and we'll come back with a price."}
      </p>
      <QuoteButton
        subject={subject}
        className="mt-5 flex w-full items-center justify-center rounded-[5px] bg-[var(--store-accent)] px-5 py-3.5 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
      >
        Request a quotation →
      </QuoteButton>
    </div>
  );
}

function OutOfStockBox({ subject }: { subject: string }) {
  return (
    <div className="rounded border border-[var(--store-line)] bg-[#f3f6f8] p-4">
      <div className="text-[13.5px] font-extrabold">Out of stock</div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[#536275]">
        We can tell you when it&rsquo;s back, or quote an equivalent unit that&rsquo;s available now.
      </p>
      <QuoteButton
        subject={subject}
        className="mt-4 flex w-full items-center justify-center rounded-[5px] border border-[var(--store-accent)] px-4 py-3 text-[13.5px] font-extrabold text-[var(--store-accent)] transition-colors hover:bg-[var(--store-accent)]/5"
      >
        Enquire about this item
      </QuoteButton>
    </div>
  );
}
