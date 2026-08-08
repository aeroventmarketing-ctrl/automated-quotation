"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, Store, Factory } from "lucide-react";
import { setFulfillmentMode } from "../actions";
import type { FulfillmentMode } from "@/lib/order-workflow";

const MODES: { key: FulfillmentMode; label: string; Icon: typeof Truck }[] = [
  { key: "delivery", label: "Delivery", Icon: Truck },
  { key: "office_pickup", label: "Office pick up", Icon: Store },
  { key: "plant_pickup", label: "Plant pick up", Icon: Factory },
];

/**
 * Phase 2 fulfilment/handover selector — Delivery / Office pick up / Plant pick up.
 * Options are limited to what the order's contents allow (`available`). An admin can
 * change it any time; a non-admin only before the order leaves Phase 2 (`canSet`).
 * The button row shows for EVERY role: interactive for those who may change it,
 * grayed-out (disabled, current mode still highlighted) for everyone else — so the
 * fulfilment mode is always visible and the control reads the same across roles.
 */
export function FulfillmentModeSelector({
  orderId,
  mode,
  available,
  canSet,
}: {
  orderId: string;
  mode: FulfillmentMode;
  available: FulfillmentMode[];
  canSet: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function pick(next: FulfillmentMode) {
    if (busy || next === mode || !canSet) return;
    setBusy(next);
    setErr(null);
    try {
      await setFulfillmentMode(orderId, next);
      router.refresh();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Failed";
      setErr(/omitted in production/i.test(m) ? "Couldn't change this — please try again." : m);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Fulfilment</span>
      <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-background p-1">
        {MODES.map(({ key, label, Icon }) => {
          const avail = available.includes(key);
          const active = key === mode;
          const interactive = canSet && avail;
          const title = !canSet
            ? "Only Sales, an Engineer, the Payment Approver or an admin can change this."
            : !avail
            ? "Not available for this order's items"
            : undefined;
          return (
            <button
              key={key}
              type="button"
              disabled={busy != null || !interactive}
              onClick={() => pick(key)}
              title={title}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                active
                  ? canSet
                    ? "bg-primary text-primary-foreground" // current mode, editable
                    : "bg-primary/40 text-primary-foreground" // current mode, read-only (grayed)
                  : interactive
                  ? "hover:bg-accent" // switchable
                  : "text-muted-foreground/40" // unavailable or read-only
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          );
        })}
      </div>
      {!canSet && <span className="text-[11px] text-muted-foreground">View only</span>}
      {busy && <span className="text-[11px] text-muted-foreground">Saving…</span>}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
