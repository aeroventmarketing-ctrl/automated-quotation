"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProductScanBox } from "@/components/product-scan-box";
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

  const hasItems = rows.some((r) => r.description.trim() !== "");
  function setCell(i: number, key: keyof Row, value: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }
  function addScanned(p: ScanProduct) {
    setRows((rs) => [...rs, { description: p.name, qty: "", unit: p.unit, remark: "" }]);
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
        <ProductScanBox products={products} onFound={addScanned} className="rounded-md border bg-muted/20 p-2" />
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
                <tr key={i} className="border-b last:border-0">
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
