"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { setOfficePickup } from "../actions";

/**
 * Sales / admin toggle that marks an order as "Office pick up" — the client
 * collects the goods at the office instead of the order being delivered.
 *
 * Step 1: this only persists the flag and surfaces it as a tag. It does not yet
 * change the Phase 5 delivery steps (that wiring is a separate change).
 */
export function OfficePickupToggle({ orderId, enabled }: { orderId: string; enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    const next = !on;
    setBusy(true);
    setErr(null);
    try {
      await setOfficePickup(orderId, next);
      setOn(next);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      // Next redacts server-action error messages in production; show a friendly
      // fallback instead of the raw "omitted in production builds" text.
      setErr(/omitted in production/i.test(msg) ? "Couldn't change this setting — please try again." : msg);
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
        <Store className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">On - Office pick up / Off - Delivery</span>
      </div>
      {busy && <span className="text-[11px] text-muted-foreground">Saving…</span>}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
