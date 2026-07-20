"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scale, Upload, FileText, Download, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CashLiquidationView } from "@/lib/cash-request-row";
import type { SaleDoc } from "@/lib/sale";
import { recordCashLiquidation, settleCashLiquidation, escalateCashLiquidation, approveCashLiquidation } from "./actions";

// Mirrors balanceTolerance() on the server so an AI-read receipt that tallies
// within a small margin reads as "balanced", not a discrepancy.
const balanceTolerance = (released: number) => Math.max(1, Math.round(Math.abs(released) * 0.0005 * 100) / 100);
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => Number(String(s ?? "").replace(/,/g, "").trim()) || 0;
const link = (path: string) => `/api/cash-uploads?path=${encodeURIComponent(path)}`;
const dl = (path: string, name: string) => `${link(path)}&download=1&name=${encodeURIComponent(name)}`;

/**
 * Liquidation panel for a cash request: the requestor records the actual amount
 * spent and uploads receipts; the system tallies it against the released cash
 * (change to return / overspend to reimburse). AI can read the receipt total.
 * A discrepancy is escalated to the approver, who authorises it before it's
 * settled by accounting.
 */
export function CashLiquidationPanel({
  id,
  released,
  liquidation,
  canRecord,
  canSettle,
  canEscalate,
  canApprove,
}: {
  id: string;
  released: number;
  liquidation: CashLiquidationView;
  canRecord: boolean;
  canSettle: boolean;
  canEscalate: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const recorded = liquidation.spent !== null;
  const [open, setOpen] = useState(false);
  const [spent, setSpent] = useState(liquidation.spent != null ? String(liquidation.spent) : "");
  const [note, setNote] = useState("");
  const [receipts, setReceipts] = useState<SaleDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiInfo, setAiInfo] = useState<string | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);

  const previewVar = round2(released - num(spent));

  function startEdit() {
    setSpent(liquidation.spent != null ? String(liquidation.spent) : "");
    setNote(""); setReceipts([]); setErr(null); setAiInfo(null); setAiWarnings([]); setOpen(true);
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

  async function submitRecord(spentArg: string, noteArg: string): Promise<boolean> {
    try {
      await recordCashLiquidation(id, { actualSpent: spentArg, receipts, note: noteArg });
      setOpen(false); setReceipts([]); setNote("");
      router.refresh();
      return true;
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); return false; }
  }

  async function autoRead() {
    if (receipts.length === 0) { setErr("Upload the receipt first."); return; }
    setBusy("read"); setErr(null); setAiInfo(null); setAiWarnings([]);
    try {
      const res = await fetch("/api/ai/read-cash-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashRequestId: id, paths: receipts.map((r) => r.path) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read the receipt.");

      const total = typeof data.receiptTotal === "number" ? data.receiptTotal : null;
      const warns = Array.isArray(data.warnings) ? [...data.warnings] : [];
      if (total == null) {
        warns.unshift("Couldn't read the total — enter it manually.");
        setAiWarnings(warns);
        return;
      }
      setSpent(String(total));

      const variance = round2(released - total);
      const tolerance = balanceTolerance(released);
      if (Math.abs(variance) <= tolerance) {
        // Tallies within tolerance — record it straight away.
        setBusy("record");
        await submitRecord(String(total), `Auto-liquidated from receipt (AI)${note ? ` · ${note}` : ""}`);
        return;
      }
      const bits = [
        data.supplier ? `Supplier: ${data.supplier}` : "",
        `Receipt total: ${peso(total)}`,
      ].filter(Boolean);
      warns.unshift(`Doesn't balance (${variance > 0 ? "change" : "over"} ${peso(Math.abs(variance))}) — review before recording.`);
      setAiInfo(`Read ✓ · ${bits.join(" · ")}`);
      setAiWarnings(warns);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function record() {
    if (num(spent) <= 0) { setErr("Enter the amount actually spent."); return; }
    setBusy("record"); setErr(null);
    await submitRecord(spent, note);
    setBusy(null);
  }

  async function act(fn: (id: string, note?: string) => Promise<void>, kind: string, promptMsg: string) {
    const n = window.prompt(promptMsg, "") ?? undefined;
    setBusy(kind); setErr(null);
    try { await fn(id, n); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  const verdict = (status: CashLiquidationView["status"], variance: number) => {
    if (status === "balanced") return <span className="font-semibold text-emerald-700">Tallied ✓ — spend matches the cash released</span>;
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

      {recorded ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Spent: <span className="font-medium tabular-nums text-foreground">{peso(liquidation.spent ?? 0)}</span></span>
            <span>{verdict(liquidation.status, liquidation.variance)}</span>
          </div>
          {liquidation.receipts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Receipts:</span>
              {liquidation.receipts.map((f) => (
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
          <Scale className="h-3.5 w-3.5" /> Liquidate (actual spend &amp; receipts)
        </button>
      ) : !recorded ? (
        <p className="text-xs text-muted-foreground">Awaiting the requestor to liquidate the cash.</p>
      ) : null}

      {canRecord && open && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-muted-foreground">Actual amount spent</span>
            <Input className="h-8 w-40 text-right" value={spent} onChange={(e) => setSpent(e.target.value)} placeholder="0.00" />
          </label>
          <p className="text-xs">
            {spent.trim() === "" ? <span className="text-muted-foreground">Enter the amount spent to tally it against {peso(released)}.</span>
              : Math.abs(previewVar) < 0.005 ? <span className="font-medium text-emerald-700">Tallies ✓</span>
              : previewVar > 0 ? <span className="font-medium text-amber-700">Change to return: {peso(previewVar)}</span>
              : <span className="font-medium text-destructive">Over the cash released by {peso(-previewVar)}</span>}
          </p>
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
              <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy === "upload"} onChange={(e) => e.target.files?.[0] && uploadReceipt(e.target.files[0])} />
            </label>
            {receipts.length > 0 && (
              <button type="button" onClick={autoRead} disabled={busy === "read"}
                className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/5 px-2.5 py-1 font-semibold text-primary hover:bg-primary/10 disabled:opacity-60">
                <Sparkles className="h-3.5 w-3.5" /> {busy === "read" ? "Reading…" : "Auto-read receipt"}
              </button>
            )}
          </div>
          {aiInfo && <p className="text-xs text-emerald-700">{aiInfo}</p>}
          {aiWarnings.length > 0 && (
            <ul className="space-y-0.5 text-xs text-amber-700">
              {aiWarnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
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
