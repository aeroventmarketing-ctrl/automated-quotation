"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Check, Upload, Trash2, Plus, FileText } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { recordSale, clearSale } from "../actions";
import {
  type SaleRecord,
  type SaleArrangement,
  type SaleDoc,
  type SalePayment,
  type PaymentKind,
  ARRANGEMENT_LABEL,
  PAYMENT_KIND_LABEL,
  collectedTotal,
  isSaleConfirmed,
} from "@/lib/sale";

const ARRANGEMENTS: SaleArrangement[] = ["downpayment_full", "downpayment_progress", "terms"];
const PAYMENT_KINDS: PaymentKind[] = ["down", "full", "progress"];
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const today = () => new Date().toISOString().slice(0, 10);

export function SalePanel({
  quotationId,
  currency,
  dealTotal,
  initialSale,
  canEdit,
}: {
  quotationId: string;
  currency: string;
  dealTotal: number;
  initialSale: SaleRecord | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [arrangement, setArrangement] = useState<SaleArrangement>(initialSale?.arrangement ?? "downpayment_full");
  const [po, setPo] = useState<SaleDoc | null>(initialSale?.po ?? null);
  const [payments, setPayments] = useState<SalePayment[]>(initialSale?.payments ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const draft: SaleRecord = { arrangement, po, payments };
  const confirmed = isSaleConfirmed(draft);
  const collected = collectedTotal(draft);
  const balance = Math.max(0, dealTotal - collected);

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
    setBusy(true);
    setMsg(null);
    const doc = await upload(file);
    if (doc) setPo(doc);
    setBusy(false);
  }

  async function onProofFile(id: string, file: File) {
    setBusy(true);
    setMsg(null);
    const doc = await upload(file);
    if (doc) setPayments((ps) => ps.map((p) => (p.id === id ? { ...p, proof: doc } : p)));
    setBusy(false);
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
    setBusy(true);
    setMsg(null);
    try {
      await recordSale(quotationId, { arrangement, po, payments });
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
    setBusy(true);
    setMsg(null);
    try {
      await clearSale(quotationId);
      setPo(null);
      setPayments([]);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const docLink = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;

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
              {ARRANGEMENTS.map((a) => (
                <option key={a} value={a}>{ARRANGEMENT_LABEL[a]}</option>
              ))}
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

        {/* Purchase Order (always required) */}
        <div className="space-y-1">
          <Label className="text-xs">Purchase Order (required)</Label>
          {po ? (
            <div className="flex items-center gap-2">
              <a href={docLink(po)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary underline">
                <FileText className="h-4 w-4" /> {po.name}
              </a>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setPo(null)} disabled={busy}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : canEdit ? (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              <Upload className="h-4 w-4" /> Upload PO
              <input type="file" className="hidden" disabled={busy}
                onChange={(e) => e.target.files?.[0] && onPoFile(e.target.files[0])} />
            </label>
          ) : (
            <span className="text-sm text-muted-foreground">No PO attached.</span>
          )}
        </div>

        {/* Payments */}
        <div className="space-y-2">
          <Label className="text-xs">Payments collected</Label>
          {payments.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {arrangement === "terms" ? "On terms — PO alone confirms the sale; add payments as they arrive." : "Add the down payment / full payment to confirm the sale."}
            </p>
          )}
          {payments.map((p) => (
            <div key={p.id} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 md:grid-cols-12">
              <Select className="h-8 md:col-span-3" value={p.kind} disabled={!canEdit}
                onChange={(e) => updatePayment(p.id, { kind: e.target.value as PaymentKind })}>
                {PAYMENT_KINDS.map((k) => (<option key={k} value={k}>{PAYMENT_KIND_LABEL[k]}</option>))}
              </Select>
              <Input className="h-8 text-right md:col-span-3" type="number" step="0.01" placeholder="Amount ₱"
                value={p.amount || ""} disabled={!canEdit}
                onChange={(e) => updatePayment(p.id, { amount: Number(e.target.value) || 0 })} />
              <Input className="h-8 md:col-span-3" type="date" value={p.date?.slice(0, 10) || today()} disabled={!canEdit}
                onChange={(e) => updatePayment(p.id, { date: e.target.value })} />
              <div className="md:col-span-2">
                {p.proof ? (
                  <a href={docLink(p.proof)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary underline">
                    <FileText className="h-3.5 w-3.5" /> proof
                  </a>
                ) : canEdit ? (
                  <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary underline">
                    <Upload className="h-3.5 w-3.5" /> proof
                    <input type="file" className="hidden" disabled={busy}
                      onChange={(e) => e.target.files?.[0] && onProofFile(p.id, e.target.files[0])} />
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
            <Button variant="outline" size="sm" onClick={addPayment} disabled={busy}>
              <Plus className="h-4 w-4" /> Add payment
            </Button>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save sale"}</Button>
            {(po || payments.length > 0) && (
              <Button variant="outline" onClick={clearAll} disabled={busy}>Clear sale</Button>
            )}
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
        )}
        {!confirmed && (
          <p className="text-xs text-muted-foreground">
            A sale is confirmed once a PO is attached{arrangement === "terms" ? "" : " and at least one payment is recorded"}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
