"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, Plus, FileText, Download, Eye, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { formatCurrency, cn } from "@/lib/utils";
import { uploadDocument } from "@/lib/client-upload";
import { PAYMENT_KIND_LABEL, type SaleDoc, type SalePayment, type PaymentKind } from "@/lib/sale";
import { saveCounterSalePayments } from "./actions";

const PAYMENT_KINDS: PaymentKind[] = ["down", "full", "progress", "ewt"];
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const today = () => new Date().toISOString().slice(0, 10);

// The counter-sale file route serves inline by default; ?download=1 forces a
// save under the original name.
const docView = (d: SaleDoc) => `/api/counter-sale-uploads?path=${encodeURIComponent(d.path)}`;
const docDownload = (d: SaleDoc) => `${docView(d)}&download=1&name=${encodeURIComponent(d.name)}`;

/**
 * Auto-designate full payment — the same rule the order panel uses. A client may
 * pay any amount in any number of instalments; the payment that makes the running
 * total tally to the sale total flips from "Down payment" to "Full payment". Only
 * a "down" payment is switched (progress / EWT are left alone) and it only ever
 * promotes down → full.
 */
function withAutoFull(list: SalePayment[], total: number): SalePayment[] {
  if (!(total > 0)) return list;
  let running = 0;
  for (let i = 0; i < list.length; i++) {
    running += Number(list[i].amount) || 0;
    if (running >= total - 0.01) {
      if (list[i].kind === "down") {
        const next = [...list];
        next[i] = { ...next[i], kind: "full" };
        return next;
      }
      return list;
    }
  }
  return list;
}

/**
 * Payments Collected for a counter sale — the order page's payment list, at the
 * counter. Each row is a collection (kind / amount / date) with its proof of
 * payment attached, and the proof can be AI-read ("read slip") to fill in the
 * amount and date from a machine-validated / computer-generated slip.
 *
 * The list records what was collected and evidences it. It does not restate the
 * sale's booked `amountPaid` — see `saveCounterSalePayments`.
 */
