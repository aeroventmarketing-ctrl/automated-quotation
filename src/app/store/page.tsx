import Link from "next/link";
import { listStoreProducts, storeCategories } from "@/lib/store-catalog";
import { ProductCard } from "./product-card";

export const dynamic = "force-dynamic";

/** Storefront home — every listed product, with the category shortcuts above it. */
export default async function StoreHome() {
  const products = await listStoreProducts();
  const categories = storeCategories(products);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-gray-50 p-6">
        <h1 className="text-xl font-bold sm:text-2xl">Ventilation &amp; air-moving equipment</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Order stocked items online at listed prices. Fabricated fans and blowers are built to your specification —
          send us the requirement and our engineers will quote it.
        </p>
      </section>

      {products.length === 0 ? (
        <div className="rounded-lg border py-16 text-center">
          <p className="text-sm text-gray-600">No products are listed yet.</p>
          <p className="mt-1 text-xs text-gray-500">
            List them in Admin → Store products, then they appear here automatically.
          </p>
        </div>
      ) : (
        <>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/store/c/${c.slug}`}
                  className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:border-[#ED1C24] hover:text-[#ED1C24]"
                >
                  {c.label} <span className="text-xs text-gray-500">{c.count}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </>
      )}
    </div>
  );
}
