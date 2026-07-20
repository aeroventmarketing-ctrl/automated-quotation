"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Scale, Upload, FileText, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PurchaseReconcileView } from "@/lib/purchase-chain-row";
import type { SaleDoc } from "@/lib/sale";
import { recordReconciliation, settleReconciliation } from "../orders/actions";

const VAT = 0.12;
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => Number(String(s ?? "").replace(/,/g, "").trim()) || 0;
const link = (path: string) => `/api/purchase-uploads?path=${encodeURIComponent(path)}`;
const dl = (path: string, name: string) => `${link(path)}&download=1&name=${encodeURIComponent(name)}`;

/**
 * Voucher reconciliation panel: a per-line tally of the actual amount paid vs
 * the PO (issued voucher), with a VAT-inclusive / VAT-exclusive toggle, so
 * accounting doesn't check each voucher and receipt by hand. The purchaser
 * records the per-line spend + uploads receipts; accounting or the purchaser
 * settle any change. `prId` is the request (or anchor) to act on. Read-only on
 * the order page.
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
  const recorded = reconcile.lines !== null;
  const [open, setOpen] = useState(false);
  const [vatMode, setVatMode] = useState<"inclusive" | "exclusive">(reconcile.vatMode);
  // Editable per-line actuals, seeded from the PO lines (or the recorded ones).
  const seed = () =>
    (reconcile.lines ?? reconcile.poLines.map((l) => ({ description: l.description, qty: l.qty, poAmount: l.poAmount, actualAmount: 0 }))).map((l) => ({
      description: l.description,
      qty: l.qty,
      poAmount: l.poAmount,
      actual: l.actualAmount ? String(l.actualAmount) : "",
    }));
  const [rows, setRows] = useState(seed);
  const [note, setNote] = useState("");
  const [receipts, setReceipts] = useState<SaleDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const factor = vatMode === "exclusive" ? 1 + VAT : 1;
  const preview = useMemo(() => {
    const voucher = round2(rows.reduce((a, r) => a + r.poAmount, 0) * factor);
    const actual = round2(rows.reduce((a, r) => a + num(r.actual), 0));
    return { voucher, actual, variance: round2(voucher - actual) };
  }, [rows, factor]);

  function startEdit() {
    setRows(seed()); setVatMode(reconcile.vatMode); setNote(""); setReceipts([]); setErr(null); setOpen(true);
  }
  function setActual(i: number, v: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, actual: v } : r)));
  }

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
    setBusy("record"); setErr(null);
    try {
      await recordReconciliation(prId, {
        vatMode,
        lines: rows.map((r) => ({ description: r.description, qty: r.qty, poAmount: r.poAmount, actualAmount: num(r.actual) })),
        receipts,
        note,
      });
      setOpen(false); setReceipts([]); setNote("");
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function settle() {
    const n = window.prompt("Note (optional) — e.g. change returned to accounting, overspend reimbursed:", "") ?? undefined;
    setBusy("settle"); setErr(null);
    try { await settleReconciliation(prId, n); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  const verdict = (status: PurchaseReconcileView["status"], variance: number) => {
    if (status === "balanced") return <span className="font-semibold text-emerald-700">Tallied ✓ — voucher matches receipts</span>;
    if (status === "change") return <span className="font-semibold text-amber-700">Change to return: {peso(variance)}</span>;
    if (status === "over") return <span className="font-semibold text-destructive">Over voucher by {peso(-variance)}</span>;
    return null;
  };

  if (readOnly && !recorded) return null;

  return (
    <div className="mt-2 space-y-2 rounded-md border p-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Scale className="h-3.5 w-3.5" /> Voucher reconciliation
        <span className="ml-1 font-normal normal-case">· VAT {reconcile.vatMode === "exclusive" ? "exclusive (+12%)" : "inclusive"}</span>
      </div>

      {recorded && reconcile.lines && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Item</th>
                <th className="w-24 py-1 px-1 text-right font-medium">PO / voucher</th>
                <th className="w-24 py-1 px-1 text-right font-medium">Actual</th>
                <th className="w-24 py-1 px-1 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              {reconcile.lines.map((l, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1 pr-2">{l.description || <span className="text-muted-foreground">Line {i + 1}</span>}{l.qty ? <span className="text-muted-foreground"> · {l.qty}</span> : null}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{peso(l.expected)}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{peso(l.actualAmount)}</td>
                  <td className={`py-1 px-1 text-right tabular-nums ${Math.abs(l.variance) < 0.005 ? "text-emerald-700" : l.variance > 0 ? "text-amber-700" : "text-destructive"}`}>
                    {Math.abs(l.variance) < 0.005 ? "✓" : (l.variance > 0 ? "" : "-") + peso(Math.abs(l.variance))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 px-1 text-right tabular-nums">{peso(reconcile.voucherAmount)}</td>
                <td className="py-1 px-1 text-right tabular-nums">{peso(reconcile.actualSpent ?? 0)}</td>
                <td className="py-1 px-1 text-right tabular-nums">{Math.abs(reconcile.variance) < 0.005 ? "✓" : (reconcile.variance > 0 ? "" : "-") + peso(Math.abs(reconcile.variance))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {recorded ? (
        <>
          <div className="text-sm">{verdict(reconcile.status, reconcile.variance)}</div>
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
            <button type="button" onClick={startEdit} className="ml-3 text-xs font-medium text-muted-foreground hover:text-foreground">Correct figures</button>
          )}
        </>
      ) : !readOnly && canRecord && !open ? (
        <div className="text-sm">
          <p className="text-muted-foreground">Voucher (PO total): <span className="font-medium text-foreground tabular-nums">{peso(reconcile.voucherAmount)}</span></p>
          <button type="button" onClick={startEdit}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-accent">
            <Scale className="h-3.5 w-3.5" /> Reconcile voucher (per-line spend &amp; receipts)
          </button>
        </div>
      ) : !recorded && !readOnly ? (
        <p className="text-xs text-muted-foreground">Voucher (PO total): {peso(reconcile.voucherAmount)} · awaiting the Purchaser to record the actual spend.</p>
      ) : null}

      {/* Record / correct form */}
      {!readOnly && canRecord && open && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Payment is</span>
            <select value={vatMode} onChange={(e) => setVatMode(e.target.value as "inclusive" | "exclusive")}
              className="h-7 rounded-md border bg-background px-2 text-xs">
              <option value="inclusive">VAT inclusive</option>
              <option value="exclusive">VAT exclusive (+12%)</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] border-collapse text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Item</th>
                  <th className="w-24 py-1 px-1 text-right font-medium">PO / voucher</th>
                  <th className="w-28 py-1 px-1 text-right font-medium">Actual paid</th>
                  <th className="w-20 py-1 px-1 text-right font-medium">Diff.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const expected = round2(r.poAmount * factor);
                  const diff = round2(expected - num(r.actual));
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2">{r.description || `Line ${i + 1}`}{r.qty ? <span className="text-muted-foreground"> · {r.qty}</span> : null}</td>
                      <td className="py-1 px-1 text-right tabular-nums text-muted-foreground">{peso(expected)}</td>
                      <td className="py-1 px-1"><Input className="h-7 text-right text-xs" value={r.actual} onChange={(e) => setActual(i, e.target.value)} placeholder="0.00" /></td>
                      <td className={`py-1 px-1 text-right tabular-nums ${r.actual.trim() === "" ? "text-muted-foreground" : Math.abs(diff) < 0.005 ? "text-emerald-700" : diff > 0 ? "text-amber-700" : "text-destructive"}`}>
                        {r.actual.trim() === "" ? "—" : Math.abs(diff) < 0.005 ? "✓" : (diff > 0 ? "" : "-") + peso(Math.abs(diff))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="py-1 pr-2">Total</td>
                  <td className="py-1 px-1 text-right tabular-nums">{peso(preview.voucher)}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{peso(preview.actual)}</td>
                  <td className={`py-1 px-1 text-right tabular-nums ${Math.abs(preview.variance) < 0.005 ? "text-emerald-700" : preview.variance > 0 ? "text-amber-700" : "text-destructive"}`}>
                    {Math.abs(preview.variance) < 0.005 ? "✓" : (preview.variance > 0 ? "" : "-") + peso(Math.abs(preview.variance))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs">
            {Math.abs(preview.variance) < 0.005 ? <span className="font-medium text-emerald-700">Tallies ✓</span>
              : preview.variance > 0 ? <span className="font-medium text-amber-700">Change to return: {peso(preview.variance)}</span>
              : <span className="font-medium text-destructive">Over voucher by {peso(-preview.variance)}</span>}
          </p>
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
