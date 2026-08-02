"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { releaseBoughtInOrder } from "../actions";

/**
 * Phase 2 panel for a bought-in-only order — one with no fabricated items, only
 * goods bought from a supplier. Aerovent never produces these, so they skip
 * production: the Engineer raises the supplier requisition (card below), the
 * Purchaser buys the goods, and then the order is released straight to Phase 5.
 * The release button stays disabled until the Purchaser has bought the goods.
 */
export function BoughtInProduction({
  orderId,
  reqRaised,
  reqPurchased,
  canRelease,
}: {
  orderId: string;
  reqRaised: boolean;
  reqPurchased: boolean;
  canRelease: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function release() {
    setBusy(true); setErr(null);
    try {
      await releaseBoughtInOrder(orderId);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to release the order.");
    } finally {
      setBusy(false);
    }
  }

  const step = (done: boolean, text: string) => (
    <div className="flex items-center gap-2">
      {done ? <span className="text-emerald-600">✓</span> : <span className="text-muted-foreground">○</span>}
      <span className={done ? "" : "text-muted-foreground"}>{text}</span>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-900/50 dark:bg-sky-950/30">
        <p className="font-medium text-sky-800 dark:text-sky-300">Bought-in order — no fabrication</p>
        <p className="mt-0.5 text-xs text-sky-700/80 dark:text-sky-300/70">
          This order carries only goods bought from a supplier, so it skips production. Raise the supplier requisition (below), the Purchaser buys the goods, then release the order to continue to final payment &amp; delivery.
        </p>
      </div>
      <div className="space-y-1 text-sm">
        {step(reqRaised, "Supplier requisition raised")}
        {step(reqPurchased, "Purchaser bought the goods")}
      </div>
      {canRelease && (
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8 text-xs" disabled={busy || !reqPurchased} onClick={release}>
            <PackageCheck className="mr-1 h-3.5 w-3.5" /> {busy ? "Releasing…" : "Release to delivery"}
          </Button>
          {!reqPurchased && <span className="text-xs text-muted-foreground">Available once the Purchaser has bought the goods.</span>}
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      )}
    </div>
  );
}
