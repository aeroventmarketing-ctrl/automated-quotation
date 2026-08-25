import Link from "next/link";
import { inStock, type StoreProduct } from "@/lib/store-catalog";
import type { StoreTheme } from "@/lib/store-theme";

/** Peso formatting for storefront prices. */
export const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Product tile. The photo sits in a fixed-ratio frame so the grid never shifts
 * as images load (CLS is a ranking signal as well as an annoyance), and only the
 * first row is eager-loaded.
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
  const fit = theme.imageFit === "cover" ? "object-cover" : "object-contain";

  return (
    <Link
      href={`/store/p/${product.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_32px_-12px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--store-accent)]/40"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-b from-slate-50 to-slate-100/70">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/store-image?path=${encodeURIComponent(photo.path)}`}
            alt={photo.alt || `${product.name} — ${product.category}`}
            className={`h-full w-full ${fit} p-5 transition-transform duration-500 group-hover:scale-[1.04]`}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : "auto"}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4">
            <span className="font-[family-name:var(--font-display)] text-xs font-bold uppercase tracking-[0.16em] text-slate-300">
              {product.modelCode}
            </span>
          </div>
        )}

        {product.quoteOnly ? (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200">
            {product.fabricated ? "Made to order" : "On request"}
          </span>
        ) : !available ? (
          <span className="absolute left-3 top-3 rounded-full bg-slate-900/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
            Out of stock
          </span>
        ) : product.available != null && product.available <= 5 ? (
          <span className="absolute left-3 top-3 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
            Only {product.available} left
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 border-t border-slate-100 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{product.category}</div>
        <h3 className="font-[family-name:var(--font-display)] text-[14.5px] font-bold leading-snug text-slate-900 transition-colors group-hover:text-[var(--store-accent)]">
          {product.name}
        </h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          {product.quoteOnly ? (
            <span className="text-[13px] font-semibold text-slate-600">Request a quote</span>
          ) : product.fromPrice != null ? (
            <span className="font-[family-name:var(--font-display)] text-[17px] font-extrabold tracking-tight text-slate-900">
              {product.variants.length > 1 && (
                <span className="mr-1 align-middle text-[10px] font-semibold uppercase tracking-wide text-slate-400">from</span>
              )}
              {peso(product.fromPrice)}
            </span>
          ) : (
            <span className="text-[13px] font-semibold text-slate-600">Price on request</span>
          )}
          <span className="text-[11px] font-mono text-slate-400">{product.modelCode}</span>
        </div>
      </div>
    </Link>
  );
}
