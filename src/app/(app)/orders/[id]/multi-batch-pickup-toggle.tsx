"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { setMultiBatchPickup } from "../actions";

/**
 * Office pickup: a single toggle that turns multiple-batch PICK UP on/off.
 *
 * Lock policy (per owner): an **admin** can turn it on and off at any time; a
 * **non-admin** (the salesperson) can turn it ON but NOT off — once on, only an
 * admin can turn it off. The server enforces this too.
 */
export function MultiBatchPickupToggle({
  orderId,
  enabled,
  admin,
  canTurnOn,
  hasOpenBatches = false,
}: {
  orderId: string;
  enabled: boolean;
  admin: boolean;
  /** May turn it on (the salesperson or an admin). */
  canTurnOn: boolean;
  hasOpenBatches?: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Non-admins can turn it on but never off; admins can do both.
  const locked = on && !admin;
  const canClick = admin || (!on && canTurnOn);

  async function toggle() {
    if (busy || !canClick) return;
    const next = !on;
    if (!next && !admin) {
      setErr("Only an admin can turn off multi-batch pick up.");
      return;
    }
    if (!next && hasOpenBatches) {
      setErr("Cancel the open pick-up batches first before turning it off.");
      return;
    }
    if (!next && !window.confirm("Turn off multi-batch pick up and return this order to single pick up?")) return;
    setBusy(true);
    setErr(null);
    try {
      await setMultiBatchPickup(orderId, next);
      setOn(next);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
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
        disabled={busy || !canClick}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
      <div className="flex items-center gap-1.5 text-sm">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{on ? "Multi-batch pick up on" : "Multi-batch pick up?"}</span>
      </div>
      {locked && <span className="text-[11px] text-muted-foreground">On — only an admin can turn this off.</span>}
      {busy && <span className="text-[11px] text-muted-foreground">Saving…</span>}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
