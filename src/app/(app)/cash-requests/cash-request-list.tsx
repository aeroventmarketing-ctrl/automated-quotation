"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CashRequestRow } from "@/lib/cash-request-row";
import { advanceCashRequest, cancelCashRequest } from "./actions";
import { CashLiquidationPanel } from "./cash-liquidation-panel";
import { AdminCashOverride } from "./admin-cash-override";

const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** One cash request: header, breakdown, chain actions, trail and liquidation. */
function CashRow({ r }: { r: CashRequestRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function advance(stepKey: string, needsNote: boolean) {
    let note: string | undefined;
    if (needsNote) {
      note = window.prompt(stepKey === "voucher" ? "Voucher no. / reference (optional):" : stepKey === "reject" ? "Reason for rejection (optional):" : "Note (optional):", "") ?? undefined;
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

  const showLiquidation = r.status === "RECEIVED" || r.status === "LIQUIDATED" || r.status === "SETTLED";

  return (
    <div className="rounded-lg border p-3">
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

      {/* Chain actions available at the current status. */}
      {r.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {r.actions.map((a) =>
            a.canAct ? (
              <Button key={a.key} size="sm" variant={a.key === "reject" ? "outline" : "default"} className="h-7 text-xs"
                disabled={busy !== null} onClick={() => advance(a.key, a.key === "voucher" || a.key === "reject" || a.key === "release")}>
                {busy === a.key ? "…" : a.label}
              </Button>
            ) : (
              <span key={a.key} className="text-xs text-muted-foreground">Awaiting {a.actorLabel}</span>
            ),
          )}
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
    </div>
  );
}

export function CashRequestList({ rows }: { rows: CashRequestRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No cash requests yet.</p>;
  }
  return (
    <div className="space-y-3">
      {rows.map((r) => <CashRow key={r.id} r={r} />)}
    </div>
  );
}
