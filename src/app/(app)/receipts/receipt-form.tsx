"use client";

import { useMemo, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import {
  amountInWords,
  formLines,
  isFilledLine,
  lineAmount,
  receiptTotals,
  splitWords,
  DR_MAX_LINES,
  SI_MAX_LINES,
  type ReceiptInput,
  type ReceiptLine,
} from "@/lib/bir-receipts";
import { prefillReceipt } from "./actions";

const blankLine = (): ReceiptLine => ({ qty: null, unit: "Pcs", description: "", unitPrice: null });
const padLines = (ls: ReceiptLine[]) => [...ls, ...Array.from({ length: Math.max(0, SI_MAX_LINES - ls.length) }, blankLine)];

const empty = (today: string): ReceiptInput => ({
  date: today,
  companyName: "",
  tin: "",
  address: "",
  businessStyle: "",
  paymentOf: "",
  amountWords1: "",
  amountWords2: "",
  vatRatePct: 12,
  ewtRatePct: 1,
  vatExemptSales: 0,
  zeroRatedSales: 0,
  lines: padLines([]),
});

const toNum = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** The template's Input sheet, as a form — same fields, same order, same limits. */
export function ReceiptForm({ today, orders }: { today: string; orders: { id: string; label: string }[] }) {
  const [form, setForm] = useState<ReceiptInput>(() => empty(today));
  const [orderId, setOrderId] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<null | "load" | "download">(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  const set = <K extends keyof ReceiptInput>(k: K, v: ReceiptInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<ReceiptLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const filled = form.lines.filter(isFilledLine);
  const laid = formLines(form);
  const totals = receiptTotals({ lines: laid.ok ? laid.value.si : filled, vatRatePct: form.vatRatePct, ewtRatePct: form.ewtRatePct });
  const autoWords = splitWords(amountInWords(totals.netCollectible));
  const shownOrders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? orders.filter((o) => o.label.toLowerCase().includes(q)) : orders;
  }, [orders, filter]);

  async function load() {
    if (!orderId) return;
    setBusy("load");
    setErr(null);
    try {
      const data = await prefillReceipt(orderId);
      setForm({ ...data, lines: padLines(data.lines) });
      setLoadedFrom(orders.find((o) => o.id === orderId)?.label ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load the order.");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("download");
    setErr(null);
    try {
      const res = await fetch("/api/receipts/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, lines: filled }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Couldn't generate the receipts (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name ? decodeURIComponent(name) : "BIR Receipts.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't generate the receipts.");
    } finally {
      setBusy(null);
    }
  }

  const field = (label: string, k: "date" | "companyName" | "tin" | "address" | "businessStyle" | "paymentOf", opts: { wide?: boolean; placeholder?: string } = {}) => (
    <label className={`space-y-1 text-xs text-muted-foreground ${opts.wide ? "sm:col-span-2" : ""}`}>
      <span>{label}</span>
      <Input className="h-9 text-sm text-foreground" value={form[k]} placeholder={opts.placeholder} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const numField = (label: string, k: "vatRatePct" | "ewtRatePct" | "vatExemptSales" | "zeroRatedSales", suffix?: string) => (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <Input
          className="h-9 text-sm text-foreground"
          inputMode="decimal"
          value={String(form[k])}
          onChange={(e) => set(k, toNum(e.target.value) ?? 0)}
        />
        {suffix && <span className="text-sm">{suffix}</span>}
      </div>
    </label>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Load from an order</CardTitle>
          <p className="text-xs text-muted-foreground">
            Fills the client&apos;s name, TIN, address and Trade Name (from their BIR 2303), the order&apos;s lines and the VAT /
            EWT rates. Everything stays editable.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <Input className="h-9 w-56" placeholder="Filter orders…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select
            className="h-9 min-w-[18rem] max-w-full flex-1 rounded-md border bg-background px-2 text-sm"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            aria-label="Order"
          >
            <option value="">— choose an order —</option>
            {shownOrders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={load} disabled={!orderId || !!busy}>{busy === "load" ? "Loading…" : "Load"}</Button>
          {loadedFrom && <span className="text-xs text-muted-foreground">Filled from {loadedFrom}</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Client</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {field("Date", "date")}
          {field("Company Name", "companyName")}
          {field("TIN #", "tin", { placeholder: "e.g. 216-506-486-00000" })}
          {field("Business Style", "businessStyle")}
          {field("Address", "address", { wide: true })}
          {field("In partial/full payment of", "paymentOf", { placeholder: "e.g. PO No. 11014" })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Lines</CardTitle>
          <p className="text-xs text-muted-foreground">
            The Sales Invoice holds {SI_MAX_LINES} lines; past that it prints one line &quot;As per&quot; the PO and the Delivery
            Receipt lists them all (up to {DR_MAX_LINES}). &quot;Nothing follows&quot; is added after the last line.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="w-20 px-1 py-1 text-left font-medium">Qty</th>
                  <th className="w-20 px-1 py-1 text-left font-medium">Unit</th>
                  <th className="px-1 py-1 text-left font-medium">Description</th>
                  <th className="w-32 px-1 py-1 text-left font-medium">Unit price</th>
                  <th className="w-32 px-1 py-1 text-right font-medium">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-1 py-0.5"><Input className="h-8" inputMode="decimal" value={l.qty ?? ""} onChange={(e) => setLine(i, { qty: toNum(e.target.value) })} aria-label={`Line ${i + 1} qty`} /></td>
                    <td className="px-1 py-0.5"><Input className="h-8" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label={`Line ${i + 1} unit`} /></td>
                    <td className="px-1 py-0.5"><Input className="h-8" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label={`Line ${i + 1} description`} /></td>
                    <td className="px-1 py-0.5"><Input className="h-8" inputMode="decimal" value={l.unitPrice ?? ""} onChange={(e) => setLine(i, { unitPrice: toNum(e.target.value) })} aria-label={`Line ${i + 1} unit price`} /></td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{isFilledLine(l) ? formatCurrency(lineAmount(l)) : ""}</td>
                    <td className="px-1 py-0.5">
                      <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Remove line ${i + 1}`}
                        onClick={() => setForm((f) => ({ ...f, lines: padLines(f.lines.filter((_, j) => j !== i)) }))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {form.lines.length < DR_MAX_LINES && (
            <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </button>
          )}
          {laid.ok && laid.value.siSummarised && (
            <p className="text-xs text-amber-700">
              {filled.length} lines — the Sales Invoice will print one line, &quot;{laid.value.si[0].description}&quot;, for the total.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">VAT, withholding and totals</CardTitle></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {numField("VAT Rate", "vatRatePct", "%")}
            {numField("EWT Rate", "ewtRatePct", "%")}
            {numField("VAT Exempt Sales", "vatExemptSales")}
            {numField("Zero Rated Sales", "zeroRatedSales")}
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md border bg-muted/20 p-3 text-sm">
            <dt className="text-muted-foreground">Total Sales</dt><dd className="text-right tabular-nums">{formatCurrency(totals.totalSales)}</dd>
            <dt className="text-muted-foreground">Less VAT</dt><dd className="text-right tabular-nums">{formatCurrency(totals.lessVat)}</dd>
            <dt className="text-muted-foreground">Less Withholding Tax</dt><dd className="text-right tabular-nums">{formatCurrency(totals.lessEwt)}</dd>
            <dt className="font-semibold">Net Collectible Amount</dt><dd className="text-right font-semibold tabular-nums">{formatCurrency(totals.netCollectible)}</dd>
          </dl>
          <div className="space-y-2 lg:col-span-2">
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span>Amount in Words (line 1) — leave blank to write it out from the Net Collectible Amount</span>
              <Input className="h-9 text-sm text-foreground" value={form.amountWords1} placeholder={autoWords[0]} onChange={(e) => set("amountWords1", e.target.value)} />
            </label>
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span>Amount in Words (line 2)</span>
              <Input className="h-9 text-sm text-foreground" value={form.amountWords2} placeholder={form.amountWords1 ? "" : autoWords[1]} onChange={(e) => set("amountWords2", e.target.value)} />
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={download} disabled={!!busy || !laid.ok}>
          <Download className="h-4 w-4" />
          {/* The shared Button capitalises its text; the file type stays as written. */}
          <span className="normal-case">{busy === "download" ? "Generating…" : "Download receipts (.xlsx)"}</span>
        </Button>
        {!laid.ok && filled.length > 0 && <span className="text-sm text-destructive">{laid.error}</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </div>
  );
}
