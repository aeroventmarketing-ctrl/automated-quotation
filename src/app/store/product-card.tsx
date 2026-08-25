import Link from "next/link";
import { inStock, type StoreProduct } from "@/lib/store-catalog";

/** Peso formatting for storefront prices. */
export const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Grid card for one listed product — photo, name, and price (or a quote badge). */
export function ProductCard({ product }: { product: StoreProduct }) {
  const photo = product.photos[0];
  return (
    <Link
      href={`/store/p/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border transition-shadow hover:shadow-md"
    >
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-gray-50">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/store-image?path=${encodeURIComponent(photo.path)}`}
            alt={photo.alt || product.name}
            className="h-full w-full object-contain transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <span className="px-3 text-center text-xs text-gray-400">{product.modelCode}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">{product.category}</div>
        <div className="text-sm font-medium leading-snug group-hover:text-[#ED1C24]">{product.name}</div>
        <div className="mt-auto pt-1">
          {product.quoteOnly ? (
            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              Quote on request
            </span>
          ) : !inStock(product) ? (
            <span className="inline-block rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600">
              Out of stock
            </span>
          ) : product.fromPrice != null ? (
            <span className="text-sm font-bold text-[#ED1C24]">
              {product.variants.length > 1 && <span className="mr-1 text-xs font-normal text-gray-500">from</span>}
              {peso(product.fromPrice)}
            </span>
          ) : (
            <span className="text-xs text-gray-500">Price on request</span>
          )}
        </div>
      </div>
    </Link>
  );
}
