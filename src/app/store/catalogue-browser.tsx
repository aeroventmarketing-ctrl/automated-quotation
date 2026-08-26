"use client";

import { useMemo, useState } from "react";
import type { StoreProduct, StoreCategory } from "@/lib/store-catalog";
import type { StoreTheme } from "@/lib/store-theme";
import { WRAP, DISPLAY, KICKER } from "@/lib/store-ui";
import { ProductCard } from "./product-card";
import { openQuotePanel } from "./ui-store";

/**
 * The shop's browsing surface: the category tiles and the catalogue below them.
 *
 * Every listed product is rendered by the server into this component's markup —
 * the filtering, searching and sorting are then instant and client-side. That
 * keeps the whole catalogue in the HTML for crawlers and answer engines while
 * the shopper never waits for a round trip to narrow it down.
 */
export function CatalogueBrowser({
  products,
  categories,
  theme,
  initialQuery = "",
}: {
  products: StoreProduct[];
  categories: StoreCategory[];
  theme: StoreTheme;
  initialQuery?: string;
}) {
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState(initialQuery);
  const [sort, setSort] = useState<"featured" | "low" | "high">("featured");

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = products.filter((p) => {
      if (category !== "all" && p.categorySlug !== category) return false;
      if (!terms.length) return true;
      const hay = `${p.name} ${p.modelCode} ${p.category} ${p.description ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    // Unpriced items sort last either way — there's no figure to rank them by.
    const price = (p: StoreProduct) => p.fromPrice ?? Number.POSITIVE_INFINITY;
    if (sort === "low") return [...list].sort((a, b) => price(a) - price(b));
    if (sort === "high") return [...list].sort((a, b) => (b.fromPrice ?? -1) - (a.fromPrice ?? -1));
    return list;
  }, [products, category, q, sort]);

  return (
    <>
      <section id="categories" className="scroll-mt-24 py-[78px]">
        <div className={WRAP}>
          <SectionHead kicker={theme.categoriesKicker} title={theme.categoriesTitle} blurb={theme.categoriesBlurb} />

          <div className="grid grid-cols-1 gap-3.5 min-[620px]:grid-cols-2 lg:grid-cols-4">
            <CategoryTile
              eyebrow="All equipment"
              title="Complete Catalogue"
              count={products.length}
              active={category === "all"}
              onSelect={() => setCategory("all")}
            />
            {categories.map((c) => (
              <CategoryTile
                key={c.slug}
                eyebrow="Ventilation equipment"
                title={c.label}
                count={c.count}
                active={category === c.slug}
                onSelect={() => setCategory(c.slug)}
              />
            ))}
          </div>
        </div>
      </section>

      <section id="products" className="scroll-mt-24 bg-white py-[78px]">
        <div className={WRAP}>
          <SectionHead kicker={theme.catalogueKicker} title={theme.catalogueTitle} blurb={theme.catalogueBlurb} />

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[16rem] flex-1">
              <input
                id="store-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search model, product or application…"
                aria-label="Search the catalogue"
                className="h-12 w-full rounded border border-[var(--store-line)] bg-[#f8fafb] pl-4 pr-11 text-[15px] outline-none transition-colors focus:border-[#8190a2]"
              />
              <span aria-hidden className="pointer-events-none absolute right-4 top-3 text-[17px] text-[var(--store-steel)]">⌕</span>
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              aria-label="Sort products"
              className="h-12 rounded border border-[var(--store-line)] bg-white px-3.5 text-[15px] outline-none"
            >
              <option value="featured">Sort: Featured</option>
              <option value="low">Price: Low to high</option>
              <option value="high">Price: High to low</option>
            </select>
            <span className="whitespace-nowrap text-[12px] text-[var(--store-steel)]">
              {shown.length} product{shown.length === 1 ? "" : "s"}
            </span>
          </div>

          {shown.length === 0 ? (
            <div className="border border-dashed border-[#bcc6d0] p-9 text-center text-[14px] leading-relaxed text-[var(--store-steel)]">
              {products.length === 0
                ? "No products are listed yet. List them in Admin → Store products and they appear here automatically."
                : "No matching equipment found. Try another term or request an engineered quotation."}
              <button
                type="button"
                onClick={() => openQuotePanel(q)}
                className="mx-auto mt-5 block rounded-md bg-[var(--store-accent)] px-5 py-3 text-[13.5px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
              >
                Request a quotation
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-[18px] min-[620px]:grid-cols-2 lg:grid-cols-4">
              {shown.map((p, i) => (
                <ProductCard key={p.id} product={p} theme={theme} priority={i < 4} />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- fragments */

export function SectionHead({ kicker, title, blurb }: { kicker: string; title: string; blurb: string }) {
  return (
    <div className="mb-7 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {kicker && <div className={KICKER}>{kicker}</div>}
        <h2 className={`${DISPLAY} mt-2 text-[42px] leading-none`}>{title}</h2>
      </div>
      {blurb && <p className="max-w-[470px] text-[13px] leading-[1.7] text-[var(--store-steel)]">{blurb}</p>}
    </div>
  );
}

function CategoryTile({
  eyebrow,
  title,
  count,
  active,
  onSelect,
}: {
  eyebrow: string;
  title: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`relative min-h-[190px] overflow-hidden rounded-[5px] p-6 text-left text-white transition-all duration-[250ms] hover:-translate-y-1 hover:shadow-[0_18px_60px_rgba(9,20,38,0.12)] ${
        active
          ? "bg-gradient-to-br from-[var(--store-accent)] to-[var(--store-accent-dark)]"
          : "bg-[var(--store-ink2)]"
      }`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-9 -right-9 h-[135px] w-[135px] rounded-full border-[28px] border-white/[0.04]"
      />
      <span className={`block text-[12px] uppercase tracking-[0.13em] ${active ? "text-[#ffe2e4]" : "text-[#8d9bad]"}`}>
        {eyebrow}
      </span>
      <span className={`${DISPLAY} mt-14 block text-[27px] leading-tight`}>{title}</span>
      <span className={`mt-1 block text-[12px] ${active ? "text-[#ffe2e4]" : "text-[#aeb9c8]"}`}>
        {count} product{count === 1 ? "" : "s"} →
      </span>
    </button>
  );
}
