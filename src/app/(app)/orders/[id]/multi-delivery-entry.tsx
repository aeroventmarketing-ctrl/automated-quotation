"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setMultiDelivery } from "../actions";

/**
 * Switch the order to multiple-batch delivery (for large orders delivered in
 * parts). Only Sales or an admin, allowed from when production starts up until
 * just before the order is actually delivered — including after the single
 * delivery flow has begun (that progress is then set aside).
 */
export function MultiDeliveryEntry({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!window.confirm("Switch this order to multiple-batch delivery? The single-delivery flow will be set aside (any single-delivery steps already done are ignored); collected payments carry over and each batch is billed, paid, checked and delivered on its own.")) return;
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
