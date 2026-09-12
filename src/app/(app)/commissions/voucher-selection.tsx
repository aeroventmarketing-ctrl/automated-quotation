"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";

/**
 * Ticking rows to build ONE cash voucher.
 *
 * The owner: *"If sales personnel or sales head were able to meet the
 * qualifications to receive commission, put a tick box in the row of mark paid
 * so we can generate a single cash voucher. For sales head put a check box in
 * sales override to generate a single voucher either sales head meet the
 * qualifications or not."*
 *
 * Two things this deliberately does NOT do:
 *
 *  1. **It never carries an amount.** A tick sends a deal KEY and nothing else;
 *     the voucher page recomputes every peso from the confirmed sales, exactly
 *     as it did when it totalled everything. The browser can only ever NARROW
 *     the set — it cannot add a commission, price one, or pay one early.
 *  2. **It does not group across people.** Money leaves the company one voucher
 *     per salesperson, so a selection spanning two people offers two vouchers
 *     rather than merging them into a wrong one.
 *
 * The override rows need no special case here, and that is the point: an
 * override is created from somebody ELSE's qualifying month, so it is already
 * independent of whether the Sales Head hit their own target. Ticking one works
 * whether or not the head qualified, because there was never a rule stopping it.
 */

export interface SelectableDeal {
  /** `dealKey(d)` — `<order|counter>-<refId>-<base|override>`. */
  key: string;
  salespersonId: string;
  salespersonName: string;
  amount: number;
  payeeKind: "base" | "override";
  /** Release day, or null. Money ticked before this date is prepared, not due. */
  dueYMD: string | null;
}

interface SelectionCtx {
  selected: Set<string>;
  toggle: (key: string) => void;
  /** Tick or clear a whole card's worth at once. */
  setMany: (keys: string[], on: boolean) => void;
  selectable: Map<string, SelectableDeal>;
}

const Ctx = createContext<SelectionCtx | null>(null);

/**
 * One tick box, in the row beside "Mark paid".
 *
 * Present whenever the commission is approved and unpaid — released or not.
 * Preparing a voucher early is the owner's explicit choice; the wait is on
 * "Mark paid" beside it, which opens five days before the release day.
 */
export function DealTick({ dealKey }: { dealKey: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const deal = ctx.selectable.get(dealKey);
  if (!deal) return null;

  const on = ctx.selected.has(dealKey);
  return (
    <input
      type="checkbox"
      className="h-4 w-4 cursor-pointer"
      checked={on}
      onChange={() => ctx.toggle(dealKey)}
      aria-label={on ? "Remove from the cash voucher" : "Add to the cash voucher"}
      title="Include on a cash voucher"
    />
  );
}

/** The whole-card tick: every selectable row on one month card at once. */
export function CardTick({ dealKeys }: { dealKeys: string[] }) {
  const ctx = useContext(Ctx);
  const mine = useMemo(() => dealKeys.filter((k) => ctx?.selectable.has(k)), [dealKeys, ctx]);
  if (!ctx || mine.length === 0) return null;
  const all = mine.every((k) => ctx.selected.has(k));
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 cursor-pointer"
        checked={all}
        onChange={() => ctx.setMany(mine, !all)}
      />
      {all ? "Clear" : `Select all ${mine.length}`}
    </label>
  );
}

export function VoucherSelection({
  deals,
  currency,
  todayYMD,
  children,
}: {
  deals: SelectableDeal[];
  currency: string;
  /** Manila's date, from the server — so "not due yet" agrees with the rows. */
  todayYMD: string;
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectable = useMemo(() => new Map(deals.map((d) => [d.key, d] as const)), [deals]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const setMany = useCallback((keys: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);

  const ctx = useMemo<SelectionCtx>(() => ({ selected, toggle, setMany, selectable }), [selected, toggle, setMany, selectable]);

  // One group per salesperson — one voucher per salesperson.
  const groups = useMemo(() => {
    const m = new Map<
      string,
      { id: string; name: string; count: number; total: number; overrides: number; notDue: number; firstDue: string | null; keys: string[] }
    >();
    for (const key of selected) {
      const d = selectable.get(key);
      if (!d) continue; // a stale tick (the page refreshed and it was paid)
      const g = m.get(d.salespersonId) ?? {
        id: d.salespersonId, name: d.salespersonName, count: 0, total: 0, overrides: 0, notDue: 0, firstDue: null, keys: [],
      };
      g.count += 1;
      g.total = Math.round((g.total + d.amount) * 100) / 100;
      if (d.payeeKind === "override") g.overrides += 1;
      // Ticked before its release day — prepared, not due.
      if (!d.dueYMD || d.dueYMD > todayYMD) {
        g.notDue += 1;
        if (d.dueYMD && (!g.firstDue || d.dueYMD < g.firstDue)) g.firstDue = d.dueYMD;
      }
      g.keys.push(key);
      m.set(d.salespersonId, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [selected, selectable, todayYMD]);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {groups.length > 0 && (
        <div className="sticky bottom-4 z-30 mx-auto w-full max-w-3xl rounded-lg border bg-card/95 p-3 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              {groups.length === 1 ? "Cash voucher" : `${groups.length} cash vouchers — one per salesperson`}
            </span>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
              <X className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
          </div>
          <div className="space-y-1.5">
            {groups.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{g.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {g.count} commission{g.count === 1 ? "" : "s"} ticked
                    {g.overrides > 0 ? ` · ${g.overrides} override` : ""}
                  </p>
                  {/* Preparing ahead is allowed; being unaware of it is not. */}
                  {g.notDue > 0 && (
                    <p className="text-[11px] font-medium text-amber-700">
                      {g.notDue} not due yet{g.firstDue ? ` · releases from ${formatDate(g.firstDue)}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(g.total, currency)}</span>
                  <Button asChild size="sm" className="h-7 text-xs">
                    <Link
                      href={`/commissions/voucher?salesperson=${encodeURIComponent(g.id)}&keys=${encodeURIComponent(g.keys.join(","))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Generate voucher
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
