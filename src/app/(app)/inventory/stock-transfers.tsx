"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Eye, Download, Trash2, Check, ArrowRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmTransferReceipt, cancelTransfer, attachTransferProof, removeTransferProof } from "./transfer-actions";
import { type StockTransferView, type StockDoc } from "@/lib/stock-transfer";

const fmtQty = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 3 });
const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "");
const viewUrl = (d: StockDoc) => `/api/transfer-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const dlUrl = (d: StockDoc) => `/api/transfer-uploads?path=${encodeURIComponent(d.path)}&download=1&name=${encodeURIComponent(d.name)}`;

function Handshake({ label, byName, at }: { label: string; byName: string | null; at: string | null }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${byName ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300" : "text-muted-foreground"}`}>
      {byName ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {label}: {byName ? `${byName} · ${fmtDT(at)}` : "pending"}
    </span>
  );
}

function TransferRow({ t, admin }: { t: StockTransferView; admin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("transferId", t.id);
      const res = await fetch("/api/transfer-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await attachTransferProof(t.id, data as StockDoc);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(false); }
  }

  const badge = t.status === "RECEIVED" ? <Badge variant="success">Received</Badge>
    : t.status === "CANCELLED" ? <Badge variant="destructive">Cancelled</Badge>
    : <Badge variant="warning">In transit</Badge>;

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{t.itemName}</span>
        <span className="tabular-nums text-sm text-muted-foreground">{fmtQty(t.qty)} {t.unit}</span>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">{t.fromLocation} <ArrowRight className="h-3.5 w-3.5" /> {t.toLocation}</span>
        {badge}
        <span className="ml-auto text-xs text-muted-foreground">Sent by {t.initiatedByName} · {fmtDT(t.initiatedAt)}</span>
      </div>
      {t.note && <p className="mt-1 text-xs text-muted-foreground">Note: {t.note}</p>}

      {/* Double handshake */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Handshake label="Production head" byName={t.prodHeadByName} at={t.prodHeadAt} />
        <Handshake label="Purchaser" byName={t.purchaserByName} at={t.purchaserAt} />
        {t.status === "RECEIVED" && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">Received {fmtDT(t.receivedAt)}</span>}
        {t.status === "CANCELLED" && t.cancelledByName && <span className="text-[11px] text-muted-foreground">Cancelled by {t.cancelledByName}</span>}
      </div>

      {/* Proof + actions */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {t.proof ? (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <a href={viewUrl(t.proof)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">{t.proof.name}</a>
            <a href={viewUrl(t.proof)} target="_blank" rel="noopener noreferrer" title="View" className="text-muted-foreground hover:text-primary"><Eye className="h-4 w-4" /></a>
            <a href={dlUrl(t.proof)} title="Download" className="text-muted-foreground hover:text-primary"><Download className="h-4 w-4" /></a>
            {admin && <button type="button" title="Remove" disabled={busy} className="text-muted-foreground hover:text-destructive" onClick={() => run(() => removeTransferProof(t.id))}><Trash2 className="h-4 w-4" /></button>}
          </span>
        ) : t.canUpload ? (
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
            <Upload className="h-3.5 w-3.5" /> Upload proof
            <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        ) : (
          <span className="text-xs text-muted-foreground">No proof attached.</span>
        )}

        {t.status === "IN_TRANSIT" && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {t.canConfirmProdHead && !t.prodHeadByName && (
              <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => confirmTransferReceipt(t.id, "prod_head"))}>Confirm — Production head</Button>
            )}
            {t.canConfirmPurchaser && !t.purchaserByName && (
              <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => confirmTransferReceipt(t.id, "purchaser"))}>Confirm — Purchaser</Button>
            )}
            {t.canCancel && (
              <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => run(() => cancelTransfer(t.id))}>Cancel</Button>
            )}
          </div>
        )}
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}

export function StockTransfers({ transfers, missing, admin = false }: { transfers: StockTransferView[]; missing?: boolean; admin?: boolean }) {
  if (missing) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Stock transfers aren&rsquo;t set up yet — apply the <code className="rounded bg-muted px-1">0028_stock_transfer</code> migration to enable them.</p>;
  }
  const active = transfers.filter((t) => t.status === "IN_TRANSIT");
  const past = transfers.filter((t) => t.status !== "IN_TRANSIT");
  return (
    <div className="space-y-3">
      {transfers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stock transfers yet. Use an item&rsquo;s <span className="font-medium">Transfer</span> button to send stock to another location.</p>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Awaiting receipt ({active.length})</div>
              {active.map((t) => <TransferRow key={t.id} t={t} admin={admin} />)}
            </div>
          )}
          {past.length > 0 && (
            <details className="space-y-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completed &amp; cancelled ({past.length})</summary>
              <div className="mt-2 space-y-2">{past.map((t) => <TransferRow key={t.id} t={t} admin={admin} />)}</div>
            </details>
          )}
        </>
      )}
      <p className="text-[11px] text-muted-foreground">Sent stock is held in transit until <b>both</b> a production head and the purchaser confirm the destination received it — then it lands in the destination location.</p>
    </div>
  );
}
