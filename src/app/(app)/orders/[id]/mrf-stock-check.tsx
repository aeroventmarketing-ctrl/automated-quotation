"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageSearch, Search, X } from "lucide-react";
import { issueMrfLineFromStock, sendMrfLineToPurchasing } from "../actions";

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
export interface MrfLine {
  index: number; // position in the MRF items array
  description: string;
  qty: string;
  unit: string;
  disposition?: string | null; // undefined ⇒ still pending
}
interface StockOpt {
  id: string;
  name: string;
  /** Free to issue right now (on hand − active reservations). */
  available?: number;
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
/** Normalise an item label for matching / searching (drop parenthetical notes). */
const cleanTerm = (s: string) => s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
const normLabel = (s: string) => cleanTerm(s).toLowerCase();

/**
 * Warehouse availability checker + per-line issue on an MRF card. For each line
 * still awaiting handling it shows an Issue button (issue the requested qty from
 * the matched stock item — the server caps at what's available and sends the rest
 * to purchasing) plus a "To purchasing" option; and a free search for any item.
 * Viewing is open to purchaser/payment-approver too; issuing is warehouse/admin.
 */
export function MrfStockCheck({
  orderId,
  requestId,
  lines,
  stockItems,
  canIssue,
}: {
  orderId: string;
  requestId: string;
  lines: MrfLine[];
  stockItems: StockOpt[];
  canIssue: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [notSetUp, setNotSetUp] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const acRef = useRef<AbortController | null>(null);

  const stockByName = useMemo(() => {
    const m = new Map<string, StockOpt>();
    for (const s of stockItems) m.set(normLabel(s.name), s);
    return m;
  }, [stockItems]);
  const matchStock = (desc: string) => stockByName.get(normLabel(desc));

  const pending = lines.filter((l) => !l.disposition);
  const chips = Array.from(new Set(lines.map((l) => cleanTerm(l.description)).filter((t) => t.length >= 2)));

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

  async function issue(line: MrfLine) {
    const m = matchStock(line.description);
    if (!m) { setErr(`No stock item matches "${line.description}". Send it to purchasing or use "Check availability & process".`); return; }
    setBusy(line.index); setErr(null); setMsg(null);
    try {
      const r = await issueMrfLineFromStock(orderId, requestId, line.index, m.id, Number(line.qty) || undefined);
      setMsg(
        r.toPurchase > 0
          ? `Issued ${fmt(r.issued)} of ${line.description}; ${fmt(r.toPurchase)} sent to purchasing (short/out of stock).`
          : `Issued ${fmt(r.issued)} of ${line.description}.`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to issue");
    } finally { setBusy(null); }
  }

  async function toPurchasing(line: MrfLine) {
    setBusy(line.index); setErr(null); setMsg(null);
    try {
      await sendMrfLineToPurchasing(orderId, requestId, line.index);
      setMsg(`${line.description} sent to purchasing.`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  }

  const term = q.trim();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
      >
        <PackageSearch className="h-3.5 w-3.5" /> Check stock availability{canIssue && pending.length > 0 ? " & issue" : ""}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <PackageSearch className="h-3.5 w-3.5 text-primary" /> Stock availability{canIssue && pending.length > 0 ? " & issue" : ""}
        </div>
        <button type="button" onClick={() => { setOpen(false); setQ(""); setMsg(null); setErr(null); }} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Per-line issue — one row per line still awaiting handling (warehouse/admin). */}
      {canIssue && pending.length > 0 && (
        <div className="space-y-1 rounded-md border bg-background p-1.5">
          {pending.map((l) => {
            const matched = matchStock(l.description);
            const inStock = !!matched && (matched.available ?? 0) > 0;
            return (
              <div key={l.index} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {l.description} <span className="text-muted-foreground">· {l.qty} {l.unit}</span>
                  {!matched ? (
                    <span className="ml-1 text-amber-600">· no stock match</span>
                  ) : !inStock ? (
                    <span className="ml-1 text-amber-600">· out of stock</span>
                  ) : null}
                </span>
                {inStock ? (
                  <button
                    type="button"
                    disabled={busy === l.index}
                    onClick={() => issue(l)}
                    className="rounded border border-emerald-600/50 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-600/10 disabled:opacity-50"
                  >
                    {busy === l.index ? "Issuing…" : `Issue ${l.qty}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy === l.index}
                  onClick={() => toPurchasing(l)}
                  className="rounded border px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-500/10 disabled:opacity-50"
                >
                  To purchasing
                </button>
              </div>
            );
          })}
          <p className="px-0.5 pt-0.5 text-[10px] text-muted-foreground">Issuing deducts from stock; anything short or out of stock is sent to purchasing automatically.</p>
        </div>
      )}

      {/* Quick lookup for any item. */}
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
      {msg && <p className="text-[11px] text-emerald-700">{msg}</p>}
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}