export function CounterSalePayments({
  saleId,
  currency,
  saleTotal,
  amountPaid,
  initialPayments,
  canEdit,
}: {
  saleId: string;
  currency: string;
  saleTotal: number;
  /** The figure booked on the sale, shown alongside so a gap is visible. */
  amountPaid: number;
  initialPayments: SalePayment[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [payments, setPayments] = useState<SalePayment[]>(() => withAutoFull(initialPayments, saleTotal));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [slipStatus, setSlipStatus] = useState<Record<string, { tone: "muted" | "ok" | "bad"; text: string }>>({});
  const [readingId, setReadingId] = useState<string | null>(null);

  const collected = Math.round(payments.reduce((a, p) => a + (Number(p.amount) || 0), 0) * 100) / 100;
  const balance = Math.max(0, saleTotal - collected);
  // "Add payment" stays turquoise (still collecting) until a full payment is
  // recorded — down payments and progress billings keep it highlighted.
  const paymentImportant = !payments.some((p) => p.kind === "full");

  function apply(next: SalePayment[]) {
    setPayments(withAutoFull(next, saleTotal));
    setDirty(true);
    setMsg(null);
  }
  function addPayment() {
    apply([...payments, { id: newId(), kind: "down", amount: 0, date: today(), proof: null }]);
  }
  function updatePayment(id: string, patch: Partial<SalePayment>) {
    apply(payments.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function removePayment(id: string) {
    apply(payments.filter((p) => p.id !== id));
  }

  async function onProofFile(id: string, file: File) {
    setBusy(true); setMsg(null);
    try {
      const doc = (await uploadDocument("/api/counter-sale-uploads", file, { counterSaleId: saleId })) as SaleDoc;
      const next = payments.map((p) => (p.id === id ? { ...p, proof: doc } : p));
      setPayments(withAutoFull(next, saleTotal));
      setDirty(true);
      await readSlip(id, doc.path, doc.uploadedAt, next);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(false); }
  }

  /**
   * AI-read a payment's deposit slip / proof of payment. A validated (machine-
   * validated or computer-generated) slip fills the row's amount + date; a
   * handwritten-only proof isn't accepted. A figure you typed is never
   * overwritten — a disagreement is reported instead, for someone to settle.
   */
  async function readSlip(id: string, path: string, uploadedAt?: string, from?: SalePayment[]) {
    const list = from ?? payments;
    setReadingId(id);
    setSlipStatus((s) => ({ ...s, [id]: { tone: "muted", text: "Reading slip…" } }));
    try {
      const res = await fetch("/api/ai/read-deposit-slip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counterSaleId: saleId, path, uploadedAt }),
      });
      const j = await res.json();
      if (res.ok && j.validated) {
        const current = list.find((p) => p.id === id);
        const userAmt = Number(current?.amount) || 0;
        const rawDate = (current?.date || "").slice(0, 10);
        const aiAmt = typeof j.amount === "number" ? j.amount : 0;
        const aiDate = typeof j.date === "string" ? j.date : "";
        // Amount: never clobber a figure you typed — fill only an empty one.
        const amtTyped = userAmt > 0;
        const finalAmt = amtTyped ? userAmt : aiAmt;
        // Date: a new row defaults to today, so treat today / empty as "not set"
        // and let the slip's date fill it; keep a date you deliberately changed.
        const dateIsDefault = !rawDate || rawDate === today();
        const finalDate = dateIsDefault ? (aiDate || rawDate || today()) : rawDate;
        const newTotal = list.reduce((sum, pp) => sum + (pp.id === id ? finalAmt : Number(pp.amount) || 0), 0);
        const nowFull = saleTotal > 0 && newTotal >= saleTotal - 0.01;
        setPayments(withAutoFull(list.map((p) => (p.id === id ? { ...p, date: finalDate, amount: finalAmt } : p)), saleTotal));
        setDirty(true);
        const amtMismatch = amtTyped && Math.abs(userAmt - aiAmt) >= 0.005;
        const dateMismatch = !dateIsDefault && !!aiDate && rawDate !== aiDate;
        const fullNote = nowFull ? " Covers the sale total → set to Full payment." : "";
        if (amtMismatch || dateMismatch) {
          setSlipStatus((s) => ({ ...s, [id]: { tone: "bad", text: `⚠ Slip reads ${formatCurrency(aiAmt, currency)} on ${aiDate}, but you entered ${formatCurrency(userAmt, currency)} on ${rawDate}. Kept your entry — admin / accounting should confirm the correct figure.${fullNote}` } }));
        } else {
          setSlipStatus((s) => ({ ...s, [id]: { tone: "ok", text: `✓ Validated — ${formatCurrency(finalAmt, currency)} on ${finalDate}.${amtTyped ? " Tallies with your entry." : " Filled from the slip."}${fullNote}` } }));
        }
      } else if (res.ok) {
        const w = Array.isArray(j.warnings) && j.warnings.length ? String(j.warnings[0]) : "Not machine-validated / computer-generated — amount & date not filled.";
        setSlipStatus((s) => ({ ...s, [id]: { tone: "bad", text: `✗ ${w} Admin / accounting can verify and record it.` } }));
      } else {
        setSlipStatus((s) => ({ ...s, [id]: { tone: "bad", text: j.error ?? "Couldn't read the slip. Enter the figures manually." } }));
      }
    } catch {
      setSlipStatus((s) => ({ ...s, [id]: { tone: "bad", text: "Couldn't read the slip. Enter the figures manually." } }));
    } finally {
      setReadingId(null);
    }
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await saveCounterSalePayments(saleId, payments);
      setDirty(false);
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <Label className="text-xs">Payments Collected{canEdit ? " (required)" : ""}</Label>
        <span className="text-[11px] text-muted-foreground">
          Recorded <span className="font-semibold tabular-nums text-emerald-700">{formatCurrency(collected, currency)}</span>
          {" of "}{formatCurrency(saleTotal, currency)}
          {balance >= 0.01 && <> · {formatCurrency(balance, currency)} not yet recorded</>}
          {/* The sale books its own amount paid on completion. Say so when the
              two disagree rather than quietly showing one of them. */}
          {Math.abs(collected - amountPaid) >= 0.01 && amountPaid > 0 && (
            <span className="text-amber-700"> · sale booked {formatCurrency(amountPaid, currency)}</span>
          )}
        </span>
      </div>
      {payments.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No payment recorded yet. Add each collection with its proof of payment — deposit slip, transfer confirmation or check photo.
        </p>
      )}
      {payments.map((p) => {
        const st = slipStatus[p.id];
        const reading = readingId === p.id;
        return (
          <div key={p.id} className="space-y-1 rounded-md border p-2">
            <div className="grid grid-cols-2 items-center gap-2 md:grid-cols-12">
              <Select className="h-8 md:col-span-3" value={p.kind} disabled={!canEdit} onChange={(e) => updatePayment(p.id, { kind: e.target.value as PaymentKind })}>
                {PAYMENT_KINDS.map((k) => (<option key={k} value={k}>{PAYMENT_KIND_LABEL[k]}</option>))}
              </Select>
              <Input className="h-8 text-right md:col-span-2" type="number" step="0.01" placeholder="Amount ₱" value={p.amount || ""} disabled={!canEdit} onChange={(e) => updatePayment(p.id, { amount: Number(e.target.value) || 0 })} />
              <Input className="h-8 md:col-span-3" type="date" value={p.date?.slice(0, 10) || today()} disabled={!canEdit} onChange={(e) => updatePayment(p.id, { date: e.target.value })} />
              <div className="md:col-span-3">
                {p.proof ? (
                  <div className="flex items-center gap-2">
                    <a href={docView(p.proof)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
                      <FileText className="h-3.5 w-3.5" /> proof
                    </a>
                    <a href={docView(p.proof)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View proof" aria-label="View proof">
                      <Eye className="h-3.5 w-3.5" />
                    </a>
                    <a href={docDownload(p.proof)} className="text-muted-foreground hover:text-primary" title="Download proof" aria-label="Download proof">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    {canEdit && p.kind !== "ewt" && (
                      <button type="button" title="Read slip with AI" aria-label="Read slip with AI" disabled={reading || busy} onClick={() => p.proof && readSlip(p.id, p.proof.path, p.proof.uploadedAt)} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary disabled:opacity-50">
                        <ScanLine className="h-3.5 w-3.5" /> <span className="text-[11px]">{reading ? "reading…" : "read slip"}</span>
                      </button>
                    )}
                  </div>
                ) : canEdit ? (
                  <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary underline">
                    <Upload className="h-3.5 w-3.5" /> proof
                    <input type="file" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onProofFile(p.id, f); }} />
                  </label>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              {canEdit && (
                <Button variant="ghost" size="sm" className="md:col-span-1" onClick={() => removePayment(p.id)} disabled={busy}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {st && (
              <p className={`text-[11px] ${st.tone === "ok" ? "text-emerald-600" : st.tone === "bad" ? "text-destructive" : "text-muted-foreground"}`}>{st.text}</p>
            )}
          </div>
        );
      })}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={addPayment}
            disabled={busy}
            className={cn(paymentImportant && "border-teal-400 bg-teal-50 text-teal-700 hover:bg-teal-100 hover:text-teal-700")}
          >
            <Plus className="h-4 w-4" /> Add payment
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save payments"}</Button>
          {dirty && <span className="text-[11px] text-amber-700">Unsaved changes.</span>}
          {msg && <span className="text-[11px] text-muted-foreground">{msg}</span>}
        </div>
      )}
    </div>
  );
}
