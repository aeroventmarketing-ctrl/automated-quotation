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
 * Non-setters see the current mode as a read-only tag.
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

  const current = MODES.find((m) => m.key === mode) ?? MODES[0];

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

  if (!canSet) {
    const Icon = current.Icon;
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
        <Icon className="h-4 w-4" /> {current.label}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Fulfilment</span>
      <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-background p-1">
        {MODES.map(({ key, label, Icon }) => {
          const avail = available.includes(key);
          const active = key === mode;
          return (
            <button
              key={key}
              type="button"
              disabled={busy != null || !avail}
              onClick={() => pick(key)}
              title={!avail ? "Not available for this order's items" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                active ? "bg-primary text-primary-foreground" : avail ? "hover:bg-accent" : "text-muted-foreground/50"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          );
        })}
      </div>
      {busy && <span className="text-[11px] text-muted-foreground">Saving…</span>}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
