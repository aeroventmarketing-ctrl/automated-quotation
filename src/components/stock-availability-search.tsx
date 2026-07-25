"use client";

import { useEffect, useRef, useState } from "react";
import { PackageSearch, Search, X } from "lucide-react";

interface Hit {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  category: string | null;
  location: string | null;
  onHand: number;
  available: number;
  sellPrice: number;
  unitCost: number;
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * A sales-facing "Check availability" box. Type an item name (or SKU) while on
 * the phone with a client and see how many are free to sell (on hand − reserved)
 * plus the selling price, so a rep can quote on the spot. Debounced; queries
 * /api/stock/availability. Selling price shows unit cost as a fallback when no
 * sell price has been set yet.
 */
export function StockAvailabilitySearch({ showCost = false }: { showCost?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [notSetUp, setNotSetUp] = useState(false);
  const [touched, setTouched] = useState(false);
  const acRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setTouched(true);
    const t = setTimeout(async () => {
      acRef.current?.abort();
      const ac = new AbortController();
      acRef.current = ac;
      try {
        const res = await fetch(`/api/stock/availability?q=${encodeURIComponent(term)}`, { signal: ac.signal });
        const data = await res.json();
        setHits(Array.isArray(data.items) ? data.items : []);
        setNotSetUp(data.error === "not-set-up");
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const term = q.trim();

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <PackageSearch className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Check availability</h2>
        <span className="text-xs text-muted-foreground">Search an item to see free-to-sell quantity &amp; price</span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          className="h-10 w-full rounded-md border bg-background pl-8 pr-8 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          placeholder="Type an item name or SKU… (e.g. GI sheet, 10001)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        {q !== "" && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {term.length >= 2 && (
        <div className="mt-3">
          {loading && hits.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">Searching…</p>
          ) : notSetUp ? (
            <p className="py-3 text-center text-xs text-muted-foreground">Inventory isn&apos;t set up yet.</p>
          ) : hits.length === 0 && touched ? (
            <p className="py-3 text-center text-xs text-muted-foreground">No item matches &ldquo;{term}&rdquo;.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {hits.map((h) => {
                const price = h.sellPrice > 0 ? h.sellPrice : h.unitCost > 0 ? h.unitCost : 0;
                const priceIsCost = h.sellPrice <= 0 && h.unitCost > 0;
                const state =
                  h.available <= 0 ? "out" : h.available < h.onHand ? "some" : "ok";
                return (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{h.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[h.sku ? `SKU ${h.sku}` : null, h.category, h.location ? `Loc ${h.location}` : null].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-semibold tabular-nums ${
                          state === "out" ? "text-destructive" : state === "some" ? "text-amber-600" : "text-emerald-700"
                        }`}
                      >
                        {h.available <= 0 ? "Out of stock" : `${fmt(h.available)} ${h.unit}`}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {h.available > 0 && h.available < h.onHand ? `${fmt(h.onHand)} on hand · some reserved` : "available to sell"}
                      </div>
                    </div>
                    <div className="w-28 text-right">
                      <div className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {price > 0 ? peso(price) : <span className="text-muted-foreground">—</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {price <= 0 ? "no price set" : priceIsCost ? "unit cost*" : "selling price"}
                        {showCost && h.sellPrice > 0 && h.unitCost > 0 ? ` · cost ${peso(h.unitCost)}` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {hits.some((h) => h.sellPrice <= 0 && h.unitCost > 0) && (
            <p className="mt-1 text-[11px] text-muted-foreground">* No selling price set yet — showing unit cost as a reference. Set sell prices in Inventory.</p>
          )}
        </div>
      )}
    </div>
  );
}
