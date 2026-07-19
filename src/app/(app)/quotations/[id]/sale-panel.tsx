"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Check, Upload, Trash2, Plus, FileText, Download } from "lucide-react";
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
  isSaleConfirmed,
} from "@/lib/sale";

const ARRANGEMENTS: SaleArrangement[] = ["downpayment_full", "downpayment_progress", "terms"];
const PAYMENT_KINDS: PaymentKind[] = ["down", "full", "progress"];
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const today = () => new Date().toISOString().slice(0, 10);

// View opens the file inline; download forces a save with its original name.
const docLink = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;
const docDownload = (d: SaleDoc) => `${docLink(d)}&download=1&name=${encodeURIComponent(d.name)}`;

export function SalePanel({
  quotationId,
  currency,
  dealTotal,
  initialSale,
  canEdit,
  canClear = false,
  vatInclusive = true,
}: {
  quotationId: string;
  currency: string;
  dealTotal: number;
  initialSale: SaleRecord | null;
  /** Sales (preparer) or admin — may edit and Save the sale. */
  canEdit: boolean;
  /** Accounting or admin — may Clear the sale. */
  canClear?: boolean;
  /** VAT-inclusive shows Sales Invoice + BIR 2307; exclusive hides them. */
  vatInclusive?: boolean;
}) {
  const router = useRouter();
  const [arrangement, setArrangement] = useState<SaleArrangement>(initialSale?.arrangement ?? "downpayment_full");
  const [po, setPo] = useState<SaleDoc | null>(initialSale?.po ?? null);
  const [payments, setPayments] = useState<SalePayment[]>(initialSale?.payments ?? []);
  const [docs, setDocs] = useState<Record<string, SaleDoc[]>>(initialSale?.docs ?? {});
  const [note, setNote] = useState(initialSale?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const draft: SaleRecord = { arrangement, po, payments };
  const confirmed = isSaleConfirmed(draft);
  const collected = collectedTotal(draft);
  const balance = Math.max(0, dealTotal - collected);
  const hasSaleData = !!(po || payments.length > 0 || Object.keys(docs).length > 0 || note);
  // "Add payment" stays turquoise (still collecting) until a full payment is
  // recorded — down payments and progress billings keep it highlighted.
  const paymentImportant = !payments.some((p) => p.kind === "full");

  async function upload(file: File): Promise<SaleDoc | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("quotationId", quotationId);
    const res = await fetch("/api/sale-uploads", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Upload failed");
      return null;
    }
    return data as SaleDoc;
  }

  async function onPoFile(file: File) {
    setBusy(true); setMsg(null);
    const doc = await upload(file);
    if (doc) setPo(doc);
    setBusy(false);
  }
  async function onProofFile(id: string, file: File) {
    setBusy(true); setMsg(null);
    const doc = await upload(file);
    if (doc) setPayments((ps) => ps.map((p) => (p.id === id ? { ...p, proof: doc } : p)));
    setBusy(false);
  }
  async function onDocFile(key: string, file: File) {
    setBusy(true); setMsg(null);
    const doc = await upload(file);
    if (doc) setDocs((d) => ({ ...d, [key]: [...(d[key] ?? []), doc] }));
    setBusy(false);
  }
  function removeDoc(key: string, path: string) {
    setDocs((d) => ({ ...d, [key]: (d[key] ?? []).filter((x) => x.path !== path) }));
  }

  function addPayment() {
    setPayments((ps) => [...ps, { id: newId(), kind: "down", amount: 0, date: today(), proof: null }]);
  }
  function updatePayment(id: string, patch: Partial<SalePayment>) {
    setPayments((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
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
  // multiple files per slot.
  function DocSlot({ type }: { type: SaleDocType }) {
    // Files from this slot's own key plus any merged keys (e.g. the seeded
    // Inquiry Form shows inside "Computation / Inquiry Form").
    const files: { doc: SaleDoc; srcKey: string }[] = [
      ...(docs[type.key] ?? []).map((doc) => ({ doc, srcKey: type.key })),
      ...(type.mergeKeys ?? []).flatMap((k) => (docs[k] ?? []).map((doc) => ({ doc, srcKey: k }))),
    ];
    return (
      <div className="space-y-1">
        <Label className="text-xs">
          {type.label} <span className="text-muted-foreground">({type.required ? "required" : "optional"})</span>
        </Label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {files.map(({ doc: f, srcKey }) => (
            <div key={f.path} className="flex items-center gap-2">
              <a href={docLink(f)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
                <FileText className="h-4 w-4" /> {f.name}
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
              <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && onDocFile(type.key, e.target.files[0])} />
            </label>
          ) : files.length === 0 ? (
            <span className="text-sm text-muted-foreground">Not attached.</span>
          ) : null}
        </div>
      </div>
    );
  }

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
            <Select value={arrangement} disabled={!canEdit} onChange={(e) => setArrangement(e.target.value as SaleArrangement)}>
              {ARRANGEMENTS.map((a) => (<option key={a} value={a}>{ARRANGEMENT_LABEL[a]}</option>))}
            </Select>
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
          </div>
        </div>

        {/* 1. Purchase Order (always required) */}
        <div className="space-y-1">
          <Label className="text-xs">Purchase Order (required)</Label>
          {po ? (
            <div className="flex items-center gap-2">
              <a href={docLink(po)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
                <FileText className="h-4 w-4" /> {po.name}
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
              <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && onPoFile(e.target.files[0])} />
            </label>
          ) : (
            <span className="text-sm text-muted-foreground">No PO attached.</span>
          )}
        </div>

        {/* 2–6. Computation, Quotation, Drawing/Pictures, Billing DP, Billing FP */}
        {SALE_DOCS_BEFORE_PAYMENTS.map((t) => <DocSlot key={t.key} type={t} />)}

        {/* 7. Payments collected (required) */}
        <div className="space-y-2">
          <Label className="text-xs">Payments Collected (required)</Label>
          {payments.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {arrangement === "terms" ? "On terms — PO alone confirms the sale; add payments as they arrive." : "Add the down payment / full payment to confirm the sale."}
            </p>
          )}
          {payments.map((p) => (
            <div key={p.id} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 md:grid-cols-12">
              <Select className="h-8 md:col-span-3" value={p.kind} disabled={!canEdit} onChange={(e) => updatePayment(p.id, { kind: e.target.value as PaymentKind })}>
                {PAYMENT_KINDS.map((k) => (<option key={k} value={k}>{PAYMENT_KIND_LABEL[k]}</option>))}
              </Select>
              <Input className="h-8 text-right md:col-span-3" type="number" step="0.01" placeholder="Amount ₱" value={p.amount || ""} disabled={!canEdit} onChange={(e) => updatePayment(p.id, { amount: Number(e.target.value) || 0 })} />
              <Input className="h-8 md:col-span-3" type="date" value={p.date?.slice(0, 10) || today()} disabled={!canEdit} onChange={(e) => updatePayment(p.id, { date: e.target.value })} />
              <div className="md:col-span-2">
                {p.proof ? (
                  <div className="flex items-center gap-2">
                    <a href={docLink(p.proof)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
                      <FileText className="h-3.5 w-3.5" /> proof
                    </a>
                    <a href={docDownload(p.proof)} className="text-muted-foreground hover:text-primary" title="Download proof" aria-label="Download proof">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ) : canEdit ? (
                  <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary underline">
                    <Upload className="h-3.5 w-3.5" /> proof
                    <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && onProofFile(p.id, e.target.files[0])} />
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
          ))}
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

        {/* 8–11. Sales Invoice, OR/CR/AF, Delivery Receipt, BIR 2307
            (Sales Invoice + BIR 2307 hidden for VAT-exclusive deals). */}
        {afterPaymentDocTypes(vatInclusive).map((t) => <DocSlot key={t.key} type={t} />)}

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
          <div className="flex items-center gap-2">
            {canEdit && <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save sale"}</Button>}
            {canClear && hasSaleData && (
              <Button variant="outline" onClick={clearAll} disabled={busy}>Clear sale</Button>
            )}
            {canEdit && !canClear && hasSaleData && (
              <span className="text-xs text-muted-foreground">Only accounting or an admin can clear this sale.</span>
            )}
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
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
