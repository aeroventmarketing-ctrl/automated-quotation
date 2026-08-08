"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StockMatchPanel, type StockOpt } from "./stock-match-panel";
import { releaseOrderFromStock, confirmStockRelease, notifyStockReleaseClient } from "../actions";

type ReleaseMode = "delivery" | "office_pickup" | "plant_pickup";

/**
 * Phase 2 card for a from-stock order (F&B on-hand stock — angle corner, cleats,
 * clips, or office-supplied resale). Who releases the stock depends on the
 * fulfilment mode (the plant and office are far apart):
 *  - Office pick up → **Sales** releases from stock and notifies the client (one step).
 *  - Plant pick up  → the **Warehouse** releases, then the **Plant Manager** approves.
 *  - Delivery       → the **Warehouse** releases, the **Plant Manager** approves the
 *    quality & quantity, then **Sales** notifies the client.
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
  approved,
  approvedByName,
  canRelease,
  canConfirm,
  canNotify,
}: {
  orderId: string;
  lines: { name: string; qty: number }[];
  stockItems: StockOpt[];
  mode: ReleaseMode;
  /** The stock has been physically released (inventory deducted). */
  released: boolean;
  releasedByName?: string;
  /** The Plant Manager has approved the release (delivery — before Sales notifies). */
  approved?: boolean;
  approvedByName?: string;
  /** May perform the physical release (step 1). */
  canRelease: boolean;
  /** May perform the Plant Manager approval (delivery / plant pick up). */
  canConfirm: boolean;
  /** May perform the Sales client-notify (delivery only, after approval). */
  canNotify: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const releaseLabel =
    mode === "office_pickup" ? "Release from Stock & Notify Client"
      : "Release from Stock";
  const releaserPhrase = mode === "office_pickup" ? "Sales" : "the Warehouse";
  const flowText =
    mode === "office_pickup"
      ? "Sales releases them from stock and notifies the client in one step; it then moves to final payment."
      : mode === "plant_pickup"
      ? "The Warehouse releases them from stock, then the Plant Manager approves; it then moves to final payment."
      : "The Warehouse releases them from stock, the Plant Manager approves, then Sales notifies the client; it then moves to final payment.";

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
        // Office pick up advances on release, so the sign-off steps only show for
        // delivery / plant pick up. Delivery: Plant Manager approves, then Sales notifies.
        <>
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Released from stock{releasedByName ? ` — ${releasedByName}` : ""}.
          </p>
          {!approved ? (
            // Step 2 — Plant Manager quality & quantity approval (delivery & plant pick up).
            canConfirm ? (
              <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => confirmStockRelease(orderId))}>
                {busy ? "Saving…" : "Quality & Quantity Approved"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Awaiting the Plant Manager to approve the release.</p>
            )
          ) : (
            // Step 3 — Sales notifies the client (delivery only; plant pick up advances on approval).
            <>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Quality &amp; quantity approved{approvedByName ? ` — ${approvedByName}` : ""}.
              </p>
              {canNotify ? (
                <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => notifyStockReleaseClient(orderId))}>
                  {busy ? "Saving…" : "Release from Stock & Notify Client"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Awaiting Sales to notify the client.</p>
              )}
            </>
          )}
        </>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
