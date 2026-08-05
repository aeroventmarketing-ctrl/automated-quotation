"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApproverHighlight } from "@/components/approver-highlight";
import type { CashRequestRow } from "@/lib/cash-request-row";
import type { CashRequestStatus } from "@/lib/cash-request";
import { Input } from "@/components/ui/input";
import { advanceCashRequest, cancelCashRequest, adminEditCashRequest, adminDeleteCashRequest } from "./actions";
import { CashLiquidationPanel } from "./cash-liquidation-panel";
import { AdminCashOverride } from "./admin-cash-override";

const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Cash-request tabs, mirroring the Purchasing workspace. "Budgeted" is the
// committed-spend bucket: once "Approve voucher & release cash" is pressed
// (CASH_RELEASED onward) the request leaves Approved and lands here.
type CashBucket = "pending" | "approved" | "budgeted" | "rejected" | "cancelled";
type CashTab = CashBucket | "all";
const CASH_TABS: { key: CashTab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "budgeted", label: "Budgeted" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

function cashBucket(status: CashRequestStatus): CashBucket {
  switch (status) {
    case "PENDING_APPROVAL":
      return "pending";
    case "SUBMITTED":
    case "VOUCHER_READY":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "CANCELLED":
      return "cancelled";
    default:
      // CASH_RELEASED, DISBURSED, RECEIVED, LIQUIDATED, SETTLED
      return "budgeted";
  }
}

/** One cash request: header, breakdown, chain actions, trail and liquidation. */
function CashRow({ r }: { r: CashRequestRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function advance(stepKey: string, needsNote: boolean) {
    let note: string | undefined;
    if (needsNote) {
      note = window.prompt(stepKey === "voucher" ? "Voucher no. / reference (optional):" : (stepKey === "reject" || stepKey === "reject_request") ? "Reason for rejection (optional):" : "Note (optional):", "") ?? undefined;
    }
    setBusy(stepKey); setErr(null);
    try { await advanceCashRequest(r.id, stepKey, note); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function cancel() {
    if (!window.confirm("Cancel this cash request?")) return;
    setBusy("cancel"); setErr(null);
    try { await cancelCashRequest(r.id); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  const [editing, setEditing] = useState(false);
  const [ePurpose, setEPurpose] = useState(r.purpose);
  const [eAmount, setEAmount] = useState(String(r.amount));
  const [eNote, setENote] = useState(r.note ?? "");

  async function saveEdit() {
    setBusy("edit"); setErr(null);
    try {
      await adminEditCashRequest(r.id, { purpose: ePurpose, amount: eAmount, note: eNote });
      setEditing(false); router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function del() {
    if (!window.confirm("Permanently delete this cash request? This cannot be undone.")) return;
    setBusy("delete"); setErr(null);
    try { await adminDeleteCashRequest(r.id); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setBusy(null); }
  }

  const showLiquidation = r.status === "RECEIVED" || r.status === "LIQUIDATED" || r.status === "SETTLED";

  return (
    <div id={`cr-${r.id}`} className="scroll-mt-20 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{r.number}</span>
            <Badge variant={r.variant}>{r.statusLabel}</Badge>
            {r.isRequestor && <span className="text-xs text-muted-foreground">· your request</span>}
            {!["SUBMITTED", "REJECTED", "CANCELLED"].includes(r.status) && (
              <Link href={`/cash-requests/${r.id}/voucher`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <Printer className="h-3.5 w-3.5" /> Print voucher
              </Link>
            )}
          </div>
          <div className="mt-0.5 font-medium">{r.purpose}</div>
          <div className="text-xs text-muted-foreground">
            {r.categoryLabel}{r.deptLabel ? ` · ${r.deptLabel}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums">{peso(r.amount)}</div>
        </div>
      </div>

      {r.lines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {r.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>{l.description || `Line ${i + 1}`}</span>
              <span className="tabular-nums">{peso(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {r.note && <p className="mt-1 text-xs text-muted-foreground">Note: {r.note}</p>}

      {/* Chain actions available at the current status. Always name who must act
          (position + name) alongside the button, so everyone can see who will
          press it — not only when the viewer can't act. */}
      {r.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {r.actions[0] && <ApproverHighlight role={r.actions[0].actorLabel} />}
          {r.actions.filter((a) => a.canAct).map((a) => (
            <Button key={a.key} size="sm" variant={a.key === "reject" || a.key === "reject_request" ? "outline" : "default"} className="h-7 text-xs"
              disabled={busy !== null} onClick={() => advance(a.key, a.key === "voucher" || a.key === "reject" || a.key === "reject_request" || a.key === "release")}>
              {busy === a.key ? "…" : a.label}
            </Button>
          ))}
        </div>
      )}

      {showLiquidation && (
        <CashLiquidationPanel
          id={r.id}
          released={r.liquidation.released}
          liquidation={r.liquidation}
          canRecord={r.canRecordLiquidation}
          canSettle={r.canSettleLiquidation}
          canEscalate={r.canEscalateLiquidation}
          canApprove={r.canApproveLiquidation}
          admin={r.admin}
        />
      )}

      {/* Role-stamped trail. */}
      {r.trail.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
          {r.trail.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-3">
        {r.canCancel && (
          <button type="button" onClick={cancel} disabled={busy === "cancel"} className="text-xs text-muted-foreground hover:text-destructive">
            {busy === "cancel" ? "Cancelling…" : "Cancel request"}
          </button>
        )}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>

      {r.canOverride && <AdminCashOverride id={r.id} priorStatuses={r.priorStatuses} />}

      {/* Admin: edit key fields or delete this request, on any status. */}
      {r.admin && (
        editing ? (
          <div className="mt-2 space-y-2 rounded-md border border-amber-300 bg-amber-50/60 p-2 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">Edit (admin)</div>
            <Input className="h-8" placeholder="Purpose" value={ePurpose} onChange={(e) => setEPurpose(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">Amount<Input className="h-8 w-32" type="number" step="any" min={0} value={eAmount} onChange={(e) => setEAmount(e.target.value)} /></label>
              <Input className="h-8 flex-1 min-w-[10rem]" placeholder="Note" value={eNote} onChange={(e) => setENote(e.target.value)} />
            </div>
            <p className="text-[10px] text-amber-700 dark:text-amber-400">The amount here is the figure the P&amp;L uses. Any per-line breakdown is left unchanged.</p>
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={busy === "edit"} onClick={saveEdit}>{busy === "edit" ? "Saving…" : "Save"}</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditing(false); setEPurpose(r.purpose); setEAmount(String(r.amount)); setENote(r.note ?? ""); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
            <button type="button" onClick={() => setEditing(true)} className="rounded border px-2 py-0.5 text-xs font-medium hover:bg-accent">Edit (admin)</button>
            <button type="button" onClick={del} disabled={busy === "delete"} className="rounded border border-destructive/40 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">{busy === "delete" ? "…" : "Delete (admin)"}</button>
          </div>
        )
      )}
    </div>
  );
}

export function CashRequestList({ rows }: { rows: CashRequestRow[] }) {
  const [tab, setTab] = useState<CashTab>("pending");

  const counts: Record<CashTab, number> = { pending: 0, approved: 0, budgeted: 0, rejected: 0, cancelled: 0, all: 0 };
  for (const r of rows) counts[cashBucket(r.status)]++;
  counts.all = rows.length;

  const shown = tab === "all" ? rows : rows.filter((r) => cashBucket(r.status) === tab);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {CASH_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${tab === t.key ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No {tab === "all" ? "" : tab + " "}cash requests{rows.length === 0 ? " yet" : ""}.
        </p>
      ) : (
        shown.map((r) => <CashRow key={r.id} r={r} />)
      )}
    </div>
  );
}
