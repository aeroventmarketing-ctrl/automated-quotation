"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Eye, Download, Trash2, Check, ArrowRight, Clock, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmTransferReceipt, cancelTransfer, attachTransferProof, removeTransferProof, deleteTransfer,
  requestOfficeTransfer, approveOfficeTransfer, releaseOfficeTransfer, deliverOfficeTransfer, receiveOfficeTransfer,
} from "./transfer-actions";
import { STOCK_TRANSFER_STATUS_LABEL, type StockTransferView, type StockDoc } from "@/lib/stock-transfer";

const fmtQty = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 3 });
const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "");
const viewUrl = (d: StockDoc) => `/api/transfer-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const dlUrl = (d: StockDoc) => `/api/transfer-uploads?path=${encodeURIComponent(d.path)}&download=1&name=${encodeURIComponent(d.name)}`;

interface StockOption { id: string; name: string; location: string; unit: string; available: number }

function Step({ label, byName, at }: { label: string; byName: string | null; at: string | null }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${byName ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300" : "text-muted-foreground"}`}>
      {byName ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {label}: {byName ? `${byName} · ${fmtDT(at)}` : "pending"}
    </span>
  );
}

function statusBadge(t: StockTransferView) {
  if (t.status === "RECEIVED") return <Badge variant="success">Received</Badge>;
  if (t.status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="warning">{STOCK_TRANSFER_STATUS_LABEL[t.status]}</Badge>;
}

function useRowActions(refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  return { busy, err, run, setBusy, setErr };
}

/** The Office chain (Fans → Office): request → approve → release → deliver → receive. */
function OfficeTransferRow({ t, admin }: { t: StockTransferView; admin: boolean }) {
  const router = useRouter();
  const { busy, err, run } = useRowActions(() => router.refresh());
  const active = t.status !== "RECEIVED" && t.status !== "CANCELLED";

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{t.itemName}</span>
        <span className="tabular-nums text-sm text-muted-foreground">{fmtQty(t.qty)} {t.unit}</span>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">{t.fromLocation} <ArrowRight className="h-3.5 w-3.5" /> {t.toLocation}</span>
        {statusBadge(t)}
        <span className="ml-auto text-xs text-muted-foreground">Requested by {t.initiatedByName} · {fmtDT(t.initiatedAt)}</span>
      </div>
      {t.note && <p className="mt-1 text-xs text-muted-foreground">Note: {t.note}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Step label="Requested" byName={t.initiatedByName} at={t.initiatedAt} />
        <Step label="Plant Manager" byName={t.approvedByName} at={t.approvedAt} />
        <Step label="Released" byName={t.releasedByName} at={t.releasedAt} />
        <Step label="Delivered" byName={t.deliveredByName} at={t.deliveredAt} />
        <Step label="Office received" byName={t.receivedByName} at={t.receivedAt} />
        {t.status === "CANCELLED" && t.cancelledByName && <span className="text-[11px] text-muted-foreground">Cancelled by {t.cancelledByName}</span>}
        {t.status === "CANCELLED" && admin && (
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => run(() => deleteTransfer(t.id))}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
        )}
      </div>

      {active && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {t.status === "REQUESTED" && t.canApprove && (
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => approveOfficeTransfer(t.id))}>Approve (Plant Manager)</Button>
          )}
          {t.status === "APPROVED" && t.canRelease && (
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => releaseOfficeTransfer(t.id))}>Release from stock (Warehouse)</Button>
          )}
          {t.status === "RELEASED" && t.canDeliver && (
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => deliverOfficeTransfer(t.id))}>Delivered to Office (Logistics)</Button>
          )}
          {t.status === "DELIVERING" && t.canReceive && (
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => receiveOfficeTransfer(t.id))}>Office received</Button>
          )}
          {t.canCancel && (
            <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => run(() => cancelTransfer(t.id))}>Cancel</Button>
          )}
          {!t.canApprove && t.status === "REQUESTED" && <span className="text-[11px] text-muted-foreground">Awaiting Plant Manager approval.</span>}
          {!t.canRelease && t.status === "APPROVED" && <span className="text-[11px] text-muted-foreground">Awaiting Warehouse release.</span>}
          {!t.canDeliver && t.status === "RELEASED" && <span className="text-[11px] text-muted-foreground">Awaiting Logistics delivery.</span>}
          {!t.canReceive && t.status === "DELIVERING" && <span className="text-[11px] text-muted-foreground">Awaiting Office (Sales) receipt.</span>}
        </div>
      )}
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}

