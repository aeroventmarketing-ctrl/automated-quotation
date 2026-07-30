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
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
/**
 * Turn a requisition/MRF item line ("9 pc · ANGLE BAR 4.0 X 50 X 50 (remark)")
 * into a searchable term: take the description after the qty·unit, drop notes.
 */
function cleanTerm(raw: string): string {
  const afterDot = raw.includes("·") ? raw.slice(raw.indexOf("·") + 1) : raw;
  return afterDot.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Read-only stock availability lookup: quick-search chips seeded from a set of
 * item terms, plus a free search box, showing free-to-use quantity and location.
 * Queries /api/stock/availability (no cost exposed). Used on MRF and requisition
 * cards so the warehouse/purchaser can check what's on hand.
 */
export function StockAvailabilityLookup({ terms }: { terms: string[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [notSetUp, setNotSetUp] = useState(false);
  const [touched, setTouched] = useState(false);
  const acRef = useRef<AbortController | null>(null);

  const chips = Array.from(new Set(terms.map(cleanTerm).filter((t) => t.length >= 2)));

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); return; }
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
      >
        <PackageSearch className="h-3.5 w-3.5" /> Check stock availability
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <PackageSearch className="h-3.5 w-3.5 text-primary" /> Check stock availability
        </div>
        <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => setQ(c)} className={`rounded-full border px-2 py-0.5 text-[11px] hover:bg-accent ${q === c ? "border-primary bg-primary/10 text-primary" : ""}`}>
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          className="h-8 w-full rounded-md border bg-background pl-7 pr-7 text-xs outline-none focus:ring-2 focus:ring-primary/40"
          placeholder="Type an item name or SKU…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        {q !== "" && (
          <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {term.length >= 2 && (
        loading && hits.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">Searching…</p>
        ) : notSetUp ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">Inventory isn&apos;t set up yet.</p>
        ) : hits.length === 0 && touched ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">No item matches &ldquo;{term}&rdquo;.</p>
        ) : (
          <ul className="divide-y rounded-md border bg-background">
            {hits.map((h) => {
              const state = h.available <= 0 ? "out" : h.available < h.onHand ? "some" : "ok";
              return (
                <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{h.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {[h.sku ? `SKU ${h.sku}` : null, h.category, h.location ? `Loc ${h.location}` : null].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold tabular-nums ${state === "out" ? "text-destructive" : state === "some" ? "text-amber-600" : "text-emerald-700"}`}>
                      {h.available <= 0 ? "Out of stock" : `${fmt(h.available)} ${h.unit}`}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {h.available > 0 && h.available < h.onHand ? `${fmt(h.onHand)} on hand · some reserved` : "available"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}
