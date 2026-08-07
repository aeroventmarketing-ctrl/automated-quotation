"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StockMatchPanel, type StockOpt } from "./stock-match-panel";
import { releaseOrderFromStock, approveStockRelease } from "../actions";

/**
 * Phase 2 card for a from-stock order (in-house duct hardware — angle corner,
 * cleats, clips — nothing fabricated or bought from a supplier). The Plant Manager
 * or an Engineer approves the release first; then the Warehouse / Fans & Blowers head
 * matches each line to a stock item and releases it: inventory is deducted and the
 * order jumps to Phase 5. Mirrors the MRF release picker.
 */
export function StockRelease({
  orderId,
  lines,
  stockItems,
  canRelease,
  approved,
  approvedByName,
  canApprove,
  engineerEligible = false,
}: {
  orderId: string;
  lines: { name: string; qty: number }[];
  stockItems: StockOpt[];
  canRelease: boolean;
  approved: boolean;
  approvedByName?: string;
  canApprove: boolean;
  // An Engineer may approve only when every line is in-house duct hardware; an
  // order with Office-supplied stock is Plant-Manager-only. Controls the wording.
  engineerEligible?: boolean;
}) {
  const router = useRouter();
  // Who may approve this order's release, for the on-screen wording.
  const approverPhrase = engineerEligible ? "Plant Manager or an Engineer" : "Plant Manager";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/30">
        <div className="mb-1 font-medium text-sky-800 dark:text-sky-300">For stock release</div>
        <p className="text-xs text-muted-foreground">
          These items are produced in-house by Fans &amp; Blowers and held in stock — no job order or
          purchase order. The {approverPhrase} approves the release, then the Warehouse
          issues them from inventory to fulfil the order; it then moves to final payment.
        </p>
        <ul className="mt-2 space-y-0.5 text-xs">
          {lines.map((l, i) => (
            <li key={i} className="text-foreground/80">{l.qty} × {l.name}</li>
          ))}
        </ul>
      </div>

      {/* Step 1 — Plant Manager / Engineer approval gate. */}
      {!approved ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <span className="text-amber-800 dark:text-amber-300">Awaiting {approverPhrase} approval to release from stock.</span>
          {canApprove && (
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => approveStockRelease(orderId))}>
              {busy ? "Approving…" : "Approve stock release"}
            </Button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Stock release approved{approvedByName ? ` — ${approvedByName}` : ""}.
          </p>
          {/* Step 2 — Warehouse / Fans releases from stock. */}
          {!canRelease ? (
            <p className="text-xs text-muted-foreground">Awaiting the Warehouse / Fans &amp; Blowers to release the stock.</p>
          ) : open ? (
            <StockMatchPanel
              lines={lines.map((l) => ({ label: `${l.qty} pcs · ${l.name}`, qtyDefault: String(l.qty) }))}
              stockItems={stockItems}
              submitLabel="Release from stock & notify client"
              onCancel={() => setOpen(false)}
              onSubmit={async (matches) => {
                setBusy(true);
                setErr(null);
                try {
                  await releaseOrderFromStock(orderId, matches.map((m) => ({ stockItemId: m.stockItemId, qty: m.qty })));
                  setOpen(false);
                  router.refresh();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Failed to release from stock");
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : (
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => setOpen(true)}>
              Release from stock
            </Button>
          )}
        </>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
