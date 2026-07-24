"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Scale, Upload, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CashLiquidationView } from "@/lib/cash-request-row";
import type { SaleDoc } from "@/lib/sale";
import { AI_RECEIPT_READ_LIMIT } from "@/lib/ai/limits";
import { UploadLink } from "@/components/upload-link";
import { recordCashLiquidation, settleCashLiquidation, escalateCashLiquidation, approveCashLiquidation, escalateCashAiRead, resetCashAiRead, removeCashLiquidationReceipt } from "./actions";

// Mirrors balanceTolerance() on the server so an AI-read receipt that tallies
// within a small margin reads as "balanced", not a discrepancy.
const balanceTolerance = (released: number) => Math.max(1, Math.round(Math.abs(released) * 0.0005 * 100) / 100);
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => Number(String(s ?? "").replace(/,/g, "").trim()) || 0;

interface Row { description: string; budgetAmount: number; actual: string }

/**
 * Liquidation panel for a cash request: a per-line tally of the actual amount
 * spent vs each planned (budget) line, with the whole liquidation checked
 * against the cash released (change to return / overspend). The requestor
 * records the per-line spend + uploads receipts; AI can read the receipt and
 * fill the actuals. A discrepancy is escalated to the approver, who authorises
 * it before accounting settles it.
 */
