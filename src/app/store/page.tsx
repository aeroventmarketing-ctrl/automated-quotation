import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Home, Phone, Settings, ShieldCheck, type LucideIcon } from "lucide-react";
import { listStoreProducts, storeCategories, inStock, type StoreProduct } from "@/lib/store-catalog";
import { getStoreTheme, themeImageSrc, type StoreTheme } from "@/lib/store-theme";
import { jsonLd, itemListLd, faqLd, storeUrl } from "@/lib/store-seo";
import { WRAP, DISPLAY, KICKER } from "@/lib/store-ui";
import { CatalogueBrowser } from "./catalogue-browser";
import { HeroFan } from "./hero-fan";
import { QuoteButton } from "./store-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const theme = await getStoreTheme();
  if (q?.trim()) {
    return {
      title: `Search: ${q.trim()}`,
      description: `Catalogue results for “${q.trim()}” — fans, blowers and ventilation equipment.`,
      // A search page has no canonical value of its own.
      robots: { index: false, follow: true },
    };
  }
  return { title: theme.seoTitle, description: theme.seoDescription, alternates: { canonical: storeUrl() } };
}

export default async function StoreHome({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const [theme, all] = await Promise.all([getStoreTheme(), listStoreProducts()]);
  const categories = storeCategories(all);

  // Buyable items lead the grid — a shopper should meet something they can
  // actually put in a basket before the made-to-order units. This is the
  // "Featured" order the browser's sort falls back to.
  const sorted = [...all].sort((a, b) => {
    const rank = (p: StoreProduct) => (p.quoteOnly ? 2 : inStock(p) ? 0 : 1);
    return rank(a) - rank(b);
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(itemListLd(sorted, storeUrl(), "Aerovent product catalogue")) }}
      />
      {theme.faq.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqLd(theme.faq)) }} />
      )}

      <Hero theme={theme} productCount={all.length} />
      <TrustBand theme={theme} />

      <CatalogueBrowser products={sorted} categories={categories} theme={theme} initialQuery={q.trim()} />

      <SolutionBand theme={theme} />
      <ArticleBand theme={theme} />
    </>
  );
}

/* ---------------------------------------------------------------- sections */

