"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { setBatchDeliveryEnabled } from "../actions";

/**
 * Engineer / Payment Approver / admin toggle that enables the multiple-batch
 * delivery option for an order. When ON, the "Deliver in multiple batches?"
 * entry panel appears (once production has started). Locked on once the order is
 * already being delivered in batches.
 */
export function BatchDeliveryToggle({ orderId, enabled, multiActive = false }: { orderId: string; enabled: boolean; multiActive?: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    const next = !on;
    // Turning off while the order is in multi-batch mode returns it to the
    // single-delivery flow — confirm first.
    if (!next && multiActive && !window.confirm("Turn off batch delivery and return this order to single delivery?")) return;
    setBusy(true);
    setErr(null);
    try {
      await setBatchDeliveryEnabled(orderId, next);
      setOn(next);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
      <div className="flex items-center gap-1.5 text-sm">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{on ? "Batch delivery enabled" : "Enable batch delivery"}</span>
      </div>
      {busy && <span className="text-[11px] text-muted-foreground">Saving…</span>}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
