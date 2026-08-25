import type { StoreProduct } from "@/lib/store-catalog";
import type { StoreTheme } from "@/lib/store-theme";
import { ProductCard } from "./product-card";

/** Responsive product grid. The first row is eager-loaded for a fast LCP. */
export function ProductGrid({ products, theme }: { products: StoreProduct[]; theme: StoreTheme }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} theme={theme} priority={i < 4} />
      ))}
    </div>
  );
}
