import type { Metadata } from "next";
import Link from "next/link";
import { Manrope, Inter } from "next/font/google";
import { COMPANY } from "@/lib/config";
import { listStoreProducts, storeCategories } from "@/lib/store-catalog";
import { getStoreTheme } from "@/lib/store-theme";
import { siteOrigin, storeUrl, jsonLd, storeHomeLd } from "@/lib/store-seo";
import { CartLink } from "./cart-link";
import { StoreSearch } from "./store-search";
import { MobileNav } from "./mobile-nav";

/**
 * Self-hosted at build time — no runtime request to Google, no layout shift.
 * Manrope carries the headings (geometric, confident); Inter does the reading.
 */
const display = Manrope({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const theme = await getStoreTheme();
  return {
    metadataBase: new URL(siteOrigin()),
    title: { default: theme.seoTitle, template: `%s | ${COMPANY.name}` },
    description: theme.seoDescription,
    keywords: theme.seoKeywords.split(",").map((k) => k.trim()).filter(Boolean),
    alternates: { canonical: storeUrl() },
    openGraph: {
      type: "website",
      siteName: COMPANY.name,
      title: theme.seoTitle,
      description: theme.seoDescription,
      url: storeUrl(),
      locale: "en_PH",
    },
    twitter: { card: "summary_large_image", title: theme.seoTitle, description: theme.seoDescription },
    robots: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  };
}

/**
 * Public storefront shell. Everything visual is driven by CSS custom properties
 * set from the admin-editable theme, so the shop's colour, rounding and copy can
 * be re-tuned without touching code.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [theme, products] = await Promise.all([getStoreTheme(), listStoreProducts()]);
  const categories = storeCategories(products);

  const themeVars = {
    "--store-accent": theme.accent,
    "--store-accent-dark": theme.accentDark,
    "--store-ink": theme.ink,
  } as React.CSSProperties;

  return (
    <div
      style={themeVars}
      className={`${display.variable} ${body.variable} flex min-h-screen flex-col bg-white font-[family-name:var(--font-body)] text-slate-900 antialiased selection:bg-[var(--store-accent)] selection:text-white`}
    >
      {/* Site-wide structured data — org, website + search action, store. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(storeHomeLd(theme)) }} />

      {theme.announcement && (
        <div className="bg-[var(--store-ink)] px-4 py-2 text-center text-[12px] font-medium tracking-wide text-white/90">
          {theme.announcement}
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-md supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3.5 lg:px-8">
          <Link href="/store" className="shrink-0 leading-none">
            <div className="font-[family-name:var(--font-display)] text-[15px] font-extrabold uppercase leading-tight tracking-tight text-[var(--store-accent)] sm:text-base">
              Aerovent
            </div>
            <div className="mt-0.5 hidden text-[9.5px] font-medium uppercase tracking-[0.18em] text-slate-500 sm:block">
              Fans &amp; Blowers
            </div>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 lg:flex" aria-label="Product categories">
            <Link href="/store" className="rounded-full px-3 py-2 text-[13.5px] font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900">
              All products
            </Link>
            {categories.slice(0, 5).map((c) => (
              <Link
                key={c.slug}
                href={`/store/c/${c.slug}`}
                className="rounded-full px-3 py-2 text-[13.5px] font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                {c.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:block md:w-52 lg:w-64">
              <StoreSearch />
            </div>
            <Link
              href="/rfq"
              className="hidden rounded-full border border-slate-300 px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition-colors hover:border-[var(--store-accent)] hover:text-[var(--store-accent)] sm:inline-block"
            >
              Get a quote
            </Link>
            <CartLink />
            <MobileNav categories={categories} />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="font-[family-name:var(--font-display)] text-base font-extrabold uppercase tracking-tight text-[var(--store-accent)]">
              Aerovent
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-slate-600">{theme.aiSummary}</p>
          </div>

          <div>
            <h2 className="font-[family-name:var(--font-display)] text-[11px] font-bold uppercase tracking-[0.14em] text-slate-900">Shop</h2>
            <ul className="mt-4 space-y-2.5 text-[13px] text-slate-600">
              <li><Link href="/store" className="transition-colors hover:text-[var(--store-accent)]">All products</Link></li>
              {categories.slice(0, 5).map((c) => (
                <li key={c.slug}>
                  <Link href={`/store/c/${c.slug}`} className="transition-colors hover:text-[var(--store-accent)]">{c.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="font-[family-name:var(--font-display)] text-[11px] font-bold uppercase tracking-[0.14em] text-slate-900">Company</h2>
            <ul className="mt-4 space-y-2.5 text-[13px] text-slate-600">
              <li><Link href="/rfq" className="transition-colors hover:text-[var(--store-accent)]">Request a quotation</Link></li>
              <li><a href={`mailto:${COMPANY.email}`} className="transition-colors hover:text-[var(--store-accent)]">{COMPANY.email}</a></li>
              <li><a href="mailto:sales@aeroventfbm.com" className="transition-colors hover:text-[var(--store-accent)]">sales@aeroventfbm.com</a></li>
            </ul>
          </div>

          <div>
            <h2 className="font-[family-name:var(--font-display)] text-[11px] font-bold uppercase tracking-[0.14em] text-slate-900">Visit</h2>
            <address className="mt-4 space-y-3 text-[13px] not-italic leading-relaxed text-slate-600">
              <div>{COMPANY.manilaOffice.replace(/^Manila Office:\s*/, "")}</div>
              <div>{COMPANY.plantAddress.replace(/^Plant Address\s*:\s*/, "")}</div>
              <div className="font-medium text-slate-900">(02) 85619413</div>
            </address>
          </div>
        </div>

        <div className="border-t border-slate-200">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-[12px] text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <span>© {new Date().getFullYear()} {COMPANY.name}. All rights reserved.</span>
            <span>Fabricated fans &amp; blowers are made to order and quoted by specification.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
