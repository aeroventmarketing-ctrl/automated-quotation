"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PAYMENT_METHODS } from "@/lib/counter-sale";
import { adminEditCounterSale, adminDeleteCounterSale, type CounterSaleItemInput } from "./actions";

interface EditLine { stockItemId: string | null; description: string; unit: string; qty: string; unitPrice: string }

/**
 * Admin-only edit / delete for a counter sale on ANY status. Edits the existing
 * lines (each keeps its stock item), VAT mode, payment method and notes; saving
 * re-books a completed sale (returns then re-deducts stock, re-computes
 * commission). Deleting returns a completed sale's stock and removes the record.
 */
export function CounterSaleAdminEdit({
  saleId,
  initial,
}: {
  saleId: string;
  initial: {
    vatMode: "INCLUSIVE" | "EXCLUSIVE";
    paymentMethod: string;
    salespersonId: string | null;
    notes: string;
    lines: EditLine[];
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vatMode, setVatMode] = useState(initial.vatMode);
  const [paymentMethod, setPaymentMethod] = useState(initial.paymentMethod);
  const [notes, setNotes] = useState(initial.notes);
  const [lines, setLines] = useState<EditLine[]>(initial.lines.length ? initial.lines : [{ stockItemId: null, description: "", unit: "pcs", qty: "1", unitPrice: "" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setLine = (i: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const num = (s: string) => { const n = Number((s || "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

  async function save() {
    setErr(null);
    const items: CounterSaleItemInput[] = lines
      .filter((l) => l.description.trim() && num(l.qty) > 0)
      .map((l) => ({ stockItemId: l.stockItemId, description: l.description.trim(), unit: l.unit || "pcs", qty: num(l.qty), unitPrice: num(l.unitPrice) }));
    if (items.length === 0) { setErr("Keep at least one item with a quantity."); return; }
    setBusy(true);
    try {
      await adminEditCounterSale(saleId, { vatMode, paymentMethod, salespersonId: initial.salespersonId ?? undefined, notes, items });
      setOpen(false);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to save"); }
    finally { setBusy(false); }
  }

  async function del() {
    if (!window.confirm("Permanently delete this sale? A completed sale's stock is returned to inventory. This cannot be undone.")) return;
    setBusy(true); setErr(null);
    try {
      await adminDeleteCounterSale(saleId);
      router.push("/counter-sales");
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to delete"); setBusy(false); }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">
          <Pencil className="h-3.5 w-3.5" /> Edit sale (admin)
        </button>
        <button type="button" onClick={del} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
          <Trash2 className="h-3.5 w-3.5" /> {busy ? "…" : "Delete sale"}
        </button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">Edit sale (admin)</div>
        <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <p className="text-[11px] text-amber-700 dark:text-amber-400">Saving a completed sale returns its old stock and re-deducts the edited quantities, and re-computes commission.</p>
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <Input className="h-8 min-w-[10rem] flex-1" placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
            <Input className="h-8 w-16" type="number" min={0} step="any" placeholder="Qty" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
            <Input className="h-8 w-16" placeholder="Unit" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
            <Input className="h-8 w-24" type="number" min={0} step="any" placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
            {l.stockItemId && <span className="text-[10px] text-muted-foreground">stock</span>}
            {lines.length > 1 && (
              <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive" aria-label="Remove line"><X className="h-3.5 w-3.5" /></button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setLines((ls) => [...ls, { stockItemId: null, description: "", unit: "pcs", qty: "1", unitPrice: "" }])} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <Plus className="h-3 w-3" /> Add ad-hoc line
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">VAT
          <Select className="h-8" value={vatMode} onChange={(e) => setVatMode(e.target.value as "INCLUSIVE" | "EXCLUSIVE")}>
            <option value="INCLUSIVE">Inclusive</option>
            <option value="EXCLUSIVE">Exclusive</option>
          </Select>
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">Payment
          <Select className="h-8" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </label>
      </div>
      <Input className="h-8" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