/** The existing 2-party handshake (any non-Office location move). */
function TransferRow({ t, admin }: { t: StockTransferView; admin: boolean }) {
  const router = useRouter();
  const { busy, err, run, setBusy, setErr } = useRowActions(() => router.refresh());
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

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{t.itemName}</span>
        <span className="tabular-nums text-sm text-muted-foreground">{fmtQty(t.qty)} {t.unit}</span>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">{t.fromLocation} <ArrowRight className="h-3.5 w-3.5" /> {t.toLocation}</span>
        {statusBadge(t)}
        <span className="ml-auto text-xs text-muted-foreground">Sent by {t.initiatedByName} · {fmtDT(t.initiatedAt)}</span>
      </div>
      {t.note && <p className="mt-1 text-xs text-muted-foreground">Note: {t.note}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Step label="Production head" byName={t.prodHeadByName} at={t.prodHeadAt} />
        <Step label="Purchaser" byName={t.purchaserByName} at={t.purchaserAt} />
        {t.status === "RECEIVED" && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">Received {fmtDT(t.receivedAt)}</span>}
        {t.status === "CANCELLED" && t.cancelledByName && <span className="text-[11px] text-muted-foreground">Cancelled by {t.cancelledByName}</span>}
        {t.status === "CANCELLED" && admin && (
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => run(() => deleteTransfer(t.id))}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
        )}
      </div>

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

/** Purchaser: request a transfer of one or more items into the Office. */
function RequestOfficeForm({ stockOptions }: { stockOptions: StockOption[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<{ itemId: string; qty: string }[]>([{ itemId: "", qty: "" }]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<{ itemId: string; qty: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { itemId: "", qty: "" }]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  async function submit() {
    const items = rows.map((r) => ({ stockItemId: r.itemId, qty: Number(r.qty) })).filter((r) => r.stockItemId && r.qty > 0);
    if (items.length === 0) { setErr("Add at least one item with a quantity."); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      await requestOfficeTransfer({ items, note: note.trim() || undefined });
      setRows([{ itemId: "", qty: "" }]); setNote("");
      setMsg(`Requested ${items.length} item${items.length === 1 ? "" : "s"} to Office — awaiting Plant Manager approval.`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to request");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-md border border-dashed p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Request transfer to Office</div>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const picked = stockOptions.find((s) => s.id === r.itemId);
          return (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground">
                {i === 0 ? "Item" : <span className="invisible">Item</span>}
                <select className="mt-0.5 block h-8 min-w-[16rem] rounded-md border bg-background px-2 text-sm" value={r.itemId} onChange={(e) => setRow(i, { itemId: e.target.value })}>
                  <option value="">— pick an item —</option>
                  {stockOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.location ? ` · ${s.location}` : ""} (avail {fmtQty(s.available)} {s.unit})</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">{i === 0 ? "Qty" : <span className="invisible">Qty</span>}<Input className="mt-0.5 h-8 w-24" type="number" step="any" min={0} placeholder="Qty" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} /></label>
              {picked && <span className="pb-1.5 text-[11px] text-muted-foreground">{picked.location || "—"} → Office</span>}
              {rows.length > 1 && (
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" title="Remove row" disabled={busy} onClick={() => removeRow(i)}><X className="h-4 w-4" /></Button>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={addRow}>+ Add item</Button>
        <label className="text-xs text-muted-foreground">Note<Input className="mt-0.5 h-8 w-40" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={submit}>{busy ? "Requesting…" : "Request"}</Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">From each item’s location → Office. Stock is deducted only when the Warehouse releases it. Each item becomes its own request.</p>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
      {msg && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">{msg}</p>}
    </div>
  );
}

export function StockTransfers({
  transfers, missing, admin = false, canRequest = false, stockOptions = [],
}: {
  transfers: StockTransferView[];
  missing?: boolean;
  admin?: boolean;
  canRequest?: boolean;
  stockOptions?: StockOption[];
}) {
  if (missing) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Stock transfers aren&rsquo;t set up yet — apply the <code className="rounded bg-muted px-1">0028_stock_transfer</code> migration to enable them.</p>;
  }
  const done = (t: StockTransferView) => t.status === "RECEIVED" || t.status === "CANCELLED";
  const active = transfers.filter((t) => !done(t));
  const past = transfers.filter(done);
  const renderRow = (t: StockTransferView) => (t.isOffice ? <OfficeTransferRow key={t.id} t={t} admin={admin} /> : <TransferRow key={t.id} t={t} admin={admin} />);
  return (
    <div className="space-y-3">
      {canRequest && <RequestOfficeForm stockOptions={stockOptions} />}
      {transfers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stock transfers yet. Use an item&rsquo;s <span className="font-medium">Transfer</span> button to send stock to another location{canRequest ? ", or request a transfer to the Office above" : ""}.</p>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">In progress ({active.length})</div>
              {active.map(renderRow)}
            </div>
          )}
          {past.length > 0 && (
            <details className="space-y-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completed &amp; cancelled ({past.length})</summary>
              <div className="mt-2 space-y-2">{past.map(renderRow)}</div>
            </details>
          )}
        </>
      )}
      <p className="text-[11px] text-muted-foreground">Office transfers run a 5-step chain: Purchaser requests → Plant Manager approves → Warehouse releases (stock deducted) → Logistics delivers → Sales confirms Office receipt (stock credited). Other location moves use the two-party (production head + purchaser) receipt.</p>
    </div>
  );
}