export function CashLiquidationPanel({
  id,
  released,
  liquidation,
  canRecord,
  canSettle,
  canEscalate,
  canApprove,
  admin = false,
}: {
  id: string;
  released: number;
  liquidation: CashLiquidationView;
  canRecord: boolean;
  canSettle: boolean;
  canEscalate: boolean;
  canApprove: boolean;
  admin?: boolean;
}) {
  const router = useRouter();
  const recorded = liquidation.lines !== null;
  const [open, setOpen] = useState(false);
  // Editable per-line actuals, seeded from the recorded lines or the budget lines.
  const seed = (): Row[] =>
    (liquidation.lines ?? liquidation.budgetLines.map((l) => ({ description: l.description, budgetAmount: l.budgetAmount, actualAmount: 0 }))).map((l) => ({
      description: l.description,
      budgetAmount: l.budgetAmount,
      actual: l.actualAmount ? String(l.actualAmount) : "",
    }));
  const [rows, setRows] = useState<Row[]>(seed);
  const [note, setNote] = useState("");
  const [receipts, setReceipts] = useState<SaleDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiInfo, setAiInfo] = useState<string | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  // AI reads are capped per liquidation — after the limit, figures go in by hand.
  const [reads, setReads] = useState(liquidation.aiReads);
  const readsLeft = Math.max(0, AI_RECEIPT_READ_LIMIT - reads);
  const limitReached = readsLeft <= 0;
  // The receipt must be AI-read before a manual record is allowed — unless the AI
  // read limit is reached, or an approver/admin (who can always record/correct).
  const [hasAiRead, setHasAiRead] = useState(false);
  const canManualRecord = hasAiRead || limitReached || canApprove;

  const preview = useMemo(() => {
    const budget = round2(rows.reduce((a, r) => a + r.budgetAmount, 0));
    const actual = round2(rows.reduce((a, r) => a + num(r.actual), 0));
    return { budget, actual, variance: round2(released - actual) };
  }, [rows, released]);

  function startEdit() {
    setRows(seed()); setNote(""); setReceipts([]); setErr(null); setAiInfo(null); setAiWarnings([]); setHasAiRead(false); setOpen(true);
  }
  function setActual(i: number, v: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, actual: v } : r)));
  }

  async function uploadReceipt(file: File) {
    setBusy("upload"); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("cashRequestId", id);
      const res = await fetch("/api/cash-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setReceipts((rs) => [...rs, data as SaleDoc]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(null); }
  }

  async function submitRecord(rowsArg: Row[], noteArg: string, aiVerified: boolean): Promise<boolean> {
    try {
      await recordCashLiquidation(id, {
        lines: rowsArg.map((r) => ({ description: r.description, budgetAmount: r.budgetAmount, actualAmount: r.actual })),
        receipts,
        note: noteArg,
        aiVerified,
      });
      setOpen(false); setReceipts([]); setNote("");
      router.refresh();
      return true;
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); return false; }
  }

  async function autoRead() {
    if (receipts.length === 0) { setErr("Upload the receipt first."); return; }
    if (limitReached) { setErr(`AI read limit reached (${AI_RECEIPT_READ_LIMIT} of ${AI_RECEIPT_READ_LIMIT} used). Check the receipt and enter the figures manually.`); return; }
    setBusy("read"); setErr(null); setAiInfo(null); setAiWarnings([]);
    try {
      const res = await fetch("/api/ai/read-cash-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashRequestId: id, paths: receipts.map((r) => r.path), lines: rows.map((r) => ({ description: r.description, budgetAmount: r.budgetAmount })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.limitReached) { setReads(typeof data.reads === "number" ? data.reads : AI_RECEIPT_READ_LIMIT); setAiInfo(null); setAiWarnings([data.error]); return; }
        throw new Error(data.error || "Could not read the receipt.");
      }
      if (typeof data.reads === "number") setReads(data.reads);
      setHasAiRead(true); // the receipt has now been read by AI — allow recording

      const newRows = rows.map((r, i) => {
        const l = data.lines?.[i];
        return l && typeof l.actualAmount === "number" ? { ...r, actual: String(l.actualAmount) } : r;
      });
      setRows(newRows);

      const warns = Array.isArray(data.warnings) ? [...data.warnings] : [];
      const unmatched = (data.lines ?? []).filter((l: { actualAmount: number | null }) => l.actualAmount === null).length;
      if (unmatched > 0) warns.push(`${unmatched} line${unmatched === 1 ? "" : "s"} not found on the receipt — enter ${unmatched === 1 ? "it" : "them"} manually.`);
      if (Array.isArray(data.extraItems) && data.extraItems.length) warns.push(`${data.extraItems.length} receipt item(s) not on the breakdown: ${data.extraItems.map((e: { description: string }) => e.description).filter(Boolean).join(", ")}.`);

      const allMatched = newRows.every((r) => r.actual.trim() !== "");
      const actual = round2(newRows.reduce((a, r) => a + num(r.actual), 0));
      const variance = round2(released - actual);
      const tolerance = balanceTolerance(released);

      if (allMatched && Math.abs(variance) <= tolerance) {
        setBusy("record");
        await submitRecord(newRows, `Auto-liquidated from receipt (AI)${note ? ` · ${note}` : ""}`, true);
        return;
      }
      const bits = [
        data.supplier ? `Supplier: ${data.supplier}` : "",
        typeof data.receiptTotal === "number" ? `Receipt total: ${peso(data.receiptTotal)}` : "",
      ].filter(Boolean);
      warns.unshift(
        !allMatched
          ? "Some lines couldn't be read — review and complete before recording."
          : `Doesn't balance (${variance > 0 ? "change" : "over"} ${peso(Math.abs(variance))}) — review before recording.`,
      );
      setAiInfo(bits.length ? `Read ✓ · ${bits.join(" · ")}` : "Receipt read.");
      setAiWarnings(warns);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function record() {
    if (rows.every((r) => r.actual.trim() === "")) { setErr("Enter the amount spent on at least one line."); return; }
    if (!canManualRecord) { setErr("Read the receipt with AI first — manual entry is only allowed once the AI read limit is reached or an approver allows it."); return; }
    setBusy("record"); setErr(null);
    // Manual record: figures typed/reviewed by hand — not auto-verified against the receipt.
    await submitRecord(rows, note, false);
    setBusy(null);
  }

  async function act(fn: (id: string, note?: string) => Promise<void>, kind: string, promptMsg: string) {
    const n = window.prompt(promptMsg, "") ?? undefined;
    setBusy(kind); setErr(null);
    try { await fn(id, n); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function allowMoreAiReads() {
    setBusy("ai-reset"); setErr(null);
    try { await resetCashAiRead(id); setReads(0); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  const verdict = (status: CashLiquidationView["status"], variance: number) => {
    if (status === "balanced") {
      // Only claim the receipt matches when the figures were AI-read from it; a
      // manual record only tallies the typed figures against the cash released.
      return liquidation.aiVerified
        ? <span className="font-semibold text-emerald-700">Tallied ✓ — spend matches the receipt (AI-read)</span>
        : <span className="font-semibold text-amber-700">Figures tally ✓ — recorded manually; not verified against the uploaded receipt</span>;
    }
    if (status === "change") return <span className="font-semibold text-amber-700">Change to return: {peso(variance)}</span>;
    if (status === "over") return <span className="font-semibold text-destructive">Over the cash released by {peso(-variance)}</span>;
    return null;
  };

  return (
    <div className="mt-2 space-y-2 rounded-md border p-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Scale className="h-3.5 w-3.5" /> Liquidation
        <span className="ml-1 font-normal normal-case">· cash released {peso(released)}</span>
      </div>

      {/* AI read-limit notice — the requestor/Accounting informs the admin/
          approver, who may bypass (allow more reads) or the figures go in manually. */}
      {limitReached && (
        <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5">
          <p className="text-xs font-medium text-destructive">
            AI read limit reached ({AI_RECEIPT_READ_LIMIT} of {AI_RECEIPT_READ_LIMIT} used). Check the receipt and enter the figures manually — or ask the admin/approver to allow more reads.
          </p>
          {liquidation.aiReadEscalated ? (
            <p className="text-xs text-amber-700">Sent to the admin/approver — {liquidation.aiReadEscalated}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {!liquidation.aiReadEscalated && canEscalate && !canApprove && (
              <button type="button" onClick={() => act(escalateCashAiRead, "ai-escalate", "Message to the admin/approver (optional) — the AI receipt-read limit was reached:")} disabled={busy === "ai-escalate"}
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

      {recorded && liquidation.lines && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Line</th>
                <th className="w-24 py-1 px-1 text-right font-medium">Planned</th>
                <th className="w-24 py-1 px-1 text-right font-medium">Actual</th>
                <th className="w-24 py-1 px-1 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              {liquidation.lines.map((l, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1 pr-2">{l.description || <span className="text-muted-foreground">Line {i + 1}</span>}</td>
                  <td className="py-1 px-1 text-right tabular-nums text-muted-foreground">{peso(l.budgetAmount)}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{peso(l.actualAmount)}</td>
                  <td className={`py-1 px-1 text-right tabular-nums ${Math.abs(l.variance) < 0.005 ? "text-emerald-700" : l.variance > 0 ? "text-amber-700" : "text-destructive"}`}>
                    {Math.abs(l.variance) < 0.005 ? "✓" : (l.variance > 0 ? "" : "-") + peso(Math.abs(l.variance))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td className="py-1 pr-2">Cash released / spent</td>
                <td className="py-1 px-1 text-right tabular-nums">{peso(liquidation.released)}</td>
                <td className="py-1 px-1 text-right tabular-nums">{peso(liquidation.spent ?? 0)}</td>
                <td className={`py-1 px-1 text-right tabular-nums ${Math.abs(liquidation.variance) < 0.005 ? "text-emerald-700" : liquidation.variance > 0 ? "text-amber-700" : "text-destructive"}`}>
                  {Math.abs(liquidation.variance) < 0.005 ? "✓" : (liquidation.variance > 0 ? "" : "-") + peso(Math.abs(liquidation.variance))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {recorded ? (
        <>
          <div className="text-sm">{verdict(liquidation.status, liquidation.variance)}</div>
          {liquidation.status === "balanced" && !liquidation.aiVerified && (
            <p className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-xs text-amber-700">
              ⚠ Recorded by hand — the system only checked the typed figures against the cash released, not the uploaded receipt.
              Open the receipt above and confirm it actually matches before relying on this tally.
            </p>
          )}
          {liquidation.receipts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Receipts:</span>
              {liquidation.receipts.map((f) => (
                <UploadLink
                  key={f.path}
                  doc={f}
                  base="/api/cash-uploads"
                  size="xs"
                  busy={busy === `rm-${f.path}`}
                  onRemove={admin ? async () => {
                    if (!window.confirm(`Remove receipt "${f.name}"?`)) return;
                    setBusy(`rm-${f.path}`); setErr(null);
                    try { await removeCashLiquidationReceipt(id, f.path); router.refresh(); }
                    catch (e) { setErr(e instanceof Error ? e.message : "Failed to remove"); }
                    finally { setBusy(null); }
                  } : undefined}
                />
              ))}
            </div>
          )}
          {liquidation.note && <p className="text-xs text-muted-foreground">Note: {liquidation.note}</p>}
          {liquidation.recorded && <p className="text-xs text-muted-foreground">Liquidated by {liquidation.recorded}</p>}

          {liquidation.status !== "balanced" ? (
            <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
              {liquidation.approved ? (
                <>
                  <p className="text-xs text-emerald-700">✓ Discrepancy approved — {liquidation.approved}</p>
                  {liquidation.settled ? (
                    <p className="text-xs text-emerald-700">✓ Settled — {liquidation.settled}</p>
                  ) : canSettle ? (
                    <button type="button" onClick={() => act(settleCashLiquidation, "settle", "Note (optional) — e.g. change returned, overspend reimbursed:")} disabled={busy === "settle"}
                      className="rounded border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/10">
                      {busy === "settle" ? "…" : liquidation.status === "change" ? "Mark change returned" : "Mark overspend reimbursed"}
                    </button>
                  ) : null}
                </>
              ) : liquidation.escalated ? (
                <>
                  <p className="text-xs text-amber-700">Discrepancy sent to the approver — {liquidation.escalated}</p>
                  {canApprove ? (
                    <button type="button" onClick={() => act(approveCashLiquidation, "approve", "Approval note (optional):")} disabled={busy === "approve"}
                      className="rounded border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/10">
                      {busy === "approve" ? "…" : "Approve discrepancy"}
                    </button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Awaiting the Approver&rsquo;s decision.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-amber-700">This liquidation doesn&rsquo;t balance — it needs the Approver&rsquo;s authorisation.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {canEscalate && (
                      <button type="button" onClick={() => act(escalateCashLiquidation, "escalate", "Message to the approver (optional) — explain the discrepancy:")} disabled={busy === "escalate"}
                        className="rounded border border-amber-600/50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-600/10">
                        {busy === "escalate" ? "…" : "Notify approver of discrepancy"}
                      </button>
                    )}
                    {canApprove && (
                      <button type="button" onClick={() => act(approveCashLiquidation, "approve", "Approval note (optional):")} disabled={busy === "approve"}
                        className="rounded border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/10">
                        {busy === "approve" ? "…" : "Approve discrepancy"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : liquidation.settled ? (
            <p className="text-xs text-emerald-700">✓ Settled — {liquidation.settled}</p>
          ) : canSettle ? (
            <button type="button" onClick={() => act(settleCashLiquidation, "settle", "Note (optional):")} disabled={busy === "settle"}
              className="rounded border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600/10">
              {busy === "settle" ? "…" : "Mark settled & close"}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">Tallied — awaiting Accounting to close it.</p>
          )}

          {canRecord && !open && (
            <button type="button" onClick={startEdit} className="text-xs font-medium text-muted-foreground hover:text-foreground">
              Edit liquidation
            </button>
          )}
        </>
      ) : canRecord && !open ? (
        <button type="button" onClick={startEdit}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-accent">
          <Scale className="h-3.5 w-3.5" /> Liquidate (per-line spend &amp; receipts)
        </button>
      ) : !recorded ? (
        <p className="text-xs text-muted-foreground">Awaiting the requestor to liquidate the cash.</p>
      ) : null}

      {canRecord && open && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] border-collapse text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Line</th>
                  <th className="w-24 py-1 px-1 text-right font-medium">Planned</th>
                  <th className="w-28 py-1 px-1 text-right font-medium">Actual spent</th>
                  <th className="w-20 py-1 px-1 text-right font-medium">Diff.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const diff = round2(r.budgetAmount - num(r.actual));
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2">{r.description || `Line ${i + 1}`}</td>
                      <td className="py-1 px-1 text-right tabular-nums text-muted-foreground">{peso(r.budgetAmount)}</td>
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
                  <td className="py-1 pr-2">Cash released / spent</td>
                  <td className="py-1 px-1 text-right tabular-nums text-muted-foreground">{peso(released)}</td>
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
              : <span className="font-medium text-destructive">Over the cash released by {peso(-preview.variance)}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">Receipts:</span>
            {receipts.map((f) => (
              <UploadLink
                key={f.path}
                doc={f}
                base="/api/cash-uploads"
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
