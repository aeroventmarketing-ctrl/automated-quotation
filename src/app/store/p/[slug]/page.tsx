import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { inStock, storeProductBySlug } from "@/lib/store-catalog";
import { peso } from "../../product-card";
import { AddToCart } from "../../add-to-cart";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await storeProductBySlug(slug);
  return {
    title: p ? `${p.name} — Aerovent Fans & Blowers` : "Product — Aerovent Fans & Blowers",
    description: p?.description ?? undefined,
  };
}

/**
 * Product detail. A priced item shows its variants and price; a fabricated
 * (quote-only) fan shows no price and routes the visitor to Request a Quotation.
 */
export default async function StoreProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await storeProductBySlug(slug);
  if (!p) notFound();

  return (
    <div className="space-y-6">
      <nav className="text-xs text-gray-500">
        <Link href="/store" className="hover:text-[#ED1C24]">Shop</Link>
        <span className="mx-1">/</span>
        <Link href={`/store/c/${p.categorySlug}`} className="hover:text-[#ED1C24]">{p.category}</Link>
      </nav>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Photos */}
        <div className="space-y-2">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-gray-50">
            {p.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/store-image?path=${encodeURIComponent(p.photos[0].path)}`}
                alt={p.photos[0].alt || p.name}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-sm text-gray-400">No photo yet</span>
            )}
          </div>
          {p.photos.length > 1 && (
            <div className="grid grid-cols-4 gap-2">
              {p.photos.slice(1, 5).map((ph) => (
                <div key={ph.path} className="flex aspect-square items-center justify-center overflow-hidden rounded border bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/store-image?path=${encodeURIComponent(ph.path)}`}
                    alt={ph.alt || p.name}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{p.category}</div>
            <h1 className="text-xl font-bold sm:text-2xl">{p.name}</h1>
            <div className="mt-1 text-xs text-gray-500">
              Model {p.modelCode}{p.sizeLabel ? ` · ${p.sizeLabel}` : ""} · per {p.uom}
            </div>
          </div>

          {p.quoteOnly ? (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">Made to order — quoted by specification</div>
              <p className="text-sm text-amber-900/80">
                This is a fabricated fan built to your airflow, static pressure and configuration, so it is priced per
                project rather than sold at a list price. Send us the requirement and our engineers will prepare a
                quotation.
              </p>
              <Link
                href="/rfq"
                className="inline-block rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#c2141a]"
              >
                Request a Quotation
              </Link>
            </div>
          ) : p.variants.length > 0 ? (
            <div className="space-y-3">
              <div className="text-2xl font-bold text-[#ED1C24]">
                {p.variants.length > 1 && <span className="mr-1 text-sm font-normal text-gray-500">from</span>}
                {peso(p.variants[0].websitePrice)}
              </div>
              {p.variants.length > 1 && (
                <ul className="divide-y rounded-md border text-sm">
                  {p.variants.map((v) => (
                    <li key={v.key} className="flex items-center justify-between px-3 py-2">
                      <span>{v.label || "Standard"}</span>
                      <span className="font-semibold tabular-nums">{peso(v.websitePrice)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-gray-500">Price is VAT-inclusive and covers online processing.</p>
              {inStock(p) ? (
                <>
                  {p.available != null && p.available <= 5 && (
                    <p className="text-xs font-medium text-amber-700">Only {p.available} left in stock.</p>
                  )}
                  <AddToCart slug={p.slug} variants={p.variants} max={p.available ?? undefined} />
                </>
              ) : (
                <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="text-sm font-semibold text-gray-700">Out of stock</div>
                  <p className="text-sm text-gray-600">
                    This item isn&rsquo;t available right now. Send us a request and we&rsquo;ll tell you when it&rsquo;s
                    back, or quote you an alternative.
                  </p>
                  <Link href="/rfq" className="inline-block rounded-md border border-[#ED1C24] px-3 py-1.5 text-sm font-semibold text-[#ED1C24] hover:bg-[#ED1C24]/10">
                    Enquire about this item
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="text-sm font-medium">Price on request</div>
              <Link
                href="/rfq"
                className="inline-block rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#c2141a]"
              >
                Request a Quotation
              </Link>
            </div>
          )}

          {p.description && (
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Description</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{p.description}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