function Hero({ theme, productCount }: { theme: StoreTheme; productCount: number }) {
  // Resolved the same way as the logo, so the hero accepts an uploaded
  // `store/…` path, a public file, or a full URL — not only the first.
  const heroPhoto = themeImageSrc(theme.heroImagePath);

  return (
    <section className="relative overflow-hidden bg-[linear-gradient(115deg,#07101f_0%,#101c30_58%,#26111b_100%)] text-[var(--store-on-dark)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px)",
          backgroundSize: "34px 34px",
        }}
      />

      <div className={`${WRAP} relative grid items-center gap-10 py-16 sm:py-20 lg:min-h-[610px] lg:grid-cols-[1.08fr_.92fr] lg:py-0`}>
        <div>
          {theme.heroEyebrow && (
            <div className="inline-flex items-center gap-2.5 text-[12px] font-extrabold uppercase tracking-[0.16em] text-[var(--store-on-dark)]">
              <i className="block h-0.5 w-7 bg-[var(--store-accent)]" />
              {theme.heroEyebrow}
            </div>
          )}

          <h1 className={`${DISPLAY} my-6 max-w-[740px] text-[clamp(48px,6vw,78px)] leading-[0.97] tracking-[-0.025em]`}>
            {theme.heroHeadline}
            {theme.heroHeadlineAccent && (
              <>
                <br />
                <span className="text-[#ff3d45]">{theme.heroHeadlineAccent}</span>
              </>
            )}
          </h1>

          <p className="max-w-[650px] text-[17px] leading-[1.75] text-[var(--store-on-dark-muted)]">{theme.heroSubhead}</p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={theme.heroCtaHref}
              className="inline-flex items-center justify-center gap-2.5 rounded-[5px] bg-[var(--store-accent)] px-5 py-4 text-[15px] font-extrabold text-white shadow-[0_12px_32px_rgba(229,32,43,0.28)] transition-colors hover:bg-[var(--store-accent-dark)]"
            >
              {theme.heroCtaLabel} →
            </Link>
            {theme.heroCta2Label && (
              <QuoteButton className="inline-flex items-center justify-center rounded-[5px] border border-[#536074] px-5 py-4 text-[15px] font-extrabold text-white transition-colors hover:bg-white/5">
                {theme.heroCta2Label}
              </QuoteButton>
            )}
          </div>

          {theme.metrics.length > 0 && (
            <div className="mt-11 flex flex-col gap-4 sm:flex-row sm:gap-[30px]">
              {theme.metrics.map((m) => (
                <div key={m.value}>
                  <b className={`${DISPLAY} block text-[26px] leading-tight`}>{m.value}</b>
                  <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--store-on-dark-muted)]">{m.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* The stage: an approved flagship photo when one is set, otherwise the
            rotor artwork so the hero is never a half-empty column. */}
        <div className="relative hidden h-[430px] place-items-center lg:grid">
          {heroPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroPhoto}
              alt=""
              aria-hidden
              className="h-[380px] w-full object-contain drop-shadow-[0_34px_70px_rgba(0,0,0,0.5)]"
              fetchPriority="high"
            />
          ) : (
            <HeroFan />
          )}

          <div className="absolute right-0 top-11 w-[180px] border-l-2 border-[var(--store-accent)] bg-white/[0.05] px-4 py-3.5">
            <b className="text-[12px] tracking-[0.1em]">AIRFLOW, ENGINEERED.</b>
            <span className="mt-1 block text-[11px] text-[var(--store-on-dark-muted)]">
              {productCount > 0
                ? `${productCount} product${productCount === 1 ? "" : "s"} listed · nationwide delivery`
                : "Nationwide delivery across the Philippines"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Icons for the bordered squares in the trust band.
 *
 * These were text characters (⌂ ✓ ⚙ →) before, which is why the four squares
 * never matched: each glyph came from whatever font the browser substituted for
 * it, so they arrived at different weights, sizes and baselines — and differed
 * again between machines. Drawn instead on one 24×24 grid at one stroke weight,
 * the four are identical by construction.
 *
 * The symbols are the ones the characters were already producing, so nothing on
 * screen changes shape: house, tick, gear, arrow.
 */
const TRUST_ICON: Record<string, LucideIcon> = {
  factory: Home, check: Check, wrench: Settings, truck: ArrowRight,
  shield: ShieldCheck, support: Phone, settings: Settings,
};

function TrustBand({ theme }: { theme: StoreTheme }) {
  return (
    <div id="about" className="scroll-mt-24 border-b border-[var(--store-line)] bg-white">
      <div className={`${WRAP} grid grid-cols-1 min-[620px]:grid-cols-2 lg:grid-cols-4`}>
        {theme.features.map((f, i) => (
          <div
            key={f.title}
            className={`flex items-center gap-3.5 px-5 py-6 ${
              i < theme.features.length - 1 ? "border-b border-[var(--store-line)] lg:border-b-0 lg:border-r" : ""
            }`}
          >
            {/* 47px square, 20px icon — the 39px / 17px pair, up 20%. */}
            <div
              aria-hidden
              className="grid h-[47px] w-[47px] shrink-0 place-items-center rounded border border-[#f1bcc0] text-[var(--store-accent)]"
            >
              {(() => {
                const Icon = TRUST_ICON[f.icon] ?? Check;
                return <Icon size={20} strokeWidth={2.25} />;
              })()}
            </div>
            <div>
              <b className="block text-[13px]">{f.title}</b>
              <span className="text-[11px] text-[var(--store-steel)]">{f.body}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SolutionBand({ theme }: { theme: StoreTheme }) {
  return (
    <section id="custom" className="scroll-mt-24 bg-[var(--store-ink)] text-[var(--store-on-dark)]">
      <div className="grid lg:min-h-[420px] lg:grid-cols-2">
        <div className="bg-[linear-gradient(145deg,#111d31,#07101f)] px-5 py-16 sm:px-8 lg:py-[70px] lg:pl-[max(20px,calc((100vw_-_1240px)/2))] lg:pr-[60px]">
          {theme.solutionKicker && <div className={KICKER}>{theme.solutionKicker}</div>}
          <h2 className={`${DISPLAY} my-4 text-[38px] leading-[1.02] sm:text-[48px]`}>{theme.solutionTitle}</h2>
          <p className="leading-[1.75] text-[var(--store-on-dark-muted)]">{theme.solutionBody}</p>

          {theme.solutionBullets.length > 0 && (
            <ul className="my-6 grid gap-3 sm:grid-cols-2">
              {theme.solutionBullets.map((b) => (
                <li key={b} className="text-[14px]">
                  <span aria-hidden className="mr-2 text-[#ff444d]">✓</span>
                  {b}
                </li>
              ))}
            </ul>
          )}

          <QuoteButton className="inline-flex items-center gap-2.5 rounded-[5px] bg-[var(--store-accent)] px-5 py-4 text-[15px] font-extrabold text-white shadow-[0_12px_32px_rgba(229,32,43,0.28)] transition-colors hover:bg-[var(--store-accent-dark)]">
            {theme.solutionCtaLabel} →
          </QuoteButton>
        </div>

        <div className="relative grid min-h-[260px] place-items-center overflow-hidden bg-[linear-gradient(135deg,#28101b,#151725)]">
          <span
            aria-hidden
            className={`${DISPLAY} absolute -right-20 whitespace-nowrap text-[16px] tracking-[0.2em] text-white/10`}
            style={{ transform: "rotate(-90deg)" }}
          >
            AIRFLOW / STATIC PRESSURE / APPLICATION
          </span>
          <div aria-hidden className="flex items-center gap-3.5">
            <FlowArrow />
            <FlowArrow />
            <div className="h-[125px] w-[125px] rounded-full border-[22px] border-[#8c1e29] shadow-[0_0_80px_rgba(229,32,43,0.33)]" />
            <FlowArrow />
            <FlowArrow />
          </div>
        </div>
      </div>
    </section>
  );
}

function FlowArrow() {
  return (
    <i className="relative block h-0.5 w-[70px] bg-[linear-gradient(90deg,transparent,#ff414a)]">
      <span className="absolute -top-1 right-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-[#ff414a]" />
    </i>
  );
}

function ArticleBand({ theme }: { theme: StoreTheme }) {
  const paragraphs = theme.articleBody.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <section className="bg-[#eef2f5] py-[78px]">
      <div className={`${WRAP} grid gap-14 lg:grid-cols-[1.1fr_.9fr]`}>
        <div>
          {theme.articleKicker && <div className={KICKER}>{theme.articleKicker}</div>}
          <h2 className={`${DISPLAY} mb-4 mt-2.5 text-[38px] leading-none`}>{theme.articleTitle}</h2>
          <div className="space-y-4 leading-[1.85] text-[var(--store-steel)]">
            {paragraphs.map((p) => <p key={p.slice(0, 40)}>{p}</p>)}
          </div>
        </div>

        <div>
          {theme.faq.map((f, i) => (
            <details
              key={f.q}
              open={i === 0}
              className="mb-2.5 rounded-[5px] border border-[var(--store-line)] bg-white px-5 py-[18px]"
            >
              <summary className="cursor-pointer font-extrabold">{f.q}</summary>
              <p className="mt-2.5 text-[13px] leading-[1.8] text-[var(--store-steel)]">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
