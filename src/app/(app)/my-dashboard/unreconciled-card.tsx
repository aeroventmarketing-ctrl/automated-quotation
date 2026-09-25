"use client";

/**
 * "Unreconciled PO" / "Unreconciled Vouchers" count tiles for the Production
 * Dashboard.
 *
 * The owner: *"in Unreconciled Vouchers and Unreconciled PO, copy the behavior to
 * be same as Reconciled by hand. Reconciled by hand tile shows all items
 * reconciled by hand when clicked."*
 *
 * They used to be links: clicking jumped to the Purchasing or Cash Requests tab
 * positioned on the FIRST item, which answered "show me one of these" when the
 * question the number provokes is "show me which ones". Now they expand the list
 * in place, exactly as {@link ManualReconcileCard} does — the tile is a button,
 * the list opens full-width beneath the row, and each row still links through to
 * its item.
 *
 * One component for both tiles rather than two near-copies: the lists differ only
 * in their icon, label and caption, and the next change to how a row reads should
 * not have to be made twice to keep them looking like siblings.
 */
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ShoppingCart, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { UnreconciledRow } from "@/lib/manual-reconciliations";

const CURRENCY = "PHP";

/**
 * The icon is chosen by a KEY, not passed in.
 *
 * A Lucide icon is a React component, and a component is a function — which a
 * Server Component may not hand to a Client Component. Passing `icon={Wallet}`
 * typechecks, lints and builds, then fails at request time with *"Functions
 * cannot be passed directly to Client Components"* and the whole dashboard
 * renders as an error boundary. Caught by opening the page, which is the only
 * thing that would have caught it.
 */
const ICONS = { po: ShoppingCart, voucher: Wallet } as const;

export function UnreconciledCard({
  rows,
  label,
  caption,
  emptyText,
  icon,
}: {
  rows: UnreconciledRow[];
  /** The tile's caption, e.g. "Unreconciled PO". */
  label: string;
  /** The strip above the list, saying what these items are waiting for. */
  caption: string;
  /** What to say when the count is zero — a good state, so say so. */
  emptyText: string;
  icon: keyof typeof ICONS;
}) {
  const [open, setOpen] = useState(false);
  const count = rows.length;
  const Icon = ICONS[icon];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-lg text-left outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent">
          <CardContent className="flex items-center gap-3 py-4">
            <Icon className="h-6 w-6 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-bold tabular-nums leading-none">{count}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
            </div>
            {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </CardContent>
        </Card>
      </button>

      {open && (
        <div className="col-span-full overflow-hidden rounded-md border">
          <div className="border-b bg-muted/40 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {caption}
          </div>
          {count === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            rows.map((r) => (
              <Link
                key={r.id}
                href={r.href}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-3 py-2 text-sm transition-colors last:border-0 hover:bg-muted/40"
              >
                <span className="w-40 shrink-0 font-medium tabular-nums text-red-600">{r.ref}</span>
                <span className="min-w-0 flex-1 truncate">{r.title || <span className="text-muted-foreground">—</span>}</span>
                <span className="shrink-0 tabular-nums">{formatCurrency(r.amount, CURRENCY)}</span>
                <span className="w-full shrink-0 text-xs text-muted-foreground sm:basis-full">{r.detail}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </>
  );
}
