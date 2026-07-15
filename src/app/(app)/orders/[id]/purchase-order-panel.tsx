"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { poLineAmount, poTotals, type POLine, type PurchaseOrder } from "@/lib/purchase-order";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import { savePurchaseOrder, addPaymentTerm } from "../actions";

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
  suppliers,
  paymentTerms,
  canManageTerms,
  onDone,
}: {
  prId: string;
  orderId: string;
  po: PurchaseOrder | null;
  defaultLines: POLine[];
  defaultRemarks: string;
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  canManageTerms: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [company, setCompany] = useState(po?.supplier.company ?? "");
  const [attention, setAttention] = useState(po?.supplier.attention ?? "");
  const [address, setAddress] = useState(po?.supplier.address ?? "");
  const [supplierOpen, setSupplierOpen] = useState(false);

  const matches = company.trim()
    ? suppliers.filter((s) => s.company.toLowerCase().includes(company.trim().toLowerCase()) && s.company.toLowerCase() !== company.trim().toLowerCase())
    : suppliers;

  function pickSupplier(s: Supplier) {
    setCompany(s.company);
    setAttention([s.contactPerson, s.contactNumber].filter(Boolean).join(" - "));
    if (s.paymentDetails) setRemarks(s.paymentDetails);
    setSupplierOpen(false);
  }
  const [date, setDate] = useState(po?.date ? po.date.slice(0, 10) : todayInput());
  const [lines, setLines] = useState<POLine[]>(po?.lines?.length ? po.lines : defaultLines.length ? defaultLines : [{ description: "", qty: "", unit: "", unitPrice: "" }]);
  const [ewtPct, setEwtPct] = useState(String(po?.ewtPct ?? 1));
  const [remarks, setRemarks] = useState(po?.remarks ?? defaultRemarks);
  const [terms, setTerms] = useState<PaymentTerm[]>(paymentTerms);
  const [termBusy, setTermBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const termSaved = terms.some((t) => t.text.trim().toLowerCase() === remarks.trim().toLowerCase());
  async function saveAsTerm() {
    const text = remarks.trim();
    if (!text) return;
    setTermBusy(true);
    setErr(null);
    try {
      setTerms(await addPaymentTerm(text));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setTermBusy(false);
    }
  }

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
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Company name</span>
          <div className="relative">
            <Input
              className="h-8"
              value={company}
              placeholder={suppliers.length ? "Search or type supplier…" : "Type supplier…"}
              onChange={(e) => { setCompany(e.target.value); setSupplierOpen(true); }}
              onFocus={() => setSupplierOpen(true)}
              onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
            />
            {supplierOpen && matches.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-background shadow-md">
                {matches.slice(0, 8).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickSupplier(s)}
                      className="block w-full px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <div className="font-medium">{s.company}</div>
                      {(s.contactPerson || s.contactNumber) && (
                        <div className="truncate text-xs text-muted-foreground">{[s.contactPerson, s.contactNumber].filter(Boolean).join(" · ")}</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
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

      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Payment terms</span>
        {terms.length > 0 && (
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value=""
            onChange={(e) => { if (e.target.value) setRemarks(e.target.value); }}
          >
            <option value="">— pick a saved payment term —</option>
            {terms.map((t) => <option key={t.id} value={t.text}>{t.text}</option>)}
          </select>
        )}
        <div className="flex items-center gap-2">
          <Input className="h-8 flex-1" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Payment terms / remarks" />
          {canManageTerms && (
            <Button size="sm" variant="outline" className="h-8" disabled={termBusy || !remarks.trim() || termSaved} onClick={saveAsTerm}>
              {termBusy ? "Saving…" : termSaved ? "Saved" : "Save as term"}
            </Button>
          )}
        </div>
        {canManageTerms && (
          <p className="text-[11px] text-muted-foreground">Pick a saved term or type one and &ldquo;Save as term&rdquo; to reuse it. Manage the full list in Admin &rarr; Payment terms.</p>
        )}
      </div>

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
