"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notifyClientBoughtInOrder } from "../actions";

/**
 * Phase 2 panel for a fully bought-in order (no fabrication). It skips production
 * and follows the PO flow: clearing payment auto-files the supplier requisition,
 * the Purchaser prepares the PO, the goods are received through the purchasing
 * chain, and Sales then notifies the client — which moves the order into Phase 5
 * (billing).
 */
export function BoughtInProduction({
  orderId,
  reqRaised,
  poPrepared,
  purchased,
  canNotify,
}: {
  orderId: string;
  reqRaised: boolean;
  poPrepared: boolean;
  purchased: boolean;
  canNotify: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function notify() {
    setBusy(true); setErr(null);
    try { await notifyClientBoughtInOrder(orderId); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed."); }
    finally { setBusy(false); }
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
        <p className="font-medium text-sky-800 dark:text-sky-300">Bought-in order — no fabrication (PO flow)</p>
        <p className="mt-0.5 text-xs text-sky-700/80 dark:text-sky-300/70">
          This order carries only goods bought from a supplier, so it skips production and warehouse stock. The Purchaser prepares the PO and buys the goods, then Sales notifies the client.
        </p>
      </div>
      <div className="space-y-1 text-sm">
        {step(reqRaised, "Payment cleared — supplier requisition filed")}
        {step(poPrepared, "Purchaser prepared the Purchase Order")}
        {step(purchased, "Purchaser bought the goods")}
      </div>

      {(reqRaised || poPrepared) && (
        <p className="text-xs text-muted-foreground">
          Prepare &amp; process the PO in <Link href="/purchasing" className="underline">Purchasing →</Link>
        </p>
      )}

      {canNotify && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-8 text-xs" disabled={busy || !purchased} onClick={notify}>
            <PackageCheck className="mr-1 h-3.5 w-3.5" /> {busy ? "Notifying…" : "Notify client – order ready"}
          </Button>
          {!purchased && <span className="text-xs text-muted-foreground">Available once the Purchaser has bought the goods.</span>}
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      )}
    </div>
  );
}
