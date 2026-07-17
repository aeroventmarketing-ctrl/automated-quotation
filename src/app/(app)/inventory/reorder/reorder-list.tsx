"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markOnOrder, markAllOnOrder, requestReplenishmentPO, receiveReorder, cancelOnOrder } from "./actions";

export interface NeedsRow {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  onHand: number;
  reorderLevel: number;
  status: "out" | "low";
  suggestQty: string;
}
export interface OnOrderRow {
  id: string;
  name: string;
  unit: string;
  onHand: number;
  orderedQty: number;
  byName: string;
  at: string;
  note: string;
}

export function ReorderList({ needs, onOrder, canAct }: { needs: NeedsRow[]; onOrder: OnOrderRow[]; canAct: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(needs.map((n) => [n.id, n.suggestQty])));
  const [note, setNote] = useState<Record<string, string>>({});
  const [recvQty, setRecvQty] = useState<Record<string, string>>(() => Object.fromEntries(onOrder.map((o) => [o.id, String(o.orderedQty)])));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<void>) {
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

  // Items with a positive order qty entered — used by the bulk action.
  const orderable = needs.map((n) => ({ stockItemId: n.id, qty: Number(qty[n.id]) || 0, note: note[n.id] || undefined })).filter((i) => i.qty > 0);
  function orderAll() {
    if (orderable.length === 0) return;
    run("__all__", () => markAllOnOrder({ items: orderable }));
  }
  function requestPO(id: string) {
    const it = orderable.find((o) => o.stockItemId === id);
    if (!it) return;
    run(id, () => requestReplenishmentPO({ items: [it] }));
  }
  function requestAllPO() {
    if (orderable.length === 0) return;
    run("__po_all__", () => requestReplenishmentPO({ items: orderable }));
  }

  return (
    <div className="space-y-6">
      {/* Needs reordering */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Needs reordering <span className="text-muted-foreground">({needs.length})</span></h2>
          <div className="flex items-center gap-2 print:hidden">
            {canAct && orderable.length > 0 && (
              <>
                <Button size="sm" className="h-7 text-xs" disabled={busy === "__po_all__"} onClick={requestAllPO}>
                  {busy === "__po_all__" ? "Requesting…" : `Request POs (${orderable.length})`}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === "__all__"} onClick={orderAll}>
                  {busy === "__all__" ? "Ordering…" : `Quick order all (${orderable.length})`}
                </Button>
              </>
            )}
            {needs.length > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.print()}>Print list</Button>
            )}
          </div>
        </div>
        {needs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to reorder — all stock is above its reorder level.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="py-2 px-3 font-medium">Item</th>
                  <th className="py-2 px-2 font-medium text-right">On hand</th>
                  <th className="py-2 px-2 font-medium text-right">Reorder at</th>
                  <th className="py-2 px-2 font-medium">Status</th>
                  {canAct && <th className="py-2 px-2 font-medium w-28">Order qty</th>}
                  {canAct && <th className="py-2 px-3 font-medium print:hidden"></th>}
                </tr>
              </thead>
              <tbody>
                {needs.map((n) => (
                  <tr key={n.id} className="border-b last:border-0 align-top">
                    <td className="py-2 px-3">
                      <div className="font-medium">{n.name}</div>
                      {n.category && <div className="text-xs text-muted-foreground">{n.category}</div>}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">{n.onHand} {n.unit}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{n.reorderLevel > 0 ? `${n.reorderLevel} ${n.unit}` : "—"}</td>
                    <td className="py-2 px-2"><Badge variant={n.status === "out" ? "destructive" : "warning"}>{n.status === "out" ? "Out" : "Low"}</Badge></td>
                    {canAct && (
                      <td className="py-2 px-2">
                        <Input className="h-8 w-24 print:hidden" type="number" step="any" min={0} placeholder="Qty"
                          value={qty[n.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [n.id]: e.target.value }))} />
                      </td>
                    )}
                    {canAct && (
                      <td className="py-2 px-3 print:hidden">
                        <div className="flex flex-col gap-1">
                          <Input className="h-8 w-40" placeholder="Note (optional)"
                            value={note[n.id] ?? ""} onChange={(e) => setNote((x) => ({ ...x, [n.id]: e.target.value }))} />
                          <div className="flex gap-1">
                            <Button size="sm" className="h-8" disabled={busy === n.id || !(Number(qty[n.id]) > 0)}
                              onClick={() => requestPO(n.id)}>
                              {busy === n.id ? "…" : "Request PO"}
                            </Button>
                            <Button size="sm" variant="outline" className="h-8" disabled={busy === n.id || !(Number(qty[n.id]) > 0)}
                              onClick={() => run(n.id, () => markOnOrder({ stockItemId: n.id, qty: Number(qty[n.id]), note: note[n.id] || undefined }))}>
                              {busy === n.id ? "…" : "Quick order"}
                            </Button>
                          </div>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* On order */}
      <section className="space-y-3 print:hidden">
        <h2 className="text-sm font-semibold">On order <span className="text-muted-foreground">({onOrder.length})</span></h2>
        {onOrder.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outstanding reorders.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="py-2 px-3 font-medium">Item</th>
                  <th className="py-2 px-2 font-medium text-right">On hand</th>
                  <th className="py-2 px-2 font-medium text-right">Ordered</th>
                  <th className="py-2 px-2 font-medium">Placed by</th>
                  {canAct && <th className="py-2 px-2 font-medium w-28">Receive qty</th>}
                  {canAct && <th className="py-2 px-3 font-medium"></th>}
                </tr>
              </thead>
              <tbody>
                {onOrder.map((o) => (
                  <tr key={o.id} className="border-b last:border-0 align-top">
                    <td className="py-2 px-3">
                      <div className="font-medium">{o.name}</div>
                      {o.note && <div className="text-xs text-muted-foreground">{o.note}</div>}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">{o.onHand} {o.unit}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{o.orderedQty} {o.unit}</td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">{o.byName}{o.at ? ` · ${o.at}` : ""}</td>
                    {canAct && (
                      <td className="py-2 px-2">
                        <Input className="h-8 w-24" type="number" step="any" min={0}
                          value={recvQty[o.id] ?? ""} onChange={(e) => setRecvQty((q) => ({ ...q, [o.id]: e.target.value }))} />
                      </td>
                    )}
                    {canAct && (
                      <td className="py-2 px-3">
                        <div className="flex gap-2">
                          <Button size="sm" className="h-8" disabled={busy === o.id || !(Number(recvQty[o.id]) > 0)}
                            onClick={() => run(o.id, () => receiveReorder({ stockItemId: o.id, qty: Number(recvQty[o.id]) }))}>
                            {busy === o.id ? "Saving…" : "Receive"}
                          </Button>
                          <Button size="sm" variant="outline" className="h-8" disabled={busy === o.id}
                            onClick={() => run(o.id, () => cancelOnOrder(o.id))}>Cancel</Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {err && <p className="text-xs text-destructive print:hidden">{err}</p>}
    </div>
  );
}
