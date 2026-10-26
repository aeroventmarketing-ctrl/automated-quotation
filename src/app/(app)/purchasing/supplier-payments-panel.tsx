"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet, Plus, Paperclip, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UploadLink } from "@/components/upload-link";
import { uploadDocument } from "@/lib/client-upload";
import { formatCurrency, formatDate } from "@/lib/utils";
import { supplierPaymentTotals, type SupplierPayment, type SupplierPaymentProof } from "@/lib/supplier-payments";
import { addSupplierPayment, removeSupplierPayment } from "./supplier-payment-actions";

const todayYMD = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

/**
 * "Payments to supplier" on a PO — the owner: *"add an option to add lists of
 * payments and dates of payments made. Add a link to upload proof of payment and
 * eye view for easy viewing. Some PO requires DP to suppliers, we want to monitor
 * those payments made."*
 *
 * Each payment: date, amount, note, and its proof (name · 👁 view · download).
 * Totals against what the supplier is owed (`due` — the PO net, total less EWT).
 * `canEdit` adds the form and the remove buttons; without it the list is read-only.
 */
export function SupplierPaymentsPanel({
  prId,
  due,
  payments,
  canEdit,
}: {
  /** The request that carries the list — a combined PO's anchor. */
  prId: string;
  due: number;
  payments: SupplierPayment[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYMD());
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<SupplierPaymentProof | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = supplierPaymentTotals(payments, due);

  if (!canEdit && payments.length === 0) return null;

  async function pickFile(f: File | undefined) {
    if (!f) return;
    setBusy("upload"); setErr(null);
    try {
      const doc = await uploadDocument("/api/purchase-uploads", f, { purchaseRequestId: prId });
      setProof({ path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    setBusy("save"); setErr(null);
    const res = await addSupplierPayment(prId, { amount: Number(amount), date, note, proof });
    setBusy(null);
    if (res.error) { setErr(res.error); return; }
    setAmount(""); setNote(""); setProof(null); setDate(todayYMD()); setOpen(false);
    router.refresh();
  }

  async function remove(p: SupplierPayment) {
    if (!window.confirm(`Remove the ${formatCurrency(p.amount, "PHP")} payment of ${formatDate(p.date)}?`)) return;
    setBusy(p.id); setErr(null);
    const res = await removeSupplierPayment(prId, p.id);
    setBusy(null);
    if (res.error) setErr(res.error);
    else router.refresh();
  }

  return (
    <div className="mt-2 rounded-md border bg-muted/20 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          <Wallet className="h-3.5 w-3.5 text-muted-foreground" /> Payments to supplier
          {payments.length > 0 && <span className="font-normal text-muted-foreground">({payments.length})</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
          <span>Paid <b>{formatCurrency(t.paid, "PHP")}</b>{t.pct != null && t.paid > 0 ? ` · ${t.pct}%` : ""}</span>
          {due > 0 && (t.over > 0
            ? <span className="font-medium text-red-700 dark:text-red-400">Overpaid {formatCurrency(t.over, "PHP")}</span>
            : <span className={t.balance === 0 ? "font-medium text-emerald-700 dark:text-emerald-400" : ""}>{t.balance === 0 ? "Fully paid" : <>Balance <b>{formatCurrency(t.balance, "PHP")}</b></>}</span>)}
          {canEdit && !open && (
            <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add payment
            </button>
          )}
        </div>
      </div>

      {payments.length > 0 && (
        <table className="mt-1.5 w-full border-collapse">
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t align-top">
                <td className="whitespace-nowrap py-1 pr-2 tabular-nums">{formatDate(p.date)}</td>
                <td className="whitespace-nowrap py-1 pr-2 text-right font-medium tabular-nums">{formatCurrency(p.amount, "PHP")}</td>
                <td className="py-1 pr-2">
                  {p.note && <span>{p.note} </span>}
                  <span className="text-[10px] text-muted-foreground">· {p.byName}</span>
                </td>
                <td className="py-1 pr-1 text-right">
                  {p.proof
                    ? <UploadLink doc={p.proof} base="/api/purchase-uploads" size="xs" />
                    : <span className="text-[10px] text-amber-700 dark:text-amber-400">no proof</span>}
                </td>
                {canEdit && (
                  <td className="w-5 py-1 text-right">
                    <button type="button" onClick={() => remove(p)} disabled={busy != null} className="text-muted-foreground hover:text-destructive disabled:opacity-50" title="Remove this payment" aria-label="Remove this payment">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && payments.length === 0 && !open && (
        <p className="mt-1 text-muted-foreground">No payment recorded yet — add the down payment and any later payments made to the supplier.</p>
      )}

      {canEdit && open && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t pt-2">
          <label className="space-y-0.5">
            <span className="block text-[10px] text-muted-foreground">Date paid</span>
            <Input type="date" className="h-8 w-36" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="space-y-0.5">
            <span className="block text-[10px] text-muted-foreground">Amount (₱)</span>
            <Input type="number" step="any" min={0} className="h-8 w-32 text-right" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t.balance > 0 ? String(t.balance) : ""} />
          </label>
          <label className="min-w-[10rem] flex-1 space-y-0.5">
            <span className="block text-[10px] text-muted-foreground">Note</span>
            <Input className="h-8" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 50% down payment, bank transfer" />
          </label>
          <div className="space-y-0.5">
            <span className="block text-[10px] text-muted-foreground">Proof of payment</span>
            {proof ? (
              <span className="inline-flex h-8 items-center gap-1.5">
                <UploadLink doc={proof} base="/api/purchase-uploads" size="xs" onRemove={() => setProof(null)} />
              </span>
            ) : (
              <>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={busy != null} onClick={() => fileRef.current?.click()}>
                  <Paperclip className="mr-1 h-3.5 w-3.5" /> {busy === "upload" ? "Uploading…" : "Upload proof"}
                </Button>
              </>
            )}
          </div>
          <Button type="button" size="sm" className="h-8 text-xs" disabled={busy != null || !(Number(amount) > 0) || !date} onClick={save}>
            {busy === "save" ? "Saving…" : "Save payment"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy != null} onClick={() => { setOpen(false); setErr(null); }}>
            Cancel
          </Button>
        </div>
      )}
      {err && <p className="mt-1 text-destructive">{err}</p>}
    </div>
  );
}
