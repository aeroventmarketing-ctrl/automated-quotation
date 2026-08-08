"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StockMatchPanel, type StockOpt } from "./stock-match-panel";
import { releaseOrderFromStock, confirmStockRelease } from "../actions";

type ReleaseMode = "delivery" | "office_pickup" | "plant_pickup";

/**
 * Phase 2 card for a from-stock order (F&B on-hand stock — angle corner, cleats,
 * clips, or office-supplied resale). Who releases the stock depends on the
 * fulfilment mode (the plant and office are far apart):
 *  - Office pick up → **Sales** releases from stock and notifies the client (one step).
 *  - Plant pick up  → the **Warehouse** releases, then the **Plant Manager** approves.
 *  - Delivery       → the **Plant Manager** releases, then **Sales** notifies the client.
 * The releaser matches each line to a stock item; inventory is deducted and the order
 * moves to Phase 5.
 */
export function StockRelease({
  orderId,
  lines,
  stockItems,
  mode,
  released,
  releasedByName,
  canRelease,
  canConfirm,
}: {
  orderId: string;
  lines: { name: string; qty: number }[];
  stockItems: StockOpt[];
  mode: ReleaseMode;
  /** The stock has been physically released (inventory deducted). */
  released: boolean;
  releasedByName?: string;
  /** May perform the physical release (step 1). */
  canRelease: boolean;
  /** May perform the second sign-off (step 2 — delivery / plant pick up only). */
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const releaseLabel =
    mode === "office_pickup" ? "Release from Stock and Notify Client"
      : mode === "plant_pickup" ? "Release From Stock"
      : "Release from Stock";
  const releaserPhrase = mode === "office_pickup" ? "Sales" : mode === "plant_pickup" ? "the Warehouse" : "the Plant Manager";
  const confirmLabel = mode === "plant_pickup" ? "Quality & Quantity Approved" : "Release from Stock & Notify Client";
  const confirmPhrase = mode === "plant_pickup" ? "the Plant Manager" : "Sales";
  const flowText =
    mode === "office_pickup"
      ? "Sales releases them from stock and notifies the client in one step; it then moves to final payment."
      : mode === "plant_pickup"
      ? "The Warehouse releases them from stock, then the Plant Manager approves; it then moves to final payment."
      : "The Plant Manager releases them from stock, then Sales notifies the client; it then moves to final payment.";

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); setOpen(false); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  const picker = (
    <StockMatchPanel
      lines={lines.map((l) => ({ label: `${l.qty} pcs · ${l.name}`, qtyDefault: String(l.qty) }))}
      stockItems={stockItems}
      submitLabel={releaseLabel}
      onCancel={() => setOpen(false)}
      onSubmit={(matches) => run(() => releaseOrderFromStock(orderId, matches.map((m) => ({ stockItemId: m.stockItemId, qty: m.qty }))))}
    />
  );

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/30">
        <div className="mb-1 font-medium text-sky-800 dark:text-sky-300">For stock release</div>
        <p className="text-xs text-muted-foreground">
          These items are held in Fans &amp; Blowers stock — no job order or purchase order. {flowText}
        </p>
        <ul className="mt-2 space-y-0.5 text-xs">
          {lines.map((l, i) => (
            <li key={i} className="text-foreground/80">{l.qty} × {l.name}</li>
          ))}
        </ul>
      </div>

      {!released ? (
        open && canRelease ? (
          picker
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
            <span className="text-amber-800 dark:text-amber-300">Awaiting {releaserPhrase} to release from stock.</span>
            {canRelease && (
              <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => setOpen(true)}>
                {releaseLabel}
              </Button>
            )}
          </div>
        )
      ) : (
        // Office pick up advances on release, so step 2 only shows for delivery / plant pick up.
        <>
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Released from stock{releasedByName ? ` — ${releasedByName}` : ""}.
          </p>
          {canConfirm ? (
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => confirmStockRelease(orderId))}>
              {busy ? "Saving…" : confirmLabel}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Awaiting {confirmPhrase} to {mode === "plant_pickup" ? "approve the release" : "notify the client"}.</p>
          )}
        </>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
