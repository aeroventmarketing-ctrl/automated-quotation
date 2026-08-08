"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Check, Upload, Trash2, Plus, FileText, Download, Eye, ScanLine } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { recordSale, clearSale } from "../actions";
import {
  type SaleRecord,
  type SaleArrangement,
  type SaleDoc,
  type SaleDocType,
  type SalePayment,
  type PaymentKind,
  ARRANGEMENT_LABEL,
  PAYMENT_KIND_LABEL,
  SALE_DOCS_BEFORE_PAYMENTS,
  afterPaymentDocTypes,
  collectedTotal,
  ewtWithheld,
  isSaleConfirmed,
} from "@/lib/sale";
import { uploadDocument } from "@/lib/client-upload";

const ARRANGEMENTS: SaleArrangement[] = ["downpayment_full", "downpayment_progress", "terms"];
const PAYMENT_KINDS: PaymentKind[] = ["down", "full", "progress", "ewt"];
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Auto-designate full payment: clients may pay any amount in any number of
 * instalments (no 50% floor). The payment that makes the running total tally to
 * the order total flips from "Down payment" to "Full payment" — so a single
 * payment covering the whole deal, or the instalment that completes it, reads as
 * Full. Only a "down" payment is switched (progress / EWT are left alone), and it
 * only ever promotes down → full (never the reverse). The figures stay manually
 * verified by admin / accounting on review.
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
      return list; // total reached, but the completing payment isn't a down payment
    }
  }
  return list; // never reaches the order total
}

