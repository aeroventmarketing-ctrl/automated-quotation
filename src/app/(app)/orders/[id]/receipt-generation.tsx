"use client";

import { useState } from "react";
import { Download, Plus, RotateCcw, Trash2 } from "lucide-react";
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
  DR_LINES_PER_PAGE,
  MAX_LINES,
  SI_MAX_LINES,
  type ReceiptInput,
  type ReceiptLine,
} from "@/lib/bir-receipts";

const blankLine = (): ReceiptLine => ({ qty: null, unit: "Pcs", description: "", unitPrice: null });
const padLines = (ls: ReceiptLine[]) => [...ls, ...Array.from({ length: Math.max(0, SI_MAX_LINES - ls.length) }, blankLine)];

const toNum = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Receipt Generation, on the order — Accounting's BIR receipts (Sales Invoice,
 * Delivery Receipt, Collection Receipt), filled from this order and downloaded
 * in their own template. The fields are the template's Input sheet, in its
 * order; everything is editable, and "Reset" goes back to the order's figures.
 */
export function ReceiptGeneration({ initial }: { initial: ReceiptInput }) {
  const start = () => ({ ...initial, lines: padLines(initial.lines) });
  const [form, setForm] = useState<ReceiptInput>(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof ReceiptInput>(k: K, v: ReceiptInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<ReceiptLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const filled = form.lines.filter(isFilledLine);
  const laid = formLines(form);
  const totals = receiptTotals({ lines: laid.ok ? laid.value.si : filled, vatRatePct: form.vatRatePct, ewtRatePct: form.ewtRatePct });
  const autoWords = splitWords(amountInWords(totals.netCollectible));

  async function download() {
    setBusy(true);
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
      setBusy(false);
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
        <Input className="h-9 text-sm text-foreground" inputMode="decimal" value={String(form[k])} onChange={(e) => set(k, toNum(e.target.value) ?? 0)} />
        {suffix && <span className="text-sm">{suffix}</span>}
      </div>
    </label>
  );
  const section = (title: string) => <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>;

  return (
    <div className="space-y-5" data-testid="receipt-generation">
      <p className="text-xs text-muted-foreground">
        Filled from this order — the client&apos;s name, TIN, address and Trade Name from their BIR 2303, the order&apos;s lines,
        and the VAT / EWT rates. Check and edit, then download Accounting&apos;s template with the Sales Invoice (SI), Delivery
        Receipt (DR) and Collection Receipt (CR) filled in, and print each from its sheet onto the booklet. Row heights and
        column widths are exactly as uploaded.
      </p>

      <div className="space-y-2">
        {section("Client")}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("Date", "date")}
          {field("Company Name", "companyName")}
          {field("TIN #", "tin", { placeholder: "e.g. 216-506-486-00000" })}
          {field("Business Style", "businessStyle")}
          {field("Address", "address", { wide: true })}
          {field("In partial/full payment of", "paymentOf", { placeholder: "e.g. PO No. 11014" })}
        </div>
      </div>

      <div className="space-y-2">
        {section("Lines")}
        <p className="text-xs text-muted-foreground">
          The Sales Invoice holds {SI_MAX_LINES} lines; past that it prints one line &quot;As per&quot; the PO. The Delivery Receipt
          holds {DR_LINES_PER_PAGE} lines a page — more continue on extra sheets, DR (2), DR (3)…, one per booklet page.
          &quot;Nothing follows&quot; is added after the last line.
        </p>
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
        {form.lines.length < MAX_LINES && (
          <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        )}
        {laid.ok && laid.value.drPages.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {filled.length} lines — the Delivery Receipt prints on {laid.value.drPages.length} pages: DR
            {laid.value.drPages.slice(1).map((_, k) => `, DR (${k + 2})`).join("")}.
          </p>
        )}
        {laid.ok && laid.value.siSummarised && (
          <p className="text-xs text-amber-700">
            {filled.length} lines — the Sales Invoice will print one line, &quot;{laid.value.si[0].description}&quot;, for the total.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {section("VAT, withholding and totals")}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {numField("VAT Rate", "vatRatePct", "%")}
            {numField("EWT Rate", "ewtRatePct", "%")}
            {numField("VAT Exempt Sales", "vatExemptSales")}
            {numField("Zero Rated Sales", "zeroRatedSales")}
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 self-start rounded-md border bg-muted/20 p-3 text-sm">
            <dt className="text-muted-foreground">Total Sales</dt><dd className="text-right tabular-nums">{formatCurrency(totals.totalSales)}</dd>
            <dt className="text-muted-foreground">Less VAT</dt><dd className="text-right tabular-nums">{formatCurrency(totals.lessVat)}</dd>
            <dt className="text-muted-foreground">Less Withholding Tax</dt><dd className="text-right tabular-nums">{formatCurrency(totals.lessEwt)}</dd>
            <dt className="font-semibold">Net Collectible Amount</dt><dd className="text-right font-semibold tabular-nums">{formatCurrency(totals.netCollectible)}</dd>
          </dl>
        </div>
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>Amount in Words (line 1) — leave blank to write it out from the Net Collectible Amount</span>
          <Input className="h-9 text-sm text-foreground" value={form.amountWords1} placeholder={autoWords[0]} onChange={(e) => set("amountWords1", e.target.value)} />
        </label>
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>Amount in Words (line 2)</span>
          <Input className="h-9 text-sm text-foreground" value={form.amountWords2} placeholder={form.amountWords1 ? "" : autoWords[1]} onChange={(e) => set("amountWords2", e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={download} disabled={busy || !laid.ok}>
          <Download className="h-4 w-4" />
          {/* The shared Button capitalises its text; the file type stays as written. */}
          <span className="normal-case">{busy ? "Generating…" : "Download receipts (.xlsx)"}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setForm(start()); setErr(null); }} disabled={busy}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset to the order&apos;s figures
        </Button>
        {!laid.ok && filled.length > 0 && <span className="text-sm text-destructive">{laid.error}</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </div>
  );
}
