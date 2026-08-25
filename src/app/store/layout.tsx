import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY } from "@/lib/config";
import { listStoreProducts, storeCategories } from "@/lib/store-catalog";
import { CartLink } from "./cart-link";

export const metadata: Metadata = {
  title: "Shop — Aerovent Fans & Blowers Manufacturing",
  description: "Buy ventilation and air-moving equipment online, direct from Aerovent Fans & Blowers Manufacturing.",
};

/**
 * Public storefront shell — header, category nav and footer. Rendered for every
 * /store page. Uses AeroVent's brand red (#ED1C24), matching the logo and the
 * shared quotation view.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const categories = storeCategories(await listStoreProducts());

  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <header className="border-b-2 border-[#ED1C24] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href="/store" className="leading-tight">
            <div className="text-lg font-bold text-[#ED1C24] sm:text-xl">{COMPANY.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 sm:text-xs">{COMPANY.tagline}</div>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/rfq"
              className="rounded-md border border-[#ED1C24] px-3 py-1.5 text-sm font-semibold text-[#ED1C24] transition-colors hover:bg-[#ED1C24]/10"
            >
              Request a Quotation
            </Link>
            <CartLink />
          </div>
        </div>
        {categories.length > 0 && (
          <nav className="border-t bg-gray-50">
            <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-sm">
              <Link href="/store" className="font-medium text-gray-700 hover:text-[#ED1C24]">All products</Link>
              {categories.map((c) => (
                <Link key={c.slug} href={`/store/c/${c.slug}`} className="text-gray-600 hover:text-[#ED1C24]">
                  {c.label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>

      <footer className="border-t bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs leading-6 text-gray-600">
          <div className="font-semibold text-gray-900">{COMPANY.name}</div>
          <div>{COMPANY.manilaOffice}</div>
          <div>{COMPANY.plantAddress}</div>
          <div className="mt-2">
            <span className="font-medium text-gray-900">Landline:</span> (02) 85619413 ·{" "}
            <span className="font-medium text-gray-900">Sales:</span>{" "}
            <a href="mailto:sales@aeroventfbm.com" className="text-[#ED1C24] hover:underline">sales@aeroventfbm.com</a>
          </div>
          <div className="mt-2 text-gray-500">
            Fabricated fans &amp; blowers are made to order — those are quoted by specification.
          </div>
        </div>
      </footer>
    </div>
  );
}
