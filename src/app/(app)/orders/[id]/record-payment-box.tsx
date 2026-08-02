"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Eye, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { SaleDoc } from "@/lib/sale";
import { uploadDocument } from "@/lib/client-upload";
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
  const [slipDate, setSlipDate] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const remaining = Math.max(0, orderAmount - amountPaid);

  function clearProof() { setProof(null); setSlipDate(null); setInfo(null); setErr(null); }

  async function uploadProof(file: File) {
    setUploading(true); setErr(null); setInfo(null); setSlipDate(null);
    try {
      const doc = await uploadDocument("/api/sale-uploads", file, { quotationId: orderId }) as SaleDoc;
      setProof(doc);
      // AI-read the deposit slip: follow the machine-validated / computer-generated
      // date + amount. Handwritten-only proofs aren't accepted (server-enforced;
      // only an admin can record from them).
      setInfo("Reading slip…");
      const res = await fetch("/api/ai/read-deposit-slip", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId: orderId, path: doc.path }),
      });
      const j = await res.json();
      if (res.ok && j.validated) {
        // The slip is authoritative; correct a typed amount to match it.
        const userAmt = Number(amount) || 0;
        const aiAmt = typeof j.amount === "number" ? j.amount : userAmt;
        const tallied = userAmt > 0 && Math.abs(userAmt - aiAmt) < 0.005;
        setAmount(String(aiAmt));
        setSlipDate(typeof j.date === "string" ? j.date : null);
        setInfo(`Read from validated slip — ${formatCurrency(aiAmt, currency)}${j.date ? ` on ${j.date}` : ""}.`
          + (userAmt > 0 ? (tallied ? " Tallies with your entry." : " Adjusted to match the slip.") : ""));
      } else if (res.ok) {
        setInfo(null);
        const w = Array.isArray(j.warnings) && j.warnings.length ? String(j.warnings[0]) : "This proof isn't machine-validated / computer-generated, so its figures weren't auto-filled.";
        setErr(`${w} Admin / accounting can verify and record it.`);
      } else {
        setInfo(null);
        setErr(j.error ?? "Couldn't read the slip. Enter the amount manually.");
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  }

  async function submit() {
    const amt = Number(amount) || 0;
    if (amt <= 0) { setErr("Enter a payment amount greater than zero."); return; }
    setBusy(true); setErr(null);
    try {
      await recordOrderPayment(orderId, { amount: amt, note, proof, date: slipDate ?? undefined });
      setOpen(false); setAmount(""); setNote(""); clearProof();
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
                <button type="button" className="text-muted-foreground hover:text-destructive" onClick={clearProof} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                {slipDate && <span className="text-[11px] text-muted-foreground">· slip date {slipDate}</span>}
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
      {info && <p className="mt-1 text-xs text-emerald-600">{info}</p>}
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}
