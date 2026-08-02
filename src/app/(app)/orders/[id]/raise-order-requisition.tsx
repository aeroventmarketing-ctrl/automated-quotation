"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { raiseOrderRequisition } from "../actions";

/**
 * Raise a supplier requisition (→ PO) for an order's bought-in products — the buy
 * equivalent of the auto job orders. Lists exactly what will go on the PO (only
 * bought-in products; fabricated items and service/charges are excluded), and
 * files an order-linked Office requisition the Purchaser can turn into a PO.
 */
export function RaiseOrderRequisition({ orderId, items, alreadyRaised, paymentCleared }: { orderId: string; items: { name: string; qty: number; unitPrice: number | null }[]; alreadyRaised: boolean; paymentCleared: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await raiseOrderRequisition(orderId);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to raise the requisition.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        These bought-in products can be purchased from a supplier. Raising a requisition files them as an Office requisition linked to this order — the Purchaser turns it into a PO. Fabricated items and service charges (installation, delivery, mobilization) are not included.
      </p>
      <ul className="rounded-md border bg-muted/20 p-2 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-2 py-0.5">
            <span className="min-w-0 truncate">{it.name}</span>
            <span className="flex shrink-0 items-center gap-3 tabular-nums text-muted-foreground">
              <span>×{it.qty}</span>
              {it.unitPrice != null && <span>@ {formatCurrency(it.unitPrice)}</span>}
            </span>
          </li>
        ))}
      </ul>
      {alreadyRaised ? (
        <p className="text-xs text-emerald-700">
          A supplier requisition for this order has been raised — <Link href="/purchasing" className="underline">process it in Purchasing →</Link>
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8 text-xs" disabled={busy || !paymentCleared} onClick={submit}>
            <ShoppingCart className="mr-1 h-3.5 w-3.5" /> {busy ? "Raising…" : "Raise supplier requisition"}
          </Button>
          {!paymentCleared && <span className="text-xs text-muted-foreground">Available once payment is cleared.</span>}
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      )}
    </div>
  );
}
