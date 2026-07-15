"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { poLineAmount, poTotals, type POLine, type PurchaseOrder } from "@/lib/purchase-order";
import { savePurchaseOrder } from "../actions";

function todayInput(): string {
  // yyyy-mm-dd for the date input, in PH time.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // en-CA gives yyyy-mm-dd
}

export function PurchaseOrderPanel({
  prId,
  orderId,
  po,
  defaultLines,
  defaultRemarks,
  onDone,
}: {
  prId: string;
  orderId: string;
  po: PurchaseOrder | null;
  defaultLines: POLine[];
  defaultRemarks: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [company, setCompany] = useState(po?.supplier.company ?? "");
  const [attention, setAttention] = useState(po?.supplier.attention ?? "");
  const [address, setAddress] = useState(po?.supplier.address ?? "");
  const [date, setDate] = useState(po?.date ? po.date.slice(0, 10) : todayInput());
  const [lines, setLines] = useState<POLine[]>(po?.lines?.length ? po.lines : defaultLines.length ? defaultLines : [{ description: "", qty: "", unit: "", unitPrice: "" }]);
  const [ewtPct, setEwtPct] = useState(String(po?.ewtPct ?? 1));
  const [remarks, setRemarks] = useState(po?.remarks ?? defaultRemarks);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setLine(i: number, key: keyof POLine, value: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));
  }
  function addRow() {
    setLines((ls) => [...ls, { description: "", qty: "", unit: "", unitPrice: "" }]);
  }
  function removeRow(i: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));
  }

  const totals = poTotals({ lines, ewtPct: Number(ewtPct) || 0 });

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await savePurchaseOrder(prId, {
        supplier: { company, attention, address },
        date,
        lines,
        ewtPct: Number(ewtPct) || 0,
        remarks,
      });
      router.refresh();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="text-sm font-medium">{po ? `Edit Purchase Order — ${po.poNumber}` : "New Purchase Order"}</div>

      {/* Supplier */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Company name</span>
          <Input className="h-8" value={company} onChange={(e) => setCompany(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Attention</span>
          <Input className="h-8" value={attention} onChange={(e) => setAttention(e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Address</span>
          <Input className="h-8" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Date</span>
          <Input className="h-8" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>

      {/* Lines */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="w-16 py-1 px-1 font-medium">Qty</th>
              <th className="w-16 py-1 px-1 font-medium">Unit</th>
              <th className="w-24 py-1 px-1 font-medium">Unit price</th>
              <th className="w-28 py-1 px-1 text-right font-medium">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1 pr-2"><Input className="h-8" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} /></td>
                <td className="py-1 px-1"><Input className="h-8 text-right" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} /></td>
                <td className="py-1 px-1"><Input className="h-8" value={l.unit} onChange={(e) => setLine(i, "unit", e.target.value)} /></td>
                <td className="py-1 px-1"><Input className="h-8 text-right" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} /></td>
                <td className="py-1 px-1 text-right tabular-nums">{formatCurrency(poLineAmount(l), "PHP")}</td>
                <td className="py-1 text-center">
                  <button type="button" onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive" aria-label="Remove line">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addRow}>+ Add line</Button>

      {/* Totals */}
      <div className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Total amount</span><span className="tabular-nums">{formatCurrency(totals.total, "PHP")}</span></div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-muted-foreground">Less EWT
            <Input className="h-6 w-14 text-right" value={ewtPct} onChange={(e) => setEwtPct(e.target.value)} />%
          </span>
          <span className="tabular-nums">{formatCurrency(totals.ewt, "PHP")}</span>
        </div>
        <div className="flex justify-between border-t pt-1 font-semibold"><span>Net amount</span><span className="tabular-nums">{formatCurrency(totals.net, "PHP")}</span></div>
      </div>

      <label className="block space-y-1"><span className="text-xs text-muted-foreground">Remarks</span>
        <Input className="h-8" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy} onClick={save}>{busy ? "Saving…" : po ? "Save changes" : "Create purchase order"}</Button>
        {po && (
          <Link href={`/orders/${orderId}/po/${prId}`} target="_blank" className="text-sm text-primary hover:underline">Print PO →</Link>
        )}
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onDone}>Close</Button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
