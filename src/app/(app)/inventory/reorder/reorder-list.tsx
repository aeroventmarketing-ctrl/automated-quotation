"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, Search, ArrowUp, ArrowDown } from "lucide-react";
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
  sku: string | null;
  name: string;
  unit: string;
  onHand: number;
  orderedQty: number;
  byName: string;
  at: string;
  note: string;
}

type SortKey = "stock" | "name" | "reorder" | "status" | "category";
type GroupKey = "none" | "category" | "status";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "stock", label: "Stock level" }, // default — lowest / most-depleted first
  { key: "name", label: "Item name" },
  { key: "reorder", label: "Reorder level" },
  { key: "status", label: "Status" },
  { key: "category", label: "Category" },
];
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "None" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
];
// Out is more urgent than Low, so it ranks first when sorting by status ascending.
const statusRank = (s: NeedsRow["status"]) => (s === "out" ? 0 : 1);

export function ReorderList({ needs, onOrder, canAct }: { needs: NeedsRow[]; onOrder: OnOrderRow[]; canAct: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(needs.map((n) => [n.id, n.suggestQty])));
  const [note, setNote] = useState<Record<string, string>>({});
  const [recvQty, setRecvQty] = useState<Record<string, string>>(() => Object.fromEntries(onOrder.map((o) => [o.id, String(o.orderedQty)])));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Search / sort / group / direction for the "Needs reordering" list. Defaults to
  // Stock level ascending, so the lowest (out-of-stock) items surface first.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("stock");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [group, setGroup] = useState<GroupKey>("none");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = needs.filter(
      (n) => !q || n.name.toLowerCase().includes(q) || (n.category ?? "").toLowerCase().includes(q),
    );
    const cmp = (a: NeedsRow, b: NeedsRow) => {
      let r = 0;
      switch (sort) {
        case "stock": r = a.onHand - b.onHand; break;
        case "name": r = a.name.localeCompare(b.name); break;
        case "reorder": r = a.reorderLevel - b.reorderLevel; break;
        case "status": r = statusRank(a.status) - statusRank(b.status); break;
        case "category": r = (a.category ?? "").localeCompare(b.category ?? ""); break;
      }
      if (r === 0) r = a.name.localeCompare(b.name); // stable tiebreak
      return dir === "asc" ? r : -r;
    };
    const sorted = [...filtered].sort(cmp);
    if (group === "none") return [{ key: "", rows: sorted }];
    const map = new Map<string, NeedsRow[]>();
    for (const n of sorted) {
      const k = group === "category" ? (n.category?.trim() || "Uncategorized") : n.status === "out" ? "Out" : "Low";
      (map.get(k) ?? map.set(k, []).get(k)!).push(n);
    }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }));
  }, [needs, query, sort, dir, group]);

  const visibleCount = groups.reduce((s, g) => s + g.rows.length, 0);
  const needsColSpan = 4 + (canAct ? 2 : 0);

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

  // Scan-to-receive: scan an on-order item's barcode to receive its ordered qty.
  const [scan, setScan] = useState("");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [scanErr, setScanErr] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  async function onOrderScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const row =
      onOrder.find((o) => o.sku === code) ?? onOrder.find((o) => o.id === code) ?? onOrder.find((o) => o.name.toLowerCase() === code.toLowerCase());
    if (!row) { setScanErr(true); setScanMsg(`No on-order item matches “${code}”.`); return; }
    const q = Number(recvQty[row.id] ?? row.orderedQty) || row.orderedQty;
    setBusy(row.id);
    try {
      await receiveReorder({ stockItemId: row.id, qty: q });
      setScanErr(false); setScanMsg(`Received ${q} ${row.unit} · ${row.name}`);
      router.refresh();
    } catch (e2) {
      setScanErr(true); setScanMsg(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setBusy(null); scanRef.current?.focus();
    }
  }

  function renderNeedsRow(n: NeedsRow) {
    return (
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
    );
  }

  return (
    <div className="space-y-6">
      {/* Needs reordering */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Needs reordering <span className="text-muted-foreground">({visibleCount === needs.length ? needs.length : `${visibleCount} of ${needs.length}`})</span></h2>
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
          <>
            {/* Search / sort / group / direction. */}
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <div className="relative min-w-[14rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search item or category…" className="h-9 w-full pl-8" />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
                title={dir === "asc" ? "Ascending" : "Descending"}
                className="inline-flex h-9 items-center gap-1 rounded-md border bg-background px-2 text-xs text-muted-foreground hover:bg-accent">
                {dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                {dir === "asc" ? "Asc" : "Desc"}
              </button>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Group
                <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
                  {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </label>
            </div>

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
                  {visibleCount === 0 ? (
                    <tr><td colSpan={needsColSpan} className="py-6 text-center text-sm text-muted-foreground">No items match “{query}”.</td></tr>
                  ) : (
                    groups.map((g) => (
                      <Fragment key={g.key || "all"}>
                        {group !== "none" && (
                          <tr className="border-b bg-muted/60">
                            <td colSpan={needsColSpan} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {g.key || "—"} <span className="font-normal text-muted-foreground/70">({g.rows.length})</span>
                            </td>
                          </tr>
                        )}
                        {g.rows.map((n) => renderNeedsRow(n))}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* On order */}
      <section className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">On order <span className="text-muted-foreground">({onOrder.length})</span></h2>
          {canAct && onOrder.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <ScanLine className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input ref={scanRef} className="h-8 w-56 pl-8" placeholder="Scan to receive…" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onOrderScan} />
              </div>
              {scanMsg && <span className={`text-xs ${scanErr ? "text-destructive" : "text-emerald-600"}`}>{scanMsg}</span>}
            </div>
          )}
        </div>
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
