"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { payDealCommission } from "./actions";
import type { CommissionDealKind } from "@/lib/sales-commission";

/**
 * Record the payout against the deal itself. Entitlement is computed, so there
 * may be no `Commission` row yet — the action upserts one with the amount it
 * recomputes server-side (nothing here is trusted with a peso figure).
 */
export function MarkPaid({ kind, refId, paid }: { kind: CommissionDealKind; refId: string; paid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Once paid, the commission stays paid — there's no "mark unpaid" any more.
  if (paid) return null;

  async function markPaid() {
    setBusy(true);
    setErr(null);
    try {
      await payDealCommission(kind, refId, true);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not record the payout.");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={markPaid}>
        {busy ? "…" : "Mark paid"}
      </Button>
      {err && <span className="max-w-[16rem] text-right text-[10px] leading-tight text-destructive">{err}</span>}
    </span>
  );
}
