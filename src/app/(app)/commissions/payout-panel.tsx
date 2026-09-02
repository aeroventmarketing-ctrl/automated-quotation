"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Receipt, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { payAllForSalesperson } from "./actions";

export interface PayoutRow {
  salespersonId: string;
  salespersonName: string;
  count: number;
  total: number;
  /** Earliest release date among the amounts owed. */
  nextReleaseYMD: string | null;
  /** Voucher number already printed for exactly this set, if any. */
  voucherNo: string | null;
}

/**
 * One row per salesperson, one voucher per row — the owner's rule: *"voucher
 * creation for release of commission is per sales personnel. Total every approved
 * inquiry and make a single cash voucher per sales personnel."*
 *
 * The amounts below are still listed month by month; this is the payout view of
 * the same figures, because that is the unit money actually leaves the company in.
 */
export function PayoutPanel({ rows, canManage, currency }: { rows: PayoutRow[]; canManage: boolean; currency: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (rows.length === 0) return null;
  const grand = rows.reduce((a, r) => a + r.total, 0);

  async function releaseAll(row: PayoutRow) {
    if (!window.confirm(`Release ${formatCurrency(row.total, currency)} to ${row.salespersonName} — ${row.count} commission${row.count === 1 ? "" : "s"} marked paid?`)) return;
    setBusy(row.salespersonId);
    setErr(null);
    try {
      const res = await payAllForSalesperson(row.salespersonId);
      if (res.error) { setErr(res.error); return; }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not release the voucher.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-emerald-600/30">
      <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Receipt className="h-4 w-4 text-muted-foreground" /> Ready for payout — one voucher per salesperson
        </CardTitle>
        <span className="text-sm font-semibold tabular-nums">{formatCurrency(grand, currency)}</span>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.salespersonId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{r.salespersonName}</p>
              <p className="text-[11px] text-muted-foreground">
                {r.count} commission{r.count === 1 ? "" : "s"}
                {r.nextReleaseYMD ? ` · from ${formatDate(r.nextReleaseYMD)}` : ""}
                {r.voucherNo ? <> · voucher <span className="font-semibold text-red-600">No. {r.voucherNo}</span> printed</> : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">{formatCurrency(r.total, currency)}</span>
              <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                <Link href={`/commissions/voucher?salesperson=${r.salespersonId}`} target="_blank" rel="noopener noreferrer">
                  Cash voucher
                </Link>
              </Button>
              {canManage && (
                <Button size="sm" className="h-7 text-xs" disabled={busy === r.salespersonId} onClick={() => releaseAll(r)}>
                  <Banknote className="mr-1 h-3.5 w-3.5" />
                  {busy === r.salespersonId ? "Releasing…" : "Mark voucher paid"}
                </Button>
              )}
            </div>
          </div>
        ))}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
