"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setMultiDelivery } from "../actions";

/**
 * One-time choice at Phase 5: switch the order to multiple-batch delivery (for
 * large orders delivered in parts). Only Sales or an admin, and only before the
 * single-batch flow has started.
 */
export function MultiDeliveryEntry({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!window.confirm("Deliver this order in multiple batches? The single-delivery flow won't be used for this order.")) return;
    setBusy(true);
    setErr(null);
    try {
      await setMultiDelivery(orderId);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 border-t pt-2">
      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={go}>
        <Layers className="mr-1 h-3.5 w-3.5" /> {busy ? "Switching…" : "Deliver in multiple batches instead"}
      </Button>
      <p className="mt-1 text-[11px] text-muted-foreground">For large orders delivered in parts — each batch is billed, paid, quality-checked and delivered on its own.</p>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}
