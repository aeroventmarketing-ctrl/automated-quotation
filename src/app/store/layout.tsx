import type { Metadata } from "next";
import Link from "next/link";
import { Barlow_Condensed, Manrope } from "next/font/google";
import { COMPANY } from "@/lib/config";
import { listStoreProducts, storeCategories } from "@/lib/store-catalog";
import { getStoreTheme, themeImageSrc } from "@/lib/store-theme";
import { siteOrigin, storeUrl, jsonLd, storeHomeLd } from "@/lib/store-seo";
import { WRAP, DISPLAY } from "@/lib/store-ui";
import { HeaderActions } from "./store-actions";
import { StoreChrome } from "./store-chrome";
import { MobileNav } from "./mobile-nav";

/**
 * Self-hosted at build time — no runtime request to Google, no layout shift.
 * Barlow Condensed carries the headings (tall, industrial, uppercase); Manrope
 * does the reading.
 */
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const body = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-body", display: "swap" });

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
  const logo = themeImageSrc(theme.logoUrl);
  // HVAC Tools sits just before the first external link — after the in-shop
  // sections, ahead of "Main Website ↗". It's a theme field of its own so it
  // shows up for shops whose nav was saved before the tools page existed.
  const nav = [...theme.navLinks];
  if (theme.toolsNavLabel) {
    const firstExternal = nav.findIndex((l) => /^https?:/i.test(l.href));
    const entry = { label: theme.toolsNavLabel, href: "/store/tools" };
    nav.splice(firstExternal === -1 ? nav.length : firstExternal, 0, entry);
  }

  const themeVars = {
    "--store-accent": theme.accent,
    "--store-accent-dark": theme.accentDark,
    "--store-ink": theme.ink,
    "--store-ink2": theme.ink2,
    "--store-paper": theme.paper,
    "--store-line": "#dce2e8",
    // Text, per surface. `--store-steel` keeps its name — 40-odd classes across
    // the shop already point at it — but it now reads from the theme instead of
    // being pinned here.
    "--store-text": theme.text,
    "--store-steel": theme.textMuted,
    "--store-on-dark": theme.textOnDark,
    "--store-on-dark-muted": theme.textMutedOnDark,
  } as React.CSSProperties;

  return (
    <div
      style={themeVars}
      className={`${display.variable} ${body.variable} flex min-h-screen scroll-smooth flex-col bg-[var(--store-paper)] font-[family-name:var(--font-body)] text-[15px] text-[var(--store-text)] antialiased selection:bg-[var(--store-accent)] selection:text-white`}
    >
      {/* Site-wide structured data — org, website + search action, store. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(storeHomeLd(theme)) }} />

      {theme.announcement && (
        <div className="hidden bg-[#07101f] text-[12px] tracking-[0.04em] text-[var(--store-on-dark-muted)] sm:block">
          <div className={`${WRAP} flex h-[34px] items-center justify-between`}>
            <span>
              <strong className="text-[var(--store-on-dark)]">{theme.announcement}</strong>
              {theme.announcementNote && ` · ${theme.announcementNote}`}
            </span>
            <div className="hidden gap-[22px] lg:flex">
              {theme.topLinks.map((t) => <span key={t}>{t}</span>)}
            </div>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-[var(--store-line)] bg-white/95 backdrop-blur-[16px]">
        <div className={`${WRAP} grid h-[72px] grid-cols-[1fr_auto] items-center gap-7 sm:h-[86px] lg:grid-cols-[290px_1fr_auto]`}>
          <Link href="/store" className="flex items-center" aria-label={`${COMPANY.name} — shop home`}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo}
                alt={COMPANY.name}
                width={230}
                height={66}
                className="h-[46px] w-[170px] object-contain object-left sm:h-[66px] sm:w-[230px]"
                fetchPriority="high"
              />
            ) : (
              <span className={`${DISPLAY} text-[26px] leading-none text-[var(--store-accent)]`}>Aerovent</span>
            )}
          </Link>

          <nav className="hidden justify-center gap-[25px] text-[13px] font-bold lg:flex" aria-label="Main">
            {nav.map((l) =>
              /^https?:/i.test(l.href) ? (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[var(--store-accent)]">
                  {l.label}
                </a>
              ) : (
                <Link key={l.label} href={l.href} className="transition-colors hover:text-[var(--store-accent)]">
                  {l.label}
                </Link>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2.5 justify-self-end">
            <HeaderActions />
            <MobileNav categories={categories} links={nav} />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-[#070e1b] pb-7 pt-14 text-[var(--store-on-dark-muted)]">
        <div className={WRAP}>
          <div className="grid gap-11 sm:grid-cols-2 lg:grid-cols-[1.5fr_.7fr_.7fr_1fr]">
            <div>
              <div className={`${DISPLAY} text-[28px] leading-tight text-[var(--store-on-dark)]`}>
                <span className="text-[var(--store-accent)]">Aerovent</span> Fans and Blowers Manufacturing
              </div>
              <p className="mt-3 text-[12px] leading-[1.8]">{theme.aiSummary}</p>
            </div>

            <div>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--store-on-dark)]">Shop</h2>
              <ul className="mt-3 space-y-1 text-[12px] leading-[1.8]">
                <li><Link href="/store#products" className="transition-colors hover:text-[var(--store-on-dark)]">All products</Link></li>
                {categories.slice(0, 4).map((c) => (
                  <li key={c.slug}>
                    <Link href={`/store/c/${c.slug}`} className="transition-colors hover:text-[var(--store-on-dark)]">{c.label}</Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--store-on-dark)]">Support</h2>
              <ul className="mt-3 space-y-1 text-[12px] leading-[1.8]">
                <li><Link href="/rfq" className="transition-colors hover:text-[var(--store-on-dark)]">Request a quotation</Link></li>
                {theme.toolsNavLabel && (
                  <li><Link href="/store/tools" className="transition-colors hover:text-[var(--store-on-dark)]">{theme.toolsNavLabel}</Link></li>
                )}
                {theme.mainSiteUrl && (
                  <li><a href={theme.mainSiteUrl} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[var(--store-on-dark)]">Main website</a></li>
                )}
                {theme.facebookUrl && (
                  <li><a href={theme.facebookUrl} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[var(--store-on-dark)]">Facebook page</a></li>
                )}
              </ul>
            </div>

            <div>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--store-on-dark)]">Contact</h2>
              <address className="mt-3 space-y-3 text-[12px] not-italic leading-[1.8]">
                <div>{COMPANY.manilaOffice.replace(/^Manila Office:\s*/, "")}</div>
                <div>
                  {theme.salesEmail && <>{theme.salesEmail}<br /></>}
                  {theme.phone}
                </div>
              </address>
            </div>
          </div>

          <div className="mt-9 flex flex-col gap-2 border-t border-white/[0.07] pt-5 text-[11px] sm:flex-row sm:justify-between">
            <span>© {new Date().getFullYear()} {COMPANY.name}. All rights reserved.</span>
            <span>Fabricated fans &amp; blowers are made to order and quoted by specification.</span>
          </div>
        </div>
      </footer>

      <StoreChrome quoteNote="Your enquiry goes straight to the Aerovent sales desk." />
    </div>
  );
}
