"use client";

/**
 * "Reconciled by hand" count tile for the Production Dashboard. Counts every item
 * tallied manually (typed figures, not AI-verified against the receipt) — POs,
 * department requisitions and cash vouchers. Rendered as a grid cell so it sits on
 * the same row as the other count tiles; clicking it expands the full list
 * full-width below the row (col-span-full). Each row shows a kind badge, the
 * reference (PO / voucher no.), title, amount, and who recorded it (name,
 * designation, date & time), and links to that item:
 *   - PO / requisition → the Purchasing tab, scrolled to that request
 *   - cash voucher     → the Cash Requests tab, on that voucher
 */
import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardPen, ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { ManualReconRow, ManualReconKind } from "@/lib/manual-reconciliations";

const CURRENCY = "PHP";

const KIND_VARIANT: Record<ManualReconKind, "default" | "secondary" | "warning"> = {
  PO: "default",
  Requisition: "secondary",
  Cash: "warning",
};

export function ManualReconcileCard({ rows }: { rows: ManualReconRow[] }) {
  const [open, setOpen] = useState(false);
  const count = rows.length;

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
            <ClipboardPen className="h-6 w-6 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-bold tabular-nums leading-none">{count}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Reconciled by hand</div>
            </div>
            {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </CardContent>
        </Card>
      </button>

      {open && (
        <div className="col-span-full overflow-hidden rounded-md border">
          <div className="border-b bg-muted/40 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            Items tallied by hand — figures typed, not AI-verified against the receipt
          </div>
          {count === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nothing reconciled by hand.</p>
          ) : (
            rows.map((r) => (
              <Link
                key={r.id}
                href={r.href}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-3 py-2 text-sm transition-colors last:border-0 hover:bg-muted/40"
              >
                <Badge variant={KIND_VARIANT[r.kind]} className="w-20 shrink-0 justify-center">{r.kind}</Badge>
                <span className="w-40 shrink-0 font-medium tabular-nums text-red-600">{r.ref}</span>
                <span className="min-w-0 flex-1 truncate">{r.title || <span className="text-muted-foreground">—</span>}</span>
                <span className="shrink-0 tabular-nums">{formatCurrency(r.amount, CURRENCY)}</span>
                <span className="w-full shrink-0 text-xs text-muted-foreground sm:basis-full">
                  Recorded by {r.recordedLabel}
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </>
  );
}
