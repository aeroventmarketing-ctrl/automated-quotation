"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminEditPurchaseRequestItems, adminCreateReplenishment, createDepartmentRequisition, deletePurchaseRequest } from "../orders/actions";

/**
 * Admin-only manage controls for purchasing requests. Edit a request's item
 * lines, delete it (any status/tab), or add a new department material request /
 * replenishment top-up directly from the Purchasing workspace.
 */

/** Per-row Edit (item lines) + optional Delete. Used on both request lists. */
export function AdminPrEditDelete({ prId, items, showDelete = true }: { prId: string; items: string[]; showDelete?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(items.join("\n"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) { setErr("List at least one item."); return; }
    setBusy(true); setErr(null);
    try {
      await adminEditPurchaseRequestItems(prId, lines);
      setEditing(false);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to save"); }
    finally { setBusy(false); }
  }

  async function del() {
    if (!window.confirm("Permanently delete this request? This cannot be undone.")) return;
    setBusy(true); setErr(null);
    try { await deletePurchaseRequest(prId); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to delete"); setBusy(false); }
  }

  if (editing) {
    return (
      <div className="mt-2 space-y-1.5 rounded-md border bg-background p-2">
        <div className="text-[11px] font-medium text-muted-foreground">Edit item lines — one per line</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.max(3, items.length + 1)}
          className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
        />
        <p className="text-[10px] text-amber-600">Editing lines here does not rewrite an already-issued Purchase Order — edit the PO in its editor.</p>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => { setEditing(false); setText(items.join("\n")); setErr(null); }}>Cancel</Button>
          {err && <span className="text-[11px] text-destructive">{err}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setEditing(true)} disabled={busy}
        className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium hover:bg-accent disabled:opacity-50">
        <Pencil className="h-3.5 w-3.5" /> Edit
      </button>
      {showDelete && (
        <button type="button" onClick={del} disabled={busy}
          className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
          <Trash2 className="h-3.5 w-3.5" /> {busy ? "…" : "Delete"}
        </button>
      )}
      {err && <span className="text-[11px] text-destructive">{err}</span>}
    </div>
  );
}

/** Admin: add a replenishment (stock top-up) request. */
export function AdminAddReplenishment({ stockItems }: { stockItems: { id: string; name: string; unit: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stockItemId, setStockItemId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const q = Number(qty);
    if (!stockItemId) { setErr("Pick a stock item."); return; }
    if (!(q > 0)) { setErr("Enter a quantity."); return; }
    setBusy(true); setErr(null);
    try {
      await adminCreateReplenishment(stockItemId, q, note || undefined);
      setStockItemId(""); setQty(""); setNote(""); setOpen(false);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to add"); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">
        <Plus className="h-3.5 w-3.5" /> Add stock top-up
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">Add replenishment (stock top-up)</div>
        <button type="button" onClick={() => { setOpen(false); setErr(null); }} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <select value={stockItemId} onChange={(e) => setStockItemId(e.target.value)} className="h-8 min-w-[14rem] rounded-md border bg-background px-2 text-sm">
          <option value="">— pick stock item —</option>
          {stockItems.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
        </select>
        <Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
        <Input className="h-8 w-48" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" className="h-8" disabled={busy} onClick={add}>{busy ? "Adding…" : "Add"}</Button>
      </div>
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

/** Admin: add a department material request (shows under Order Material Requests). */
export function AdminAddDeptRequest({ depts }: { depts: { key: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dept, setDept] = useState(depts[0]?.key ?? "");
  const [rows, setRows] = useState<{ description: string; qty: string; unit: string }[]>([{ description: "", qty: "", unit: "" }]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setRow(i: number, patch: Partial<{ description: string; qty: string; unit: string }>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function add() {
    const items = rows.map((r) => ({ description: r.description.trim(), qty: r.qty.trim(), unit: r.unit.trim() })).filter((r) => r.description !== "");
    if (!dept) { setErr("Pick a department."); return; }
    if (items.length === 0) { setErr("List at least one item."); return; }
    setBusy(true); setErr(null);
    try {
      await createDepartmentRequisition(dept, items, note);
      setRows([{ description: "", qty: "", unit: "" }]); setNote(""); setOpen(false);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to add"); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">
        <Plus className="h-3.5 w-3.5" /> Add material request
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">Add department material request</div>
        <button type="button" onClick={() => { setOpen(false); setErr(null); }} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Department</span>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="h-8 min-w-[12rem] rounded-md border bg-background px-2 text-sm">
          {depts.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </label>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <Input className="h-8 min-w-[12rem] flex-1" placeholder="Item / description" value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} />
            <Input className="h-8 w-16" placeholder="Qty" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />
            <Input className="h-8 w-20" placeholder="Unit" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} />
            {rows.length > 1 && (
              <button type="button" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive" aria-label="Remove line"><X className="h-3.5 w-3.5" /></button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, { description: "", qty: "", unit: "" }])} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <Plus className="h-3 w-3" /> Add line
        </button>
      </div>
      <Input className="h-8 w-full max-w-md" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy} onClick={add}>{busy ? "Adding…" : "Add request"}</Button>
        {err && <span className="text-[11px] text-destructive">{err}</span>}
      </div>
    </div>
  );
}