// View opens the file inline; download forces a save with its original name.
const docLink = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;
const docView = (d: SaleDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const docDownload = (d: SaleDoc) => `${docLink(d)}&download=1&name=${encodeURIComponent(d.name)}`;

export function SalePanel({
  quotationId,
  currency,
  dealTotal,
  initialSale,
  canEdit,
  canClear = false,
  clientTerms = false,
  vatInclusive = true,
  zeroRated = false,
}: {
  quotationId: string;
  currency: string;
  dealTotal: number;
  initialSale: SaleRecord | null;
  /** Sales (preparer) or admin — may edit and Save the sale. */
  canEdit: boolean;
  /** Accounting or admin — may Clear the sale. */
  canClear?: boolean;
  /** The client is on terms (admin-set): a PO alone confirms the sale and the
   * document/payment gate on "Save sale" is relaxed to the PO only. */
  clientTerms?: boolean;
  /** VAT-inclusive shows Sales Invoice + BIR 2307; exclusive hides them. */
  vatInclusive?: boolean;
  /** Zero-rated also requires the Certificate of VAT Exempt/Zero Rated. */
  zeroRated?: boolean;
}) {
  const router = useRouter();
  // A terms client is locked to the "Terms (PO)" arrangement so the PO alone
  // confirms the sale everywhere it's read (isSaleConfirmed).
  const [arrangement, setArrangement] = useState<SaleArrangement>(
    clientTerms ? "terms" : initialSale?.arrangement ?? "downpayment_full",
  );
  const [po, setPo] = useState<SaleDoc | null>(initialSale?.po ?? null);
  const [payments, setPayments] = useState<SalePayment[]>(() => withAutoFull(initialSale?.payments ?? [], dealTotal));
  const [docs, setDocs] = useState<Record<string, SaleDoc[]>>(initialSale?.docs ?? {});
  const [note, setNote] = useState(initialSale?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Per-payment deposit-slip read status (shown inline next to each proof).
  const [slipStatus, setSlipStatus] = useState<Record<string, { tone: "muted" | "ok" | "bad"; text: string }>>({});
  const [readingId, setReadingId] = useState<string | null>(null);

  const draft: SaleRecord = { arrangement, po, payments };
  const confirmed = isSaleConfirmed(draft);
  const collected = collectedTotal(draft);
  const ewt = ewtWithheld(draft);
  const cashCollected = collected - ewt;
  const balance = Math.max(0, dealTotal - collected);
  const hasSaleData = !!(po || payments.length > 0 || Object.keys(docs).length > 0 || note);
  // "Add payment" stays turquoise (still collecting) until a full payment is
  // recorded — down payments and progress billings keep it highlighted.
  const paymentImportant = !payments.some((p) => p.kind === "full");

  // "Save sale" gate. A TERMS client (admin-set) confirms on the Purchase Order
  // alone. A regular client must attach the core documents — PO + Computation +
  // Quotation + RFQ/BOQ — plus record a down or full payment. The Computation
  // slot is satisfied by a computation OR the seeded inquiry-form file.
  const hasComputation = (docs.computation?.length ?? 0) > 0 || (docs.inquiry_form?.length ?? 0) > 0;
  const hasQuotationDoc = (docs.quotation?.length ?? 0) > 0;
  const hasRfqDoc = (docs.rfq_boq?.length ?? 0) > 0;
  // A qualifying payment is a down/full payment with an amount AND its proof of
  // payment attached — Save sale stays locked until the proof is uploaded.
  const isQualifyingKind = (p: SalePayment) => (p.kind === "down" || p.kind === "full") && Number(p.amount) > 0;
  const hasQualifyingAmount = payments.some(isQualifyingKind);
  const hasQualifyingPayment = payments.some((p) => isQualifyingKind(p) && !!p.proof);
  const missingToSave: string[] = [];
  if (!po) missingToSave.push("Purchase Order");
  if (!clientTerms) {
    if (!hasComputation) missingToSave.push("Computation");
    if (!hasQuotationDoc) missingToSave.push("Quotation");
    if (!hasRfqDoc) missingToSave.push("RFQ / BOQ");
    if (!hasQualifyingPayment) missingToSave.push(hasQualifyingAmount ? "proof of payment" : "a down or full payment");
  }
  // Once a sale is already confirmed, saving stays open so the remaining
  // documents (Sales Invoice, OR/CR/AF, …) can be added anytime; the gate only
  // governs confirming a new sale.
  const alreadyConfirmed = isSaleConfirmed(initialSale);
  const canSave = alreadyConfirmed || missingToSave.length === 0;

  async function upload(file: File): Promise<SaleDoc | null> {
    // Never throw: a too-large / non-JSON error must still return null so the
    // caller's `finally` resets `busy` — otherwise every upload input stays
    // disabled until a page refresh. Large images are compressed first.
    try {
      return await uploadDocument("/api/sale-uploads", file, { quotationId }) as SaleDoc;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed — check your connection and try again.");
      return null;
    }
  }

  async function onPoFile(file: File) {
    setBusy(true); setMsg(null);
    try {
      const doc = await upload(file);
      if (doc) setPo(doc);
    } finally { setBusy(false); }
  }
  async function onProofFile(id: string, file: File) {
    setBusy(true); setMsg(null);
    try {
      const doc = await upload(file);
      if (!doc) return;
      setPayments((ps) => ps.map((p) => (p.id === id ? { ...p, proof: doc } : p)));
      await readSlip(id, doc.path, doc.uploadedAt);
    } finally { setBusy(false); }
  }
  // AI-read a payment's deposit slip / proof of payment. A validated (machine-
  // validated or computer-generated) slip fills the row's amount + date and its
  // figures are authoritative; handwritten-only proofs aren't accepted. Works on
  // a freshly uploaded proof or on an already-attached one (the "Read slip"
  // button), with the result shown inline next to that payment.
  async function readSlip(id: string, path: string, uploadedAt?: string) {
    setReadingId(id);
    setSlipStatus((s) => ({ ...s, [id]: { tone: "muted", text: "Reading slip…" } }));
    try {
      const res = await fetch("/api/ai/read-deposit-slip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId, path, uploadedAt }),
      });
      const j = await res.json();
      if (res.ok && j.validated) {
        const current = payments.find((p) => p.id === id);
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
        const newTotal = payments.reduce((sum, pp) => sum + (pp.id === id ? finalAmt : Number(pp.amount) || 0), 0);
        const nowFull = dealTotal > 0 && newTotal >= dealTotal - 0.01;
        setPayments((ps) => withAutoFull(ps.map((p) => (p.id === id ? { ...p, date: finalDate, amount: finalAmt } : p)), dealTotal));
        // Mismatch = a typed amount, or a deliberately-set date, that differs from the slip.
        const amtMismatch = amtTyped && Math.abs(userAmt - aiAmt) >= 0.005;
        const dateMismatch = !dateIsDefault && !!aiDate && rawDate !== aiDate;
        const fullNote = nowFull ? " Covers the order total → set to Full payment." : "";
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
  async function onDocFile(key: string, file: File) {
    setBusy(true); setMsg(null);
    try {
      const doc = await upload(file);
      if (doc) setDocs((d) => ({ ...d, [key]: [...(d[key] ?? []), doc] }));
    } finally { setBusy(false); }
  }
  function removeDoc(key: string, path: string) {
    setDocs((d) => ({ ...d, [key]: (d[key] ?? []).filter((x) => x.path !== path) }));
  }

  function addPayment() {
    setPayments((ps) => [...ps, { id: newId(), kind: "down", amount: 0, date: today(), proof: null }]);
  }
  function updatePayment(id: string, patch: Partial<SalePayment>) {
    setPayments((ps) => withAutoFull(ps.map((p) => (p.id === id ? { ...p, ...patch } : p)), dealTotal));
  }
  function removePayment(id: string) {
    setPayments((ps) => ps.filter((p) => p.id !== id));
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await recordSale(quotationId, { arrangement, po, payments, docs, note });
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  async function clearAll() {
    if (!confirm("Remove this sale record? Attached files stay in storage.")) return;
    setBusy(true); setMsg(null);
    try {
      await clearSale(quotationId);
      setPo(null); setPayments([]); setDocs({}); setNote("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  // One document slot (Computation, Quotation, Sales Invoice, …) — supports
  // multiple files per slot. Rendered as an inline function (NOT a nested
  // <Component/>): a component declared inside the parent is a new type on every
  // render, so React would remount its file <input> whenever parent state changes
  // (e.g. `busy` toggling during an upload) — which dropped the first file pick
  // and forced a second upload. Called as a function, its output reconciles in
  // place and the input DOM node is preserved.
  const renderDocSlot = (type: SaleDocType) => {
    // Files from this slot's own key plus any merged keys (e.g. the seeded
    // Inquiry Form shows inside "Computation / Inquiry Form").
    const files: { doc: SaleDoc; srcKey: string }[] = [
      ...(docs[type.key] ?? []).map((doc) => ({ doc, srcKey: type.key })),
      ...(type.mergeKeys ?? []).flatMap((k) => (docs[k] ?? []).map((doc) => ({ doc, srcKey: k }))),
    ];
    return (
      <div key={type.key} className="space-y-1">
        <Label className="text-xs">
          {type.label} <span className="text-muted-foreground">({type.required ? "required" : "optional"})</span>
        </Label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {files.map(({ doc: f, srcKey }) => (
            <div key={f.path} className="flex items-center gap-2">
              <a href={docView(f)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
                <FileText className="h-4 w-4" /> {f.name}
              </a>
              <a href={docView(f)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View" aria-label="View">
                <Eye className="h-4 w-4" />
              </a>
              <a href={docDownload(f)} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
                <Download className="h-4 w-4" />
              </a>
              {canEdit && (
                <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => removeDoc(srcKey, f.path)} disabled={busy} aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {canEdit ? (
            <label className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent",
              type.important && files.length === 0 && "border-teal-400 bg-teal-50 text-teal-700 hover:bg-teal-100",
            )}>
              <Upload className="h-4 w-4" /> {files.length ? "Add file" : "Upload"}
              <input type="file" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onDocFile(type.key, f); }} />
            </label>
          ) : files.length === 0 ? (
            <span className="text-sm text-muted-foreground">Not attached.</span>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Sale &amp; payment</CardTitle>
        {confirmed ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-xs font-semibold text-white">
            <Check className="h-3.5 w-3.5" /> Sale confirmed
          </span>
        ) : (
          <span className="rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
            {po ? "Awaiting payment" : "PO required"}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Payment arrangement</Label>
            <Select value={arrangement} disabled={!canEdit || clientTerms} onChange={(e) => setArrangement(e.target.value as SaleArrangement)}>
              {ARRANGEMENTS.map((a) => (<option key={a} value={a}>{ARRANGEMENT_LABEL[a]}</option>))}
            </Select>
            {clientTerms && <p className="text-[11px] text-muted-foreground">Terms client — a PO alone confirms the sale.</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Deal value</Label>
            <div className="flex h-9 items-center text-sm font-semibold">{formatCurrency(dealTotal, currency)}</div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Collected · Balance</Label>
            <div className="flex h-9 items-center gap-2 text-sm">
              <span className="font-semibold text-green-700">{formatCurrency(collected, currency)}</span>
              <span className="text-muted-foreground">/ {formatCurrency(balance, currency)} due</span>
            </div>
            {ewt > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Cash {formatCurrency(cashCollected, currency)} + EWT withheld {formatCurrency(ewt, currency)} (BIR 2307)
              </p>
            )}
          </div>
        </div>

        {/* 1. Purchase Order (always required) */}
        <div className="space-y-1">
          <Label className="text-xs">Purchase Order (required)</Label>
          {po ? (
            <div className="flex items-center gap-2">
              <a href={docView(po)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
                <FileText className="h-4 w-4" /> {po.name}
              </a>
              <a href={docView(po)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View PO" aria-label="View PO">
                <Eye className="h-4 w-4" />
              </a>
              <a href={docDownload(po)} className="text-muted-foreground hover:text-primary" title="Download PO" aria-label="Download PO">
                <Download className="h-4 w-4" />
              </a>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setPo(null)} disabled={busy}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : canEdit ? (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-teal-400 bg-teal-50 px-3 py-1.5 text-sm text-teal-700 hover:bg-teal-100">
              <Upload className="h-4 w-4" /> Upload PO
              <input type="file" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPoFile(f); }} />
            </label>
          ) : (
            <span className="text-sm text-muted-foreground">No PO attached.</span>
          )}
        </div>

        {/* 2–6. Computation, Quotation, Drawing/Pictures, Billing DP, Billing FP */}
        {SALE_DOCS_BEFORE_PAYMENTS.map((t) => renderDocSlot(t))}

        {/* 7. Payments collected (required) */}
        <div className="space-y-2">
          <Label className="text-xs">Payments Collected (required)</Label>
          {payments.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {arrangement === "terms" ? "On terms — PO alone confirms the sale; add payments as they arrive." : "Add the down payment / full payment to confirm the sale."}
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
              <Input className="h-8 text-right md:col-span-3" type="number" step="0.01" placeholder="Amount ₱" value={p.amount || ""} disabled={!canEdit} onChange={(e) => updatePayment(p.id, { amount: Number(e.target.value) || 0 })} />
              <Input className="h-8 md:col-span-3" type="date" value={p.date?.slice(0, 10) || today()} disabled={!canEdit} onChange={(e) => updatePayment(p.id, { date: e.target.value })} />
              <div className="md:col-span-2">
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
            <Button
              variant="outline"
              size="sm"
              onClick={addPayment}
              disabled={busy}
              className={cn(paymentImportant && "border-teal-400 bg-teal-50 text-teal-700 hover:bg-teal-100 hover:text-teal-700")}
            >
              <Plus className="h-4 w-4" /> Add payment
            </Button>
          )}
        </div>

        {/* Proof of the final payment — reviewed by the approver on the order,
            reflected here once attached. */}
        {renderDocSlot({ key: "final_payment", label: "Final payment proof", required: false })}

        {/* 8–11. Sales Invoice, OR/CR/AF, Delivery Receipt, BIR 2307
            (Sales Invoice + BIR 2307 hidden for VAT-exclusive deals; a zero-rated
            deal adds the Certificate of VAT Exempt/Zero Rated). */}
        {afterPaymentDocTypes(vatInclusive, zeroRated).map((t) => renderDocSlot(t))}

        {/* Client note — additional information given by the client. */}
        <div className="space-y-1">
          <Label className="text-xs">Note (additional information given by the client)</Label>
          <textarea
            className="min-h-[70px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="e.g. special delivery instructions, requested changes, remarks from the client…"
            value={note}
            disabled={!canEdit}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {(canEdit || canClear) && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {canEdit && <Button onClick={save} disabled={busy || !canSave}>{busy ? "Saving…" : "Save sale"}</Button>}
              {canClear && hasSaleData && (
                <Button variant="outline" onClick={clearAll} disabled={busy}>Clear sale</Button>
              )}
              {canEdit && !canClear && hasSaleData && (
                <span className="text-xs text-muted-foreground">Only accounting or an admin can clear this sale.</span>
              )}
              {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
            </div>
            {canEdit && !canSave && (
              <p className="text-xs text-amber-700">
                Attach {missingToSave.join(", ")} to enable saving.
              </p>
            )}
          </div>
        )}
        {!confirmed && (
          <p className="text-xs text-muted-foreground">
            A sale is confirmed once a PO is attached{arrangement === "terms" ? "" : " and at least one payment is recorded"}. The other documents can be added anytime.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
