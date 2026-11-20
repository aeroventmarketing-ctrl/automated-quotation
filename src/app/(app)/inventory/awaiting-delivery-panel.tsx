"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAwaitingDelivery, removeUndeliveredStock } from "./actions";

export interface AwaitingHoldView {
  id: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  unit: string;
  qty: number;
  poRef: string;
  since: string;
  /** A short delivery left this behind — the PO itself is already received. */
  leftover: boolean;
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Bought stock that is in the inventory but not usable yet (lib/awaiting-delivery)
 * — shown to everyone on the Inventory tab, so anyone can remind the Warehouseman.
 */
export function AwaitingDeliveryPanel({ holds, canConfirm, canRemove }: { holds: AwaitingHoldView[]; canConfirm: boolean; canRemove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (holds.length === 0) return null;

  async function run(id: string, fn: () => Promise<void>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(id);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
        <PackageCheck className="h-4 w-4" />
        Bought — in stock but not usable yet ({holds.length})
      </div>
      <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
        Added when the cash &amp; check were released. They can&apos;t be issued, released to an MRF, sold or requested until the
        Warehouseman presses <b>Receive &amp; Add Stock</b> on the PO to confirm the delivery — remind the Warehouseman if the goods are already here.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="border-b border-amber-300 text-left text-amber-900/70 dark:text-amber-200/70">
              <th className="py-1 pr-2 font-medium">Item</th>
              <th className="py-1 pr-2 text-right font-medium">Not usable</th>
              <th className="py-1 pr-2 font-medium">PO</th>
              <th className="py-1 pr-2 font-medium">Since</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {holds.map((h) => (
              <tr key={h.id} className="border-b border-amber-200 last:border-0">
                <td className="py-1 pr-2">
                  <Link href={`/inventory/history?item=${h.itemId}`} className="font-medium hover:underline">{h.itemName}</Link>
                  {h.sku && <span className="ml-1 text-muted-foreground">SKU {h.sku}</span>}
                </td>
                <td className="whitespace-nowrap py-1 pr-2 text-right font-semibold tabular-nums">{fmt(h.qty)} {h.unit}</td>
                <td className="whitespace-nowrap py-1 pr-2">
                  {h.poRef}
                  <span className="ml-1 text-muted-foreground">
                    {h.leftover ? "· short delivery — the rest still to arrive" : "· awaiting Receive & Add Stock"}
                  </span>
                </td>
                <td className="whitespace-nowrap py-1 pr-2 text-muted-foreground">{when(h.since)}</td>
                <td className="whitespace-nowrap py-1 text-right">
                  {/* The PO's own Receive confirms a delivery; only what a short
                      delivery left behind is confirmed here. */}
                  {canConfirm && h.leftover && (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy === h.id}
                      onClick={() => run(h.id, () => confirmAwaitingDelivery(h.id), `Confirm the rest of ${h.itemName} arrived? ${fmt(h.qty)} ${h.unit} become usable.`)}>
                      Delivered
                    </Button>
                  )}
                  {canRemove && (
                    <Button size="sm" variant="outline" className="ml-1 h-6 px-2 text-[11px] text-destructive" disabled={busy === h.id}
                      onClick={() => run(h.id, () => removeUndeliveredStock(h.id), `Not delivered: take ${fmt(h.qty)} ${h.unit} of ${h.itemName} back out of stock?`)}>
                      Not delivered
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}
