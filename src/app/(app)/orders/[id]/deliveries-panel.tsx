"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { recordDelivery, deleteDelivery } from "../actions";

export interface OrderedItem {
  description: string;
  ordered: number;
  delivered: number; // cumulative already delivered
}
export interface DeliveryView {
  id: string;
  date: string;
  drNumber: string;
  lines: { description: string; qty: number }[];
  note: string;
  deliveredByName: string;
  paymentAmount?: number;
}

/**
 * Partial deliveries — record a Delivery Receipt for finished items (e.g. 20 of
 * 50 now, 30 later). Shows ordered vs delivered vs remaining per item and the
 * history of deliveries. Available once the first department has finished.
 */
export function DeliveriesPanel({
  orderId,
  items,
  deliveries,
  canManage,
  currency,
  outstanding,
}: {
  orderId: string;
  items: OrderedItem[];
  deliveries: DeliveryView[];
  canManage: boolean;
  currency: string;
  outstanding: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [drNumber, setDrNumber] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const remainingOf = (it: OrderedItem) => Math.max(0, it.ordered - it.delivered);
  const fullyDelivered = items.length > 0 && items.every((it) => remainingOf(it) <= 0);

  const enteredLines = useMemo(
    () =>
      items
        .map((it) => ({ description: it.description, qty: Math.floor(Number(qty[it.description] ?? "")) || 0 }))
        .filter((l) => l.qty > 0),
    [items, qty],
  );

  function reset() {
    setAdding(false);
    setQty({});
    setDrNumber("");
    setNote("");
    setPayment("");
    setPaymentNote("");
    setErr(null);
  }

  async function submit() {
    if (enteredLines.length === 0) {
      setErr("Enter a quantity for at least one item.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await recordDelivery(orderId, {
        drNumber,
        note,
        lines: enteredLines,
        payment: Number(payment) || 0,
        paymentNote,
      });
      reset();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this delivery record?")) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteDelivery(orderId, id);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Ordered vs delivered vs remaining */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">Item</th>
              <th className="px-3 py-1.5 text-right font-medium">Ordered</th>
              <th className="px-3 py-1.5 text-right font-medium">Delivered</th>
              <th className="px-3 py-1.5 text-right font-medium">Remaining</th>
              {adding && <th className="px-3 py-1.5 text-right font-medium">Deliver now</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const rem = remainingOf(it);
              return (
                <tr key={it.description} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{it.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{it.ordered}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{it.delivered}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {rem <= 0 ? <span className="text-emerald-600">0</span> : <span className="font-medium">{rem}</span>}
                  </td>
                  {adding && (
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        max={rem}
                        step={1}
                        disabled={busy || rem <= 0}
                        value={qty[it.description] ?? ""}
                        onChange={(e) => setQty((q) => ({ ...q, [it.description]: e.target.value }))}
                        className="h-8 w-20 rounded-md border bg-background px-2 text-right text-sm disabled:opacity-50"
                        placeholder={rem <= 0 ? "—" : "0"}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding ? (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={drNumber}
              onChange={(e) => setDrNumber(e.target.value)}
              placeholder="DR / reference no. (optional)"
              className="h-9 w-52 rounded-md border bg-background px-2 text-sm"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="h-9 flex-1 min-w-[10rem] rounded-md border bg-background px-2 text-sm"
            />
          </div>
          {/* Optional partial payment collected with this delivery. */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            <label className="text-xs text-muted-foreground">Payment collected</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              placeholder="0.00"
              className="h-9 w-32 rounded-md border bg-background px-2 text-right text-sm"
            />
            <input
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              placeholder="Payment note / OR no. (optional)"
              className="h-9 flex-1 min-w-[10rem] rounded-md border bg-background px-2 text-sm"
            />
            <span className="text-[11px] text-muted-foreground">Outstanding: {formatCurrency(outstanding, currency)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-8" disabled={busy || enteredLines.length === 0} onClick={submit}>
              {busy ? "Saving…" : "Record delivery"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={reset}>Cancel</Button>
          </div>
        </div>
      ) : (
        canManage && (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={fullyDelivered} onClick={() => setAdding(true)}>
            <Truck className="mr-1 h-3.5 w-3.5" /> {fullyDelivered ? "All items delivered" : "Record a delivery"}
          </Button>
        )
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}

      {/* Delivery history */}
      {deliveries.length > 0 && (
        <ul className="space-y-2">
          {deliveries.map((d) => (
            <li key={d.id} className="rounded-md border bg-muted/20 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{d.drNumber ? `DR ${d.drNumber}` : "Delivery"}</Badge>
                <span className="text-muted-foreground">{d.date}</span>
                {d.paymentAmount != null && d.paymentAmount > 0 && (
                  <Badge variant="success">Collected {formatCurrency(d.paymentAmount, currency)}</Badge>
                )}
                <span className="ml-auto text-muted-foreground">by {d.deliveredByName}</span>
                {canManage && (
                  <button type="button" disabled={busy} onClick={() => remove(d.id)} className="text-muted-foreground hover:text-destructive" title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <ul className="ml-4 mt-1 list-disc text-muted-foreground">
                {d.lines.map((l, i) => <li key={i}>{l.qty} · {l.description}</li>)}
              </ul>
              {d.note && <p className="mt-1 text-muted-foreground"><span className="font-medium">Note:</span> {d.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
