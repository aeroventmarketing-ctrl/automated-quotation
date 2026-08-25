"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { Search } from "lucide-react";

/**
 * Catalogue search. Submits to `/store?q=…`, which filters server-side — so a
 * search result is a real, crawlable, shareable URL rather than client-only
 * state (good for both users and search engines).
 */
export function StoreSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  // Keep in step when the URL changes (back button, or a link with ?q=).
  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        router.push(term ? `/store?q=${encodeURIComponent(term)}` : "/store");
      }}
      className="relative"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        type="search"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search fans, blowers, parts…"
        aria-label="Search the catalogue"
        className="h-10 w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 text-[13.5px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-[var(--store-accent)] focus:bg-white focus:ring-2 focus:ring-[var(--store-accent)]/15"
      />
    </form>
  );
}
