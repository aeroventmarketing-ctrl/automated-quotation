"use client";

/**
 * "Reconciled by hand" count tile for the Production Dashboard. Shows how many
 * PO vouchers were tallied manually (typed figures, not AI-verified against the
 * receipt). Clicking the tile expands the full list inline — each row shows the
 * PO number, supplier, amount, and who recorded it (name, designation, date &
 * time), and links to the PO.
 */
import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ClipboardPen, ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { ManualReconRow } from "@/lib/manual-reconciliations";

const CURRENCY = "PHP";

export function ManualReconcileCard({ rows }: { rows: ManualReconRow[] }) {
  const [open, setOpen] = useState(false);
  const count = rows.length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="block w-full rounded-lg text-left outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring sm:w-72"
      >
        <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent">
          <CardContent className="flex items-center gap-3 py-4">
            <ClipboardPen className="h-6 w-6 text-amber-600" />
            <div className="flex-1">
              <div className="text-2xl font-bold tabular-nums leading-none">{count}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Reconciled by hand</div>
            </div>
            {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </CardContent>
        </Card>
      </button>

      {open && (
        <div className="mt-2 overflow-hidden rounded-md border">
          <div className="border-b bg-muted/40 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            Vouchers tallied by hand — figures typed, not AI-verified against the receipt
          </div>
          {count === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">No vouchers reconciled by hand.</p>
          ) : (
            rows.map((r) => (
              <Link
                key={r.prId}
                href={r.href}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-3 py-2 text-sm transition-colors last:border-0 hover:bg-muted/40"
              >
                <span className="w-40 shrink-0 font-medium tabular-nums text-red-600">{r.poNumber}</span>
                <span className="min-w-0 flex-1 truncate">{r.supplier || <span className="text-muted-foreground">—</span>}</span>
                <span className="shrink-0 tabular-nums">{formatCurrency(r.amount, CURRENCY)}</span>
                <span className="w-full shrink-0 text-xs text-muted-foreground sm:w-auto sm:basis-full">
                  Recorded by {r.recordedLabel}
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
