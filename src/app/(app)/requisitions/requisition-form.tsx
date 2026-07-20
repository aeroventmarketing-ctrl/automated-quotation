"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductScanBox, ADD_JUMP_MODES } from "@/components/product-scan-box";
import type { ScanProduct } from "@/lib/product-scan";
import { createDepartmentRequisition } from "../orders/actions";

interface Row { description: string; qty: string; unit: string; remark: string }
const emptyRow = (): Row => ({ description: "", qty: "", unit: "", remark: "" });

/** Raise a department requisition — production supplies not tied to an order. */
export function RequisitionForm({ depts, products }: { depts: { key: string; label: string }[]; products: ScanProduct[] }) {
  const router = useRouter();
  const [dept, setDept] = useState(depts[0]?.key ?? "");
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  // Product search: type to find a product, click a result to add it as a line.
  const [pquery, setPquery] = useState("");
  const [pOpen, setPOpen] = useState(false);
  const pq = pquery.trim().toLowerCase();
  const matches = pq === ""
    ? []
    : products
        .filter((p) => p.name.toLowerCase().includes(pq) || (p.sku ?? "").toLowerCase().includes(pq))
        .slice(0, 8);

  const hasItems = rows.some((r) => r.description.trim() !== "");
  function setCell(i: number, key: keyof Row, value: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }
  function flash(idx: number) {
    setHighlight(idx);
    setTimeout(() => setHighlight((h) => (h === idx ? null : h)), 2000);
  }
  // Add a searched product: fill the first empty row, else append a new one.
  function addProduct(p: ScanProduct) {
    setRows((rs) => {
      const idx = rs.findIndex((r) => r.description.trim() === "");
      const target = idx >= 0 ? idx : rs.length;
      const next = idx >= 0 ? rs.map((r, i) => (i === idx ? { ...r, description: p.name, unit: r.unit || p.unit } : r)) : [...rs, { description: p.name, qty: "", unit: p.unit, remark: "" }];
      flash(target);
      return next;
    });
    setPquery(""); setPOpen(false);
  }
  function handleScan({ mode, product, qty }: { mode: string; product: ScanProduct; qty: number }) {
    if (mode === "add") {
      setRows((rs) => [...rs, { description: product.name, qty: String(qty), unit: product.unit, remark: "" }]);
      return { ok: true, message: `Added ${qty} · ${product.name}` };
    }
    const idx = rows.findIndex((r) => r.description.trim().toLowerCase() === product.name.trim().toLowerCase());
    if (idx >= 0) { flash(idx); return { ok: true, message: `In row ${idx + 1}: ${product.name}` }; }
    return { ok: false, message: `${product.name} isn't in the list yet.` };
  }

  async function submit() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await createDepartmentRequisition(dept, rows, note);
      setRows([emptyRow(), emptyRow(), emptyRow()]); setNote("");
      setMsg("Requisition submitted.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">New department requisition</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Request supplies, consumables or equipment for a department. Not tied to a customer order; received into stock after purchase.</p>
        <ProductScanBox products={products} modes={ADD_JUMP_MODES("add item")} onScan={handleScan} className="rounded-md border bg-muted/20 p-2" />
        {/* Search a product by name / SKU and click a result to add it as a line. */}
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Search a product to add…"
            value={pquery}
            onChange={(e) => { setPquery(e.target.value); setPOpen(true); }}
            onFocus={() => setPOpen(true)}
            onBlur={() => setTimeout(() => setPOpen(false), 150)}
          />
          {pOpen && matches.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-background shadow-md">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addProduct(p)} className="block w-full px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{[p.sku ? `SKU ${p.sku}` : null, p.unit].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pOpen && pq !== "" && matches.length === 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs text-muted-foreground shadow-md">No product matches &ldquo;{pquery}&rdquo; — type it into a row below.</div>
          )}
        </div>
        <datalist id="requisition-products">
          {products.map((p) => <option key={p.id} value={p.name} />)}
        </datalist>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-muted-foreground">Department</span>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">
            {depts.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Articles / Description</th>
                <th className="w-16 py-1 px-1 font-medium">Qty</th>
                <th className="w-20 py-1 px-1 font-medium">Unit</th>
                <th className="w-32 py-1 pl-1 font-medium">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-b last:border-0 transition-colors ${highlight === i ? "bg-amber-200/60" : ""}`}>
                  <td className="py-1 pr-2"><input list="requisition-products" value={r.description} onChange={(e) => setCell(i, "description", e.target.value)} className="w-full rounded border bg-background px-2 py-1" placeholder="Type or pick a product" /></td>
                  <td className="py-1 px-1"><input value={r.qty} onChange={(e) => setCell(i, "qty", e.target.value)} className="w-full rounded border bg-background px-1 py-1 text-right" /></td>
                  <td className="py-1 px-1"><input value={r.unit} onChange={(e) => setCell(i, "unit", e.target.value)} className="w-full rounded border bg-background px-1 py-1" /></td>
                  <td className="py-1 pl-1"><input value={r.remark} onChange={(e) => setCell(i, "remark", e.target.value)} className="w-full rounded border bg-background px-1 py-1" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRows((rs) => [...rs, emptyRow()])}>+ Add row</Button>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 flex-1 min-w-[10rem] rounded-md border bg-background px-2 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy || !dept || !hasItems} onClick={submit}>{busy ? "Submitting…" : "Submit requisition"}</Button>
          {msg && <span className="text-xs text-emerald-600">{msg}</span>}
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
