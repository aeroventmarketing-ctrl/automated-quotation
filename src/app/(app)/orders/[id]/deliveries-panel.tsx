"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, Trash2, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { recordDelivery, deleteDelivery, recordQualityCheck, deleteQualityCheck } from "../actions";

export interface OrderedItem {
  description: string;
  ordered: number;
  qcPassed: number; // cumulative passed quality check
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
export interface QcView {
  id: string;
  date: string;
  lines: { description: string; qty: number }[];
  note: string;
  checkedByName: string;
}

type Mode = null | "qc" | "deliver";

/**
 * Quality check & partial delivery. Finished items must pass QC before they can
 * be delivered, and only QC-passed quantities are deliverable — so a client can
 * take checked batches (e.g. 20 of 50) while the rest are still being made.
 */
export function DeliveriesPanel({
  orderId,
  items,
  deliveries,
  qualityChecks,
  canQC,
  canDeliver,
  currency,
  outstanding,
}: {
  orderId: string;
  items: OrderedItem[];
  deliveries: DeliveryView[];
  qualityChecks: QcView[];
  canQC: boolean;
  canDeliver: boolean;
  currency: string;
  outstanding: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [drNumber, setDrNumber] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  // Per-item availability: how much can still be QC'd / delivered.
  const qcRemaining = (it: OrderedItem) => Math.max(0, it.ordered - it.qcPassed);
  const deliverable = (it: OrderedItem) => Math.max(0, it.qcPassed - it.delivered);
  const remaining = (it: OrderedItem) => Math.max(0, it.ordered - it.delivered);
  const capFor = (it: OrderedItem) => (mode === "qc" ? qcRemaining(it) : deliverable(it));

  const allQcDone = items.length > 0 && items.every((it) => qcRemaining(it) <= 0);
  const fullyDelivered = items.length > 0 && items.every((it) => remaining(it) <= 0);

  const enteredLines = useMemo(
    () =>
      items
        .map((it) => ({ description: it.description, qty: Math.floor(Number(qty[it.description] ?? "")) || 0 }))
        .filter((l) => l.qty > 0),
    [items, qty],
  );

  function reset() {
    setMode(null);
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
      if (mode === "qc") {
        await recordQualityCheck(orderId, { note, lines: enteredLines });
      } else {
        await recordDelivery(orderId, { drNumber, note, lines: enteredLines, payment: Number(payment) || 0, paymentNote });
      }
      reset();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeDelivery(id: string) {
    if (!window.confirm("Remove this delivery record?")) return;
    await run(() => deleteDelivery(orderId, id));
  }
  async function removeQc(id: string) {
    if (!window.confirm("Remove this quality-check record?")) return;
    await run(() => deleteQualityCheck(orderId, id));
  }
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
      {/* Ordered / QC passed / delivered / remaining */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">Item</th>
              <th className="px-3 py-1.5 text-right font-medium">Ordered</th>
              <th className="px-3 py-1.5 text-right font-medium">QC passed</th>
              <th className="px-3 py-1.5 text-right font-medium">Delivered</th>
              <th className="px-3 py-1.5 text-right font-medium">Remaining</th>
              {mode && <th className="px-3 py-1.5 text-right font-medium">{mode === "qc" ? "QC now" : "Deliver now"}</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const cap = capFor(it);
              return (
                <tr key={it.description} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{it.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{it.ordered}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{it.qcPassed}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{it.delivered}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {remaining(it) <= 0 ? <span className="text-emerald-600">0</span> : <span className="font-medium">{remaining(it)}</span>}
                  </td>
                  {mode && (
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        max={cap}
                        step={1}
                        disabled={busy || cap <= 0}
                        value={qty[it.description] ?? ""}
                        onChange={(e) => setQty((q) => ({ ...q, [it.description]: e.target.value }))}
                        className="h-8 w-20 rounded-md border bg-background px-2 text-right text-sm disabled:opacity-50"
                        placeholder={cap <= 0 ? "—" : `≤${cap}`}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {mode === "deliver" && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={drNumber} onChange={(e) => setDrNumber(e.target.value)} placeholder="DR / reference no. (optional)" className="h-9 w-52 rounded-md border bg-background px-2 text-sm" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-9 flex-1 min-w-[10rem] rounded-md border bg-background px-2 text-sm" />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            <label className="text-xs text-muted-foreground">Payment collected</label>
            <input type="number" min={0} step="0.01" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="0.00" className="h-9 w-32 rounded-md border bg-background px-2 text-right text-sm" />
            <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="Payment note / OR no. (optional)" className="h-9 flex-1 min-w-[10rem] rounded-md border bg-background px-2 text-sm" />
            <span className="text-[11px] text-muted-foreground">Outstanding: {formatCurrency(outstanding, currency)}</span>
          </div>
        </div>
      )}
      {mode === "qc" && (
        <div className="rounded-md border p-3">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="QC note (optional)" className="h-9 w-full rounded-md border bg-background px-2 text-sm" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {mode ? (
          <>
            <Button size="sm" className="h-8" disabled={busy || enteredLines.length === 0} onClick={submit}>
              {busy ? "Saving…" : mode === "qc" ? "Pass quality check" : "Record delivery"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={reset}>Cancel</Button>
          </>
        ) : (
          <>
            {canQC && (
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={allQcDone} onClick={() => setMode("qc")}>
                <BadgeCheck className="mr-1 h-3.5 w-3.5" /> {allQcDone ? "All items quality-checked" : "Mark quality checked"}
              </Button>
            )}
            {canDeliver && (
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={fullyDelivered || items.every((it) => deliverable(it) <= 0)} onClick={() => setMode("deliver")}>
                <Truck className="mr-1 h-3.5 w-3.5" /> {fullyDelivered ? "All items delivered" : "Record a delivery"}
              </Button>
            )}
          </>
        )}
      </div>
      {!mode && canDeliver && !fullyDelivered && items.every((it) => deliverable(it) <= 0) && (
        <p className="text-[11px] text-muted-foreground">Items must pass quality check before they can be delivered.</p>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}

      {/* QC history */}
      {qualityChecks.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quality checks</div>
          <ul className="space-y-2">
            {qualityChecks.map((c) => (
              <li key={c.id} className="rounded-md border bg-muted/20 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success">QC passed</Badge>
                  <span className="text-muted-foreground">{c.date}</span>
                  <span className="ml-auto text-muted-foreground">by {c.checkedByName}</span>
                  {canQC && (
                    <button type="button" disabled={busy} onClick={() => removeQc(c.id)} className="text-muted-foreground hover:text-destructive" title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <ul className="ml-4 mt-1 list-disc text-muted-foreground">
                  {c.lines.map((l, i) => <li key={i}>{l.qty} · {l.description}</li>)}
                </ul>
                {c.note && <p className="mt-1 text-muted-foreground"><span className="font-medium">Note:</span> {c.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Delivery history */}
      {deliveries.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deliveries</div>
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
                  {canDeliver && (
                    <button type="button" disabled={busy} onClick={() => removeDelivery(d.id)} className="text-muted-foreground hover:text-destructive" title="Remove">
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
        </div>
      )}
    </div>
  );
}
