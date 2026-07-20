"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scale, Upload, FileText, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PurchaseReconcileView } from "@/lib/purchase-chain-row";
import type { SaleDoc } from "@/lib/sale";
import { recordReconciliation, settleReconciliation } from "../orders/actions";

const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const link = (path: string) => `/api/purchase-uploads?path=${encodeURIComponent(path)}`;
const dl = (path: string, name: string) => `${link(path)}&download=1&name=${encodeURIComponent(name)}`;

/**
 * Voucher reconciliation panel: shows the issued voucher (PO total) against the
 * actual cash spent, auto-tallying to balanced / change-to-return / over-voucher
 * so accounting doesn't check each voucher and receipt by hand. The purchaser
 * records the spend + uploads receipts; accounting or the purchaser settle any
 * change. `prId` is the request (or anchor) to act on. Read-only on the order page.
 */
export function PurchaseReconcilePanel({
  prId,
  reconcile,
  canRecord,
  canSettle,
  readOnly = false,
}: {
  prId: string;
  reconcile: PurchaseReconcileView;
  canRecord: boolean;
  canSettle: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const recorded = reconcile.actualSpent !== null;
  const [open, setOpen] = useState(false);
  const [spent, setSpent] = useState(recorded ? String(reconcile.actualSpent) : "");
  const [voucher, setVoucher] = useState(String(reconcile.voucherAmount || ""));
  const [note, setNote] = useState("");
  const [receipts, setReceipts] = useState<SaleDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function uploadReceipt(file: File) {
    setBusy("upload"); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("purchaseRequestId", prId);
      const res = await fetch("/api/purchase-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setReceipts((rs) => [...rs, data as SaleDoc]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(null); }
  }

  async function record() {
    const actualSpent = Number(spent.replace(/,/g, ""));
    if (!Number.isFinite(actualSpent) || actualSpent < 0) { setErr("Enter the actual amount spent."); return; }
    setBusy("record"); setErr(null);
    try {
      await recordReconciliation(prId, { actualSpent, voucherAmount: Number(voucher.replace(/,/g, "")) || undefined, receipts, note });
      setOpen(false); setReceipts([]); setNote("");
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function settle() {
    const n = window.prompt("Note (optional) — e.g. change returned to accounting, overspend reimbursed:", "") ?? undefined;
    setBusy("settle"); setErr(null);
    try {
      await settleReconciliation(prId, n);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  // Tally badge for a recorded reconciliation.
  const tally = () => {
    if (reconcile.status === "balanced") return <span className="font-semibold text-emerald-700">Tallied ✓ — voucher matches receipts</span>;
    if (reconcile.status === "change") return <span className="font-semibold text-amber-700">Change to return: {peso(reconcile.variance)}</span>;
    if (reconcile.status === "over") return <span className="font-semibold text-destructive">Over voucher by {peso(-reconcile.variance)}</span>;
    return null;
  };

  // Nothing to show on the read-only order page until it's been reconciled.
  if (readOnly && !recorded) return null;

  return (
    <div className="mt-2 space-y-2 rounded-md border p-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Scale className="h-3.5 w-3.5" /> Voucher reconciliation
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm sm:max-w-sm">
        <span className="text-muted-foreground">Voucher issued</span>
        <span className="text-right tabular-nums font-medium">{peso(reconcile.voucherAmount)}</span>
        {recorded && (
          <>
            <span className="text-muted-foreground">Actual spent (receipts)</span>
            <span className="text-right tabular-nums font-medium">{peso(reconcile.actualSpent!)}</span>
          </>
        )}
      </div>

      {recorded ? (
        <>
          <div className="text-sm">{tally()}</div>
          {reconcile.receipts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Receipts:</span>
              {reconcile.receipts.map((f) => (
                <span key={f.path} className="inline-flex items-center gap-1">
                  <a href={link(f.path)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                    <FileText className="h-3.5 w-3.5" /> {f.name}
                  </a>
                  <a href={dl(f.path, f.name)} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </span>
              ))}
            </div>
          )}
          {reconcile.note && <p className="text-xs text-muted-foreground">Note: {reconcile.note}</p>}
          {reconcile.recorded && <p className="text-xs text-muted-foreground">Reconciled by {reconcile.recorded}</p>}
          {reconcile.settled ? (
            <p className="text-xs text-emerald-700">✓ Settled — {reconcile.settled}</p>
          ) : reconcile.status !== "balanced" && !readOnly && canSettle ? (
            <button type="button" onClick={settle} disabled={busy === "settle"}
              className="rounded border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/10">
              {busy === "settle" ? "…" : reconcile.status === "change" ? "Mark change returned" : "Mark overspend settled"}
            </button>
          ) : null}
          {!readOnly && canRecord && !open && (
            <button type="button" onClick={() => { setOpen(true); setSpent(String(reconcile.actualSpent)); setVoucher(String(reconcile.voucherAmount || "")); }}
              className="ml-3 text-xs font-medium text-muted-foreground hover:text-foreground">Correct figures</button>
          )}
        </>
      ) : !readOnly && canRecord && !open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-accent">
          <Scale className="h-3.5 w-3.5" /> Reconcile voucher (record spend &amp; receipts)
        </button>
      ) : !recorded && !readOnly ? (
        <p className="text-xs text-muted-foreground">Awaiting the Purchaser to record the actual spend &amp; receipts.</p>
      ) : null}

      {!readOnly && canRecord && open && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">Voucher issued (₱)
              <Input className="h-8 w-32" value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="0.00" />
            </label>
            <label className="text-xs text-muted-foreground">Actual spent (₱)
              <Input className="h-8 w-32" value={spent} onChange={(e) => setSpent(e.target.value)} placeholder="0.00" />
            </label>
          </div>
          {/* Live preview of the tally as the numbers are entered. */}
          {spent.trim() !== "" && (() => {
            const v = Number(voucher.replace(/,/g, "")) || 0;
            const s = Number(spent.replace(/,/g, "")) || 0;
            const diff = Math.round((v - s) * 100) / 100;
            return (
              <p className="text-xs">
                {Math.abs(diff) < 0.005 ? <span className="font-medium text-emerald-700">Tallies ✓</span>
                  : diff > 0 ? <span className="font-medium text-amber-700">Change to return: {peso(diff)}</span>
                  : <span className="font-medium text-destructive">Over voucher by {peso(-diff)}</span>}
              </p>
            );
          })()}
          {/* Receipts */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">Receipts:</span>
            {receipts.map((f) => (
              <span key={f.path} className="inline-flex items-center gap-1">
                <a href={link(f.path)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                  <FileText className="h-3.5 w-3.5" /> {f.name}
                </a>
                <button type="button" onClick={() => setReceipts((rs) => rs.filter((x) => x.path !== f.path))} className="text-muted-foreground hover:text-destructive" aria-label="Remove">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 font-medium hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> {busy === "upload" ? "Uploading…" : receipts.length ? "Add receipt" : "Upload receipt"}
              <input type="file" className="hidden" disabled={busy === "upload"} onChange={(e) => e.target.files?.[0] && uploadReceipt(e.target.files[0])} />
            </label>
          </div>
          <Input className="h-8" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" disabled={busy === "record"} onClick={record}>{busy === "record" ? "Saving…" : "Record & tally"}</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
