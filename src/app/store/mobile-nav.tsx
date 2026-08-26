"use client";

import { useState } from "react";
import Link from "next/link";
import { openQuotePanel } from "./ui-store";
import type { StoreLink } from "@/lib/store-theme";

/** Slide-over navigation for small screens — the desktop nav is hidden below lg. */
export function MobileNav({
  categories,
  links,
}: {
  categories: { slug: string; label: string; count: number }[];
  links: StoreLink[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--store-line)] bg-white text-[var(--store-ink)] lg:hidden"
      >
        <span aria-hidden className="text-[17px] leading-none">☰</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-[#040914]/70 backdrop-blur-[4px]" />
          <div className="absolute right-0 top-0 flex h-full w-[85%] max-w-sm flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--store-line)] px-5 py-4">
              <span className="font-[family-name:var(--font-display)] text-[22px] font-bold uppercase leading-none text-[var(--store-accent)]">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid h-9 w-9 place-items-center rounded-full bg-[#edf1f4] text-[18px] leading-none"
              >
                <span aria-hidden>×</span>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Storefront">
              {links.map((l) =>
                /^https?:/i.test(l.href) ? (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpen(false)}
                    className="block rounded px-3 py-2.5 text-[15px] font-bold hover:bg-slate-50"
                  >
                    {l.label}
                  </a>
                ) : (
                  <Link
                    key={l.label}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="block rounded px-3 py-2.5 text-[15px] font-bold hover:bg-slate-50"
                  >
                    {l.label}
                  </Link>
                ),
              )}

              {categories.length > 0 && (
                <>
                  <div className="mt-4 px-3 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--store-steel)]">
                    Categories
                  </div>
                  {categories.map((c) => (
                    <Link
                      key={c.slug}
                      href={`/store/c/${c.slug}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between rounded px-3 py-2.5 text-[15px] hover:bg-slate-50"
                    >
                      {c.label}
                      <span className="text-xs text-[#8a96a5]">{c.count}</span>
                    </Link>
                  ))}
                </>
              )}
            </nav>

            <div className="border-t border-[var(--store-line)] p-5">
              <button
                type="button"
                onClick={() => { setOpen(false); openQuotePanel(); }}
                className="block w-full rounded-md bg-[var(--store-accent)] px-4 py-3 text-center text-sm font-extrabold text-white"
              >
                Get a Quote
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
