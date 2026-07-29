"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Eye, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { SaleDoc } from "@/lib/sale";
import { recordOrderPayment } from "../actions";

const docView = (d: SaleDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;

/**
 * Record a payment against the order (single-delivery Phase 5). Appends a
 * payment to the sale record — so it reflects here (Payment made — for review)
 * and on the quotation tab — with an amount, optional note and an optional
 * proof file. Works any time, including after the item is delivered, so the
 * remaining balance can be collected. Shown to Accounting / Payment Approver /
 * Engineer / admin.
 */
export function RecordPaymentBox({ orderId, currency, orderAmount, amountPaid }: { orderId: string; currency: string; orderAmount: number; amountPaid: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<SaleDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const remaining = Math.max(0, orderAmount - amountPaid);

  async function uploadProof(file: File) {
    setUploading(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("quotationId", orderId);
      const res = await fetch("/api/sale-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setProof(data as SaleDoc);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  }

  async function submit() {
    const amt = Number(amount) || 0;
    if (amt <= 0) { setErr("Enter a payment amount greater than zero."); return; }
    setBusy(true); setErr(null);
    try {
      await recordOrderPayment(orderId, { amount: amt, note, proof });
      setOpen(false); setAmount(""); setNote(""); setProof(null);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">Order amount: <span className="font-semibold tabular-nums text-foreground">{formatCurrency(orderAmount, currency)}</span></span>
        <span className="text-muted-foreground">Amount paid: <span className="font-semibold tabular-nums text-emerald-600">{formatCurrency(amountPaid, currency)}</span></span>
        <span className="text-muted-foreground">Remaining: <span className="font-semibold tabular-nums text-foreground">{formatCurrency(remaining, currency)}</span></span>
        {!open && (
          <Button size="sm" variant="outline" className="ml-auto h-8 text-xs" disabled={busy} onClick={() => { setOpen(true); setErr(null); }}>Record payment</Button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Record a collection any time — including after the item is delivered. Payments show here and on the quotation tab.</p>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border bg-background p-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">Payment amount</label>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-8 w-32 rounded-md border bg-background px-2 text-right text-sm" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="OR no. / note (optional)" className="h-8 flex-1 min-w-[9rem] rounded-md border bg-background px-2 text-sm" />
          </div>
          {/* Payment details / proof — uploaded now, viewable without downloading. */}
          <div className="flex flex-wrap items-center gap-2">
            {proof ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <a href={docView(proof)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline"><FileText className="h-3.5 w-3.5" /> {proof.name}</a>
                <a href={docView(proof)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View" aria-label="View"><Eye className="h-3.5 w-3.5" /></a>
                <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setProof(null)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Add payment details"}
                <input type="file" className="hidden" disabled={uploading || busy} onChange={(e) => { if (e.target.files?.[0]) uploadProof(e.target.files[0]); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" disabled={busy || uploading} onClick={submit}>{busy ? "Saving…" : "Record payment"}</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => { setOpen(false); setProof(null); setErr(null); }}>Cancel</Button>
          </div>
        </div>
      )}
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}
