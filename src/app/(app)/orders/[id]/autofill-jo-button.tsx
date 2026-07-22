"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { autofillJobOrders } from "../actions";

/**
 * Generate job orders from the paid quotation for an order already at the
 * JO-creation stage. Only fills departments that have no job orders yet, so it is
 * safe to run more than once and never overwrites manual edits.
 */
export function AutofillJobOrdersButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      await autofillJobOrders(orderId);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={run}>
        <Sparkles className="mr-1 h-3.5 w-3.5" /> {busy ? "Generating…" : "Auto-fill job orders from quotation"}
      </Button>
      <span className="text-[11px] text-muted-foreground">
        (Re)generates Fans, Duct, Accessories &amp; Motor Controller job orders from the paid quotation. Refreshes any that
        aren&apos;t approved yet; approved job orders are never overwritten.
      </span>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
