"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Scale, Upload, Sparkles, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PurchaseReconcileView } from "@/lib/purchase-chain-row";
import type { SaleDoc } from "@/lib/sale";
import { AI_RECEIPT_READ_LIMIT } from "@/lib/ai/limits";
import { UploadLink } from "@/components/upload-link";
import { recordReconciliation, settleReconciliation, escalateReconciliation, approveReconciliation, escalateReconcileAiRead, resetReconcileAiRead, removeReconciliationReceipt, addReconciliationReceipt, replaceReconciliationReceipt } from "../orders/actions";

const VAT = 0.12;
// Auto-record threshold — mirrors balanceTolerance() on the server so an
// AI-read receipt that auto-records also reads as "balanced" (never as a
// discrepancy needing approval). Beyond this, a person reviews.
const balanceTolerance = (voucher: number) => Math.max(1, Math.round(Math.abs(voucher) * 0.0005 * 100) / 100);
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => Number(String(s ?? "").replace(/,/g, "").trim()) || 0;

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
  canEscalate = false,
  canApprove = false,
  readOnly = false,
  admin = false,
}: {
  prId: string;
  reconcile: PurchaseReconcileView;
  canRecord: boolean;
  canSettle: boolean;
  canEscalate?: boolean;
  canApprove?: boolean;
  readOnly?: boolean;
  admin?: boolean;
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
  // AI read-receipt results (info + warnings shown under the table).
  const [aiInfo, setAiInfo] = useState<string | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  // AI reads are capped per voucher — after the limit, figures go in by hand.
  const [reads, setReads] = useState(reconcile.aiReads);
  const readsLeft = Math.max(0, AI_RECEIPT_READ_LIMIT - reads);
  const limitReached = readsLeft <= 0;
  // The receipt must be AI-read before a manual record is allowed — unless the AI
  // read limit is reached, or the approver/admin (who can always record/correct).
  const [hasAiRead, setHasAiRead] = useState(false);
  const canManualRecord = hasAiRead || limitReached || canApprove;

  const factor = vatMode === "exclusive" ? 1 + VAT : 1;
  const preview = useMemo(() => {
    const voucher = round2(rows.reduce((a, r) => a + r.poAmount, 0) * factor);
    const actual = round2(rows.reduce((a, r) => a + num(r.actual), 0));
    return { voucher, actual, variance: round2(voucher - actual) };
  }, [rows, factor]);

  function startEdit() {
    setRows(seed()); setVatMode(reconcile.vatMode); setNote(""); setReceipts([]); setErr(null); setHasAiRead(false); setOpen(true);
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

  // Admin management of the RECORDED receipts (add / replace / delete in place).
  async function uploadRaw(file: File): Promise<SaleDoc> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("purchaseRequestId", prId);
    const res = await fetch("/api/purchase-uploads", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data as SaleDoc;
  }
  async function addRecordedReceipt(file: File) {
    setBusy("addrcpt"); setErr(null);
    try { await addReconciliationReceipt(prId, await uploadRaw(file)); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to add receipt"); }
    finally { setBusy(null); }
  }
  async function replaceRecordedReceipt(oldPath: string, file: File) {
    setBusy(`rp-${oldPath}`); setErr(null);
    try { await replaceReconciliationReceipt(prId, oldPath, await uploadRaw(file)); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to replace receipt"); }
    finally { setBusy(null); }
  }

  // Persist a reconciliation (shared by the manual "Record" button and the
  // fully-automatic path). Returns true on success.
  async function submitRecord(vatModeArg: "inclusive" | "exclusive", rowsArg: typeof rows, noteArg: string, aiVerified: boolean): Promise<boolean> {
    try {
      await recordReconciliation(prId, {
        vatMode: vatModeArg,
        lines: rowsArg.map((r) => ({ description: r.description, qty: r.qty, poAmount: r.poAmount, actualAmount: num(r.actual) })),
        receipts,
        note: noteArg,
        aiVerified,
      });
      setOpen(false); setReceipts([]); setNote("");
      router.refresh();
      return true;
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); return false; }
  }

  // Read the uploaded receipt image(s)/PDF(s) with AI, auto-fill the per-line
  // actuals, and — when every line matched and the total tallies within a small
  // tolerance — record it automatically. Otherwise leave it for a human to
  // review (the only time a person is needed is when it doesn't balance).
  async function autoRead() {
    if (receipts.length === 0) { setErr("Upload the receipt first."); return; }
    if (limitReached) { setErr(`AI read limit reached (${AI_RECEIPT_READ_LIMIT} of ${AI_RECEIPT_READ_LIMIT} used). Check the receipt and enter the figures manually.`); return; }
    setBusy("read"); setErr(null); setAiInfo(null); setAiWarnings([]);
    try {
      const res = await fetch("/api/ai/read-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseRequestId: prId, paths: receipts.map((r) => r.path) }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Limit hit: lock the button and show the notification (not a hard error).
        if (data.limitReached) { setReads(typeof data.reads === "number" ? data.reads : AI_RECEIPT_READ_LIMIT); setAiInfo(null); setAiWarnings([data.error]); return; }
        throw new Error(data.error || "Could not read the receipt.");
      }
      if (typeof data.reads === "number") setReads(data.reads);
      setHasAiRead(true); // the receipt has now been read by AI — allow recording

      const vatUsed: "inclusive" | "exclusive" = data.vatMode === "exclusive" ? "exclusive" : data.vatMode === "inclusive" ? "inclusive" : vatMode;
      const newRows = rows.map((r, i) => {
        const l = data.lines?.[i];
        return l && typeof l.actualAmount === "number" ? { ...r, actual: String(l.actualAmount) } : r;
      });
      setRows(newRows);
      setVatMode(vatUsed);

      const warns = Array.isArray(data.warnings) ? [...data.warnings] : [];
      const unmatched = (data.lines ?? []).filter((l: { actualAmount: number | null }) => l.actualAmount === null).length;
      if (unmatched > 0) warns.push(`${unmatched} PO line${unmatched === 1 ? "" : "s"} not found on the receipt — enter ${unmatched === 1 ? "it" : "them"} manually.`);
      if (Array.isArray(data.extraItems) && data.extraItems.length) warns.push(`${data.extraItems.length} receipt item(s) not on the PO: ${data.extraItems.map((e: { description: string }) => e.description).filter(Boolean).join(", ")}.`);

      // Tally check for auto-record.
      const f = vatUsed === "exclusive" ? 1 + VAT : 1;
      const allMatched = newRows.every((r) => r.actual.trim() !== "");
      const voucher = round2(newRows.reduce((a, r) => a + r.poAmount, 0) * f);
      const actual = round2(newRows.reduce((a, r) => a + num(r.actual), 0));
      const variance = round2(voucher - actual);
      const tolerance = balanceTolerance(voucher);

      if (allMatched && Math.abs(variance) <= tolerance) {
        // Fully automatic — no human needed. Record it straight away.
        setBusy("record");
        const okNote = `Auto-reconciled from receipt (AI)${note ? ` · ${note}` : ""}`;
        await submitRecord(vatUsed, newRows, okNote, true);
        return;
      }

      // Needs a human: doesn't balance, or a line couldn't be matched.
      const bits = [
        data.supplier ? `Supplier: ${data.supplier}` : "",
        typeof data.receiptTotal === "number" ? `Receipt total: ₱${new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2 }).format(data.receiptTotal)}` : "",
      ].filter(Boolean);
      warns.unshift(
        !allMatched
          ? "Some lines couldn't be read — please review and complete before recording."
          : `Doesn't balance (${variance > 0 ? "change" : "over"} ${peso(Math.abs(variance))}) — please review before recording.`,
      );
      setAiInfo(bits.length ? `Read ✓ · ${bits.join(" · ")}` : "Receipt read.");
      setAiWarnings(warns);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function record() {
    if (!canManualRecord) { setErr("Read the receipt with AI first — manual entry is only allowed once the AI read limit is reached or an approver allows it."); return; }
    setBusy("record"); setErr(null);
    // Manual record: figures typed by hand — NOT verified against the receipt image.
    await submitRecord(vatMode, rows, note, false);
    setBusy(null);
  }

  async function settle() {
    const n = window.prompt("Note (optional) — e.g. change returned to accounting, overspend reimbursed:", "") ?? undefined;
    setBusy("settle"); setErr(null);
    try { await settleReconciliation(prId, n); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function escalate() {
    const n = window.prompt("Message to the approver (optional) — explain the discrepancy:", "") ?? undefined;
    setBusy("escalate"); setErr(null);
    try { await escalateReconciliation(prId, n); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function approve() {
    const n = window.prompt("Approval note (optional):", "") ?? undefined;
    setBusy("approve"); setErr(null);
    try { await approveReconciliation(prId, n); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function notifyAiLimit() {
    const n = window.prompt("Message to the admin/approver (optional) — the AI receipt-read limit was reached:", "") ?? undefined;
    setBusy("ai-escalate"); setErr(null);
    try { await escalateReconcileAiRead(prId, n); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function allowMoreAiReads() {
    setBusy("ai-reset"); setErr(null);
    try { await resetReconcileAiRead(prId); setReads(0); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  const verdict = (status: PurchaseReconcileView["status"], variance: number) => {
    if (status === "balanced") {
      // Only claim the receipt matches when the figures were actually read from
      // the uploaded receipt by the AI. A manual record only tallies the typed
      // figures against the PO — it does NOT prove they match the uploaded document.
      return reconcile.aiVerified
        ? <span className="font-semibold text-emerald-700">Tallied ✓ — voucher matches the receipt (AI-read)</span>
        : <span className="font-semibold text-amber-700">Figures tally ✓ — recorded manually; not verified against the uploaded receipt</span>;
    }
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

      {/* AI read-limit notice — Accounting informs the admin/approver, who may
          bypass (allow more reads) or the figures go in manually. */}
      {!readOnly && limitReached && (
        <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5">
          <p className="text-xs font-medium text-destructive">
            AI read limit reached ({AI_RECEIPT_READ_LIMIT} of {AI_RECEIPT_READ_LIMIT} used). Check the receipt and enter the figures manually — or ask the admin/approver to allow more reads.
          </p>
          {reconcile.aiReadEscalated ? (
            <p className="text-xs text-amber-700">Sent to the admin/approver — {reconcile.aiReadEscalated}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {!reconcile.aiReadEscalated && canEscalate && !canApprove && (
              <button type="button" onClick={notifyAiLimit} disabled={busy === "ai-escalate"}
                className="rounded border border-amber-600/50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-600/10">
                {busy === "ai-escalate" ? "…" : "Notify admin/approver"}
              </button>
            )}
            {canApprove && (
              <button type="button" onClick={allowMoreAiReads} disabled={busy === "ai-reset"}
                className="rounded border border-primary/50 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/10">
                {busy === "ai-reset" ? "…" : `Allow ${AI_RECEIPT_READ_LIMIT} more AI reads (bypass)`}
              </button>
            )}
          </div>
        </div>
      )}

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
          {reconcile.status === "balanced" && !reconcile.aiVerified && (
            <p className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-xs text-amber-700">
              ⚠ Recorded by hand — the system only checked the typed figures against the PO, not the uploaded receipt.
              Open the receipt above and confirm it actually matches before relying on this tally.
            </p>
          )}
          {(reconcile.receipts.length > 0 || admin) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Receipts:</span>
              {reconcile.receipts.map((f) => (
                <span key={f.path} className="inline-flex items-center gap-1">
                  <UploadLink
                    doc={f}
                    base="/api/purchase-uploads"
                    size="xs"
                    busy={busy === `rm-${f.path}`}
                    onRemove={admin ? async () => {
                      if (!window.confirm(`Remove receipt "${f.name}"?`)) return;
                      setBusy(`rm-${f.path}`); setErr(null);
                      try { await removeReconciliationReceipt(prId, f.path); router.refresh(); }
                      catch (e) { setErr(e instanceof Error ? e.message : "Failed to remove"); }
                      finally { setBusy(null); }
                    } : undefined}
                  />
                  {admin && (
                    <label className="cursor-pointer text-muted-foreground hover:text-primary" title="Replace / modify" aria-label="Replace">
                      <Pencil className="h-3.5 w-3.5" />
                      <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy != null} onChange={(e) => e.target.files?.[0] && replaceRecordedReceipt(f.path, e.target.files[0])} />
                    </label>
                  )}
                </span>
              ))}
              {admin && (
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 font-medium hover:bg-accent">
                  <Upload className="h-3.5 w-3.5" /> {busy === "addrcpt" ? "Uploading…" : "Add receipt"}
                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy != null} onChange={(e) => e.target.files?.[0] && addRecordedReceipt(e.target.files[0])} />
                </label>
              )}
            </div>
          )}
          {reconcile.note && <p className="text-xs text-muted-foreground">Note: {reconcile.note}</p>}
          {reconcile.recorded && <p className="text-xs text-muted-foreground">Reconciled by {reconcile.recorded}</p>}
          {/* Discrepancy authorisation flow — only when it doesn't balance. */}
          {reconcile.status !== "balanced" ? (
            <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
              {reconcile.approved ? (
                <>
                  <p className="text-xs text-emerald-700">✓ Discrepancy approved — {reconcile.approved}</p>
                  {reconcile.settled ? (
                    <p className="text-xs text-emerald-700">✓ Settled — {reconcile.settled}</p>
                  ) : !readOnly && canSettle ? (
                    <button type="button" onClick={settle} disabled={busy === "settle"}
                      className="rounded border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/10">
                      {busy === "settle" ? "…" : reconcile.status === "change" ? "Mark change returned" : "Mark overspend settled"}
                    </button>
                  ) : null}
                </>
              ) : reconcile.escalated ? (
                <>
                  <p className="text-xs text-amber-700">Discrepancy sent to the approver — {reconcile.escalated}</p>
                  {!readOnly && canApprove ? (
                    <button type="button" onClick={approve} disabled={busy === "approve"}
                      className="rounded border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/10">
                      {busy === "approve" ? "…" : "Approve discrepancy"}
                    </button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Awaiting the Approver&rsquo;s decision — the approver may approve or edit the figures.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-amber-700">This voucher doesn&rsquo;t balance — it needs the Approver&rsquo;s authorisation.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {!readOnly && canEscalate && (
                      <button type="button" onClick={escalate} disabled={busy === "escalate"}
                        className="rounded border border-amber-600/50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-600/10">
                        {busy === "escalate" ? "…" : "Notify approver of discrepancy"}
                      </button>
                    )}
                    {!readOnly && canApprove && (
                      <button type="button" onClick={approve} disabled={busy === "approve"}
                        className="rounded border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/10">
                        {busy === "approve" ? "…" : "Approve discrepancy"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : reconcile.settled ? (
            <p className="text-xs text-emerald-700">✓ Settled — {reconcile.settled}</p>
          ) : null}
          {!readOnly && canRecord && !open && (
            <button type="button" onClick={startEdit} className="text-xs font-medium text-muted-foreground hover:text-foreground">
              {reconcile.status === "balanced" ? "Correct figures" : "Edit figures"}
            </button>
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
              <UploadLink
                key={f.path}
                doc={f}
                base="/api/purchase-uploads"
                size="xs"
                onRemove={() => setReceipts((rs) => rs.filter((x) => x.path !== f.path))}
              />
            ))}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 font-medium hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> {busy === "upload" ? "Uploading…" : receipts.length ? "Add receipt" : "Upload receipt"}
              <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy === "upload"} onChange={(e) => e.target.files?.[0] && uploadReceipt(e.target.files[0])} />
            </label>
            {receipts.length > 0 && (
              <button type="button" onClick={autoRead} disabled={busy === "read" || limitReached}
                className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/5 px-2.5 py-1 font-semibold text-primary hover:bg-primary/10 disabled:opacity-60">
                <Sparkles className="h-3.5 w-3.5" /> {busy === "read" ? "Reading…" : limitReached ? "AI limit reached" : `Auto-read receipt${reads > 0 ? ` (${readsLeft} left)` : ""}`}
              </button>
            )}
          </div>
          {aiInfo && <p className="text-xs text-emerald-700">{aiInfo}</p>}
          {aiWarnings.length > 0 && (
            <ul className="space-y-0.5 text-xs text-amber-700">
              {aiWarnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
          {limitReached ? (
            <p className="text-xs font-medium text-destructive">AI read limit reached — check the receipt and enter the figures manually (see the notice above), or ask the admin/approver to allow more reads.</p>
          ) : reads > 0 ? (
            <p className="text-xs text-muted-foreground">AI reads left: {readsLeft} of {AI_RECEIPT_READ_LIMIT}.</p>
          ) : null}
          <Input className="h-8" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
          {!canManualRecord && (
            <p className="text-xs text-muted-foreground">
              Use <span className="font-medium">Auto-read receipt</span> to record. Manual entry unlocks after the AI read limit is reached or an approver allows it.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" disabled={busy === "record" || !canManualRecord} onClick={record}>{busy === "record" ? "Saving…" : "Record & tally"}</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
