"use client";

import Link from "next/link";
import { inStock, type StoreProduct } from "@/lib/store-catalog";
import { peso } from "@/lib/store-product";
import type { StoreTheme } from "@/lib/store-theme";
import { addToCart } from "./cart-store";
import { openQuotePanel, showToast } from "./ui-store";
import { FanPlaceholder, isBlowerCategory } from "./fan-placeholder";

export { peso };

/**
 * Product tile.
 *
 * The whole card navigates to the product page via a stretched link, with the
 * action button sitting above it — a `<button>` can't legally live inside an
 * `<a>`, and this keeps one large, obvious hit target for the card while the
 * "+" still adds to the cart in place.
 *
 * The photo sits in a fixed-height frame so the grid never shifts as images
 * load (CLS is a ranking signal as well as an annoyance), and only the first
 * row is eager-loaded.
 */
export function ProductCard({
  product,
  theme,
  priority = false,
}: {
  product: StoreProduct;
  theme: StoreTheme;
  priority?: boolean;
}) {
  const photo = product.photos[0];
  const available = inStock(product);
  const fit = theme.imageFit === "contain" ? "object-contain p-6" : "object-cover";
  const variant = product.variants[0];

  function add() {
    if (!variant) return;
    addToCart(product.slug, variant.key, 1);
    showToast(`${product.name} added to cart`);
  }

  return (
    <article className="group relative overflow-hidden rounded-md border border-[var(--store-line)] bg-white transition-all duration-[250ms] hover:-translate-y-1 hover:shadow-[0_18px_60px_rgba(9,20,38,0.12)]">
      <div className="relative grid h-[225px] place-items-center overflow-hidden bg-gradient-to-br from-[#edf1f4] to-[#d7dee5]">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/store-image?path=${encodeURIComponent(photo.path)}`}
            alt={photo.alt || `${product.name} — ${product.category}`}
            className={`h-full w-full ${fit} transition-transform duration-500 group-hover:scale-[1.04]`}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : "auto"}
          />
        ) : (
          <>
            <FanPlaceholder blower={isBlowerCategory(product.category)} />
            <span className="absolute bottom-2.5 left-3 text-[9px] uppercase tracking-[0.1em] text-[#6e7d8b]">
              {product.modelCode}
            </span>
          </>
        )}

        <Badge product={product} available={available} />
      </div>

      <div className="p-[17px]">
        <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--store-accent)]">
          {product.category}
        </div>
        <h3 className="my-[7px] min-h-[43px] text-[14px] font-semibold leading-[1.5] text-[var(--store-ink)] transition-colors group-hover:text-[var(--store-accent)]">
          <Link href={`/store/p/${product.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {product.name}
          </Link>
        </h3>
        <div className="text-[10px] text-[#8a96a5]">MODEL {product.modelCode}</div>

        <div className="mt-3.5 flex items-end justify-between gap-2 border-t border-[#edf0f2] pt-3.5">
          <div className="font-[family-name:var(--font-display)] text-[24px] font-bold leading-none text-[var(--store-ink)]">
            {product.quoteOnly ? (
              <span className="text-[19px]">{product.fabricated ? "Custom quote" : "On request"}</span>
            ) : (
              <>
                {product.variants.length > 1 && (
                  <span className="mr-1 font-[family-name:var(--font-body)] text-[10px] font-medium uppercase text-[var(--store-steel)]">
                    from
                  </span>
                )}
                {peso(product.fromPrice ?? 0)}{" "}
                <small className="font-[family-name:var(--font-body)] text-[10px] font-medium text-[var(--store-steel)]">
                  VAT incl.
                </small>
              </>
            )}
          </div>

          {product.quoteOnly || !available ? (
            <button
              type="button"
              onClick={() => openQuotePanel(`${product.name} (${product.modelCode})`)}
              className="relative z-10 h-[38px] shrink-0 rounded bg-[var(--store-ink)] px-3 text-[11px] font-extrabold text-white transition-opacity hover:opacity-90"
            >
              {available || product.quoteOnly ? "Request quote" : "Enquire"}
            </button>
          ) : (
            <button
              type="button"
              onClick={add}
              aria-label={`Add ${product.name} to cart`}
              className="relative z-10 h-[38px] w-[38px] shrink-0 rounded bg-[var(--store-accent)] text-[19px] leading-none text-white transition-colors hover:bg-[var(--store-accent-dark)]"
            >
              +
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** Stock / availability flag in the corner of the media frame. */
function Badge({ product, available }: { product: StoreProduct; available: boolean }) {
  const base =
    "absolute left-3 top-3 z-[2] rounded-[3px] px-2 py-1.5 text-[9px] font-black uppercase tracking-[0.08em] text-white";
  if (product.quoteOnly)
    return <span className={`${base} bg-[var(--store-accent)]`}>{product.fabricated ? "Made to order" : "On request"}</span>;
  if (!available) return <span className={`${base} bg-[#607084]`}>Out of stock</span>;
  if (product.available != null && product.available <= 5)
    return <span className={`${base} bg-[#c2790b]`}>Only {product.available} left</span>;
  return <span className={`${base} bg-[var(--store-ink)]`}>In catalogue</span>;
}
