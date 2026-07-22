"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { createDeliveryBatch, advanceDeliveryBatch, cancelDeliveryBatch } from "../actions";

export interface OrderedItem {
  description: string;
  ordered: number;
  batched: number; // committed to non-cancelled batches
  delivered: number; // delivered (batch reached the delivery step)
}
export interface BatchStepView {
  key: string;
  label: string;
  done: boolean;
  byName?: string;
  at?: string;
}
export interface BatchView {
  id: string;
  drNumber: string;
  paymentModeLabel: string;
  createdByName: string;
  lines: { description: string; qty: number }[];
  paymentAmount?: number;
  cancelled: boolean;
  delivered: boolean;
  complete: boolean;
  steps: BatchStepView[];
  next: { key: string; label: string; roleLabel: string; canAct: boolean; collectsPayment: boolean } | null;
  canCancel: boolean;
}

/**
 * Delivery batches — open a batch of finished items and run it through the
 * 13-step pipeline (inform client → bill → collect & clear payment → quality
 * testing → Plant Manager QC → transfer → Sales re-check → documents → deliver →
 * approve proof → surrender documents). Batches run in parallel.
 */
export function DeliveriesPanel({
  orderId,
  items,
  batches,
  canCreate,
  currency,
  outstanding,
}: {
  orderId: string;
  items: OrderedItem[];
  batches: BatchView[];
  canCreate: boolean;
  currency: string;
  outstanding: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [drNumber, setDrNumber] = useState("");
  const [paymentMode, setPaymentMode] = useState<"prepay" | "cod">("prepay");
  // Per-batch inline payment entry (for the "paid" step).
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");

  const available = (it: OrderedItem) => Math.max(0, it.ordered - it.batched);

  const newLines = useMemo(
    () =>
      items
        .map((it) => ({ description: it.description, qty: Math.floor(Number(qty[it.description] ?? "")) || 0 }))
        .filter((l) => l.qty > 0),
    [items, qty],
  );

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
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

  async function submitCreate() {
    if (newLines.length === 0) {
      setErr("Add a quantity for at least one item.");
      return;
    }
    await run("create", async () => {
      await createDeliveryBatch(orderId, { drNumber, paymentMode, lines: newLines });
      setCreating(false);
      setQty({});
      setDrNumber("");
      setPaymentMode("prepay");
    });
  }

  async function advance(batchId: string, stepKey: string, collectsPayment: boolean) {
    if (collectsPayment && payFor !== batchId) {
      setPayFor(batchId);
      setPayAmount("");
      setPayNote("");
      return;
    }
    await run(batchId + stepKey, async () => {
      await advanceDeliveryBatch(orderId, batchId, stepKey, {
        payment: collectsPayment ? Number(payAmount) || 0 : undefined,
        paymentNote: collectsPayment ? payNote : undefined,
      });
      setPayFor(null);
    });
  }

  const anyAvailable = items.some((it) => available(it) > 0);

  return (
    <div className="space-y-3">
      {/* Item availability */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">Item</th>
              <th className="px-3 py-1.5 text-right font-medium">Ordered</th>
              <th className="px-3 py-1.5 text-right font-medium">In batches</th>
              <th className="px-3 py-1.5 text-right font-medium">Delivered</th>
              <th className="px-3 py-1.5 text-right font-medium">Available</th>
              {creating && <th className="px-3 py-1.5 text-right font-medium">Add</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const avail = available(it);
              return (
                <tr key={it.description} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{it.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{it.ordered}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{it.batched}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{it.delivered}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {avail <= 0 ? <span className="text-emerald-600">0</span> : <span className="font-medium">{avail}</span>}
                  </td>
                  {creating && (
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number" min={0} max={avail} step={1} disabled={busy != null || avail <= 0}
                        value={qty[it.description] ?? ""}
                        onChange={(e) => setQty((q) => ({ ...q, [it.description]: e.target.value }))}
                        className="h-8 w-20 rounded-md border bg-background px-2 text-right text-sm disabled:opacity-50"
                        placeholder={avail <= 0 ? "—" : `≤${avail}`}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating ? (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">Payment</label>
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as "prepay" | "cod")} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="prepay">Payment before delivery</option>
              <option value="cod">Cash on delivery</option>
            </select>
            <input value={drNumber} onChange={(e) => setDrNumber(e.target.value)} placeholder="DR / batch reference (optional)" className="h-9 flex-1 min-w-[10rem] rounded-md border bg-background px-2 text-sm" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-8" disabled={busy != null || newLines.length === 0} onClick={submitCreate}>{busy === "create" ? "Opening…" : "Open batch"}</Button>
            <Button size="sm" variant="ghost" className="h-8" disabled={busy != null} onClick={() => { setCreating(false); setQty({}); setDrNumber(""); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        canCreate && (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!anyAvailable} onClick={() => setCreating(true)}>
            <PackagePlus className="mr-1 h-3.5 w-3.5" /> {anyAvailable ? "Open delivery batch" : "All items in a batch"}
          </Button>
        )
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}

      {/* Batches */}
      {batches.map((b) => (
        <div key={b.id} className={`rounded-md border p-3 ${b.cancelled ? "opacity-60" : ""}`}>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant={b.cancelled ? "destructive" : b.complete ? "success" : b.delivered ? "success" : "secondary"}>
              {b.cancelled ? "Cancelled" : b.complete ? "Completed" : b.drNumber ? `DR ${b.drNumber}` : "Batch"}
            </Badge>
            <Badge variant="secondary">{b.paymentModeLabel}</Badge>
            {b.paymentAmount != null && b.paymentAmount > 0 && (
              <Badge variant="success">Collected {formatCurrency(b.paymentAmount, currency)}</Badge>
            )}
            <span className="text-xs text-muted-foreground">opened by {b.createdByName}</span>
            {b.canCancel && !b.cancelled && !b.complete && (
              <button type="button" disabled={busy != null} onClick={() => { if (window.confirm("Cancel this delivery batch?")) run(b.id + "cancel", () => cancelDeliveryBatch(orderId, b.id)); }} className="ml-auto text-muted-foreground hover:text-destructive" title="Cancel batch">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <ul className="ml-1 mb-2 text-xs text-muted-foreground">
            {b.lines.map((l, i) => <li key={i}>{l.qty} · {l.description}</li>)}
          </ul>

          {/* 13-step progress */}
          <ol className="space-y-0.5 text-xs">
            {b.steps.map((s) => (
              <li key={s.key} className={`flex items-center gap-1.5 ${s.done ? "text-foreground" : "text-muted-foreground/60"}`}>
                {s.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Circle className="h-3.5 w-3.5" />}
                <span>{s.label}</span>
                {s.done && s.byName && <span className="text-muted-foreground">— {s.byName}{s.at ? ` · ${s.at}` : ""}</span>}
              </li>
            ))}
          </ol>

          {/* Next step action */}
          {!b.cancelled && b.next && (
            <div className="mt-2">
              {b.next.canAct ? (
                payFor === b.id && b.next.collectsPayment ? (
                  <div className="space-y-2 rounded-md border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs text-muted-foreground">Payment collected</label>
                      <input type="number" min={0} step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0.00" className="h-8 w-32 rounded-md border bg-background px-2 text-right text-sm" />
                      <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="OR no. / note (optional)" className="h-8 flex-1 min-w-[9rem] rounded-md border bg-background px-2 text-sm" />
                      <span className="text-[11px] text-muted-foreground">Outstanding: {formatCurrency(outstanding, currency)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="h-7 text-xs" disabled={busy != null} onClick={() => advance(b.id, b.next!.key, true)}>{busy === b.id + b.next.key ? "Saving…" : "Record payment"}</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy != null} onClick={() => setPayFor(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" className="h-7 text-xs" disabled={busy != null} onClick={() => advance(b.id, b.next!.key, b.next!.collectsPayment)}>
                    {busy === b.id + b.next.key ? "Saving…" : b.next.label}
                  </Button>
                )
              ) : (
                <p className="text-xs text-muted-foreground">Waiting on {b.next.roleLabel} — {b.next.label}</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
