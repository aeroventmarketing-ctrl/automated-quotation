"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { createMultiBatch, advanceMultiBatch, cancelMultiBatch } from "../actions";

export interface MBItem {
  description: string;
  ordered: number;
  batched: number;
  delivered: number;
}
export interface MBStepView {
  key: string;
  label: string;
  roleLabel: string;
  done: boolean;
  byName?: string;
  at?: string;
}
export interface MBBatchView {
  id: string;
  drNumber: string;
  createdByName: string;
  lines: { description: string; qty: number }[];
  paymentAmount?: number;
  cancelled: boolean;
  delivered: boolean;
  filed: boolean;
  steps: MBStepView[];
  next: { key: string; label: string; roleLabel: string; canAct: boolean; collectsPayment: boolean } | null;
  canCancel: boolean;
}

/**
 * Multiple-batch delivery — open a batch of finished items and run it through the
 * same delivery sequence the single-batch flow uses (payment first). Batches run
 * in parallel; each collects its partial payment at the "Payment checked" step.
 */
export function MultiBatchPanel({
  orderId,
  items,
  batches,
  canManage,
  currency,
  outstanding,
}: {
  orderId: string;
  items: MBItem[];
  batches: MBBatchView[];
  canManage: boolean;
  currency: string;
  outstanding: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [drNumber, setDrNumber] = useState("");
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");

  const available = (it: MBItem) => Math.max(0, it.ordered - it.batched);
  const newLines = useMemo(
    () => items.map((it) => ({ description: it.description, qty: Math.floor(Number(qty[it.description] ?? "")) || 0 })).filter((l) => l.qty > 0),
    [items, qty],
  );
  const anyAvailable = items.some((it) => available(it) > 0);

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
    if (newLines.length === 0) { setErr("Add a quantity for at least one item."); return; }
    await run("create", async () => {
      await createMultiBatch(orderId, { drNumber, lines: newLines });
      setCreating(false); setQty({}); setDrNumber("");
    });
  }

  async function advance(batchId: string, stepKey: string, collectsPayment: boolean) {
    if (collectsPayment && payFor !== batchId) { setPayFor(batchId); setPayAmount(""); setPayNote(""); return; }
    await run(batchId + stepKey, async () => {
      await advanceMultiBatch(orderId, batchId, stepKey, { payment: collectsPayment ? Number(payAmount) || 0 : undefined, paymentNote: collectsPayment ? payNote : undefined });
      setPayFor(null);
    });
  }

  return (
    <div className="space-y-3">
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
                  <td className="px-3 py-1.5 text-right tabular-nums">{avail <= 0 ? <span className="text-emerald-600">0</span> : <span className="font-medium">{avail}</span>}</td>
                  {creating && (
                    <td className="px-3 py-1.5 text-right">
                      <input type="number" min={0} max={avail} step={1} disabled={busy != null || avail <= 0}
                        value={qty[it.description] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [it.description]: e.target.value }))}
                        className="h-8 w-20 rounded-md border bg-background px-2 text-right text-sm disabled:opacity-50" placeholder={avail <= 0 ? "—" : `≤${avail}`} />
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
          <input value={drNumber} onChange={(e) => setDrNumber(e.target.value)} placeholder="DR / batch reference (optional)" className="h-9 w-full rounded-md border bg-background px-2 text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-8" disabled={busy != null || newLines.length === 0} onClick={submitCreate}>{busy === "create" ? "Opening…" : "Open batch"}</Button>
            <Button size="sm" variant="ghost" className="h-8" disabled={busy != null} onClick={() => { setCreating(false); setQty({}); setDrNumber(""); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        canManage && (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!anyAvailable} onClick={() => setCreating(true)}>
            <PackagePlus className="mr-1 h-3.5 w-3.5" /> {anyAvailable ? "Open delivery batch" : "All items in a batch"}
          </Button>
        )
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}

      {batches.map((b) => (
        <div key={b.id} className={`rounded-md border p-3 ${b.cancelled ? "opacity-60" : ""}`}>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant={b.cancelled ? "destructive" : b.filed ? "success" : b.delivered ? "success" : "secondary"}>
              {b.cancelled ? "Cancelled" : b.filed ? "Completed" : b.drNumber ? `DR ${b.drNumber}` : "Batch"}
            </Badge>
            {b.paymentAmount != null && b.paymentAmount > 0 && <Badge variant="success">Collected {formatCurrency(b.paymentAmount, currency)}</Badge>}
            <span className="text-xs text-muted-foreground">opened by {b.createdByName}</span>
            {b.canCancel && !b.cancelled && !b.filed && (
              <button type="button" disabled={busy != null} onClick={() => { if (window.confirm("Cancel this delivery batch?")) run(b.id + "cancel", () => cancelMultiBatch(orderId, b.id)); }} className="ml-auto text-muted-foreground hover:text-destructive" title="Cancel batch">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <ul className="ml-1 mb-2 text-xs text-muted-foreground">
            {b.lines.map((l, i) => <li key={i}>{l.qty} · {l.description}</li>)}
          </ul>

          <ol className="space-y-0.5 text-xs">
            {b.steps.map((s) => (
              <li key={s.key} className={`flex flex-wrap items-center gap-1.5 ${s.done ? "text-foreground" : "text-muted-foreground/60"}`}>
                {s.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Circle className="h-3.5 w-3.5" />}
                <span>{s.label}</span>
                <span className={s.done ? "text-muted-foreground" : "text-muted-foreground/60"}>({s.roleLabel})</span>
                {s.done && s.byName && <span className="text-muted-foreground">— {s.byName}{s.at ? ` · ${s.at}` : ""}</span>}
              </li>
            ))}
          </ol>

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
