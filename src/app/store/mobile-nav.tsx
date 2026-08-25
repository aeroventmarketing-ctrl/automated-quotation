"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { StoreSearch } from "./store-search";

/** Slide-over navigation for small screens. */
export function MobileNav({ categories }: { categories: { slug: string; label: string; count: number }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-100 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
          <div className="absolute right-0 top-0 flex h-full w-[85%] max-w-sm flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <span className="font-[family-name:var(--font-display)] text-sm font-extrabold uppercase tracking-tight text-[var(--store-accent)]">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-slate-200 px-5 py-4">
              <StoreSearch />
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Categories">
              <Link href="/store" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-[15px] font-semibold text-slate-900 hover:bg-slate-50">
                All products
              </Link>
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/store/c/${c.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 text-[15px] text-slate-700 hover:bg-slate-50"
                >
                  {c.label}
                  <span className="text-xs text-slate-400">{c.count}</span>
                </Link>
              ))}
            </nav>

            <div className="border-t border-slate-200 p-5">
              <Link
                href="/rfq"
                onClick={() => setOpen(false)}
                className="block rounded-full bg-[var(--store-accent)] px-4 py-3 text-center text-sm font-semibold text-white"
              >
                Request a quotation
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
