"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Check, X, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { requestRevisionRestore, approveRevisionRestore, cancelRevisionRestore } from "../actions";

export interface RestoreableRev {
  rev: number;
  savedAt: string;
  total: number;
  /** The snapshot carries full per-line specs (an exact restore); else summary-only. */
  hasFull: boolean;
}
export interface RevisionRestoreRequest {
  targetRev: number;
  requestedByName: string;
  requestedAt: string;
}
export interface RevisionRestoreLogEntry {
  fromRev: number;
  toRev: number;
  requestedByName?: string | null;
  approvedByName: string;
  approvedPosition: string;
  approvedAt: string;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
};

/**
 * Restore an earlier revision as the live quote (same number, stays APPROVED).
 * Sales requests it; an Engineer / admin approves. Every other revision is kept.
 */
export function RevisionRestore({
  quotationId,
  currentRev,
  revisions,
  pending,
  log,
  canRequest,
  canApprove,
  currency,
}: {
  quotationId: string;
  currentRev: number;
  revisions: RestoreableRev[];
  pending: RevisionRestoreRequest | null;
  log: RevisionRestoreLogEntry[];
  canRequest: boolean;
  canApprove: boolean;
  currency: string;
}) {
  const router = useRouter();
  const options = revisions.filter((r) => r.rev !== currentRev).sort((a, b) => a.rev - b.rev);
  const [target, setTarget] = useState<string>(options[0] ? String(options[0].rev) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const selected = options.find((o) => String(o.rev) === target);

  // Nothing to show if there are no earlier revisions and no history to display.
  if (options.length === 0 && !pending && log.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <RotateCcw className="h-4 w-4" /> Restore an earlier revision
      </div>

      {pending ? (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-semibold">Restore to rev. {pending.targetRev}</span> requested by {pending.requestedByName}
            {pending.requestedAt ? ` · ${when(pending.requestedAt)}` : ""} — awaiting Engineer / Admin approval.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canApprove && (
              <Button size="sm" className="h-8" disabled={busy} onClick={() => run(() => approveRevisionRestore(quotationId))}>
                <Check className="h-4 w-4" /> {busy ? "Saving…" : `Approve restore to rev. ${pending.targetRev}`}
              </Button>
            )}
            {(canApprove || canRequest) && (
              <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => run(() => cancelRevisionRestore(quotationId))}>
                <X className="h-4 w-4" /> Cancel request
              </Button>
            )}
            {!canApprove && <span className="text-xs text-muted-foreground">Only an Engineer or an admin can approve.</span>}
          </div>
        </div>
      ) : canRequest && options.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={target}
              disabled={busy}
              onChange={(e) => setTarget(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.rev} value={o.rev}>
                  rev. {o.rev} · {when(o.savedAt)} · {formatCurrency(o.total, currency)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={busy || !target}
              onClick={() => run(() => requestRevisionRestore(quotationId, Number(target)))}
            >
              <RotateCcw className="h-4 w-4" /> Request restore
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sales requests; an Engineer / admin approves. The quote keeps its number and stays approved; the other revisions are kept.
          </p>
          {selected && !selected.hasFull && (
            <p className="text-[11px] text-amber-700">
              rev. {selected.rev} was saved before full specs were stored — a restore rebuilds its descriptions, quantities and prices, but not the detailed specs.
            </p>
          )}
        </div>
      ) : options.length > 0 ? (
        <p className="text-xs text-muted-foreground">Sales (the preparer) can request a restore; an Engineer or admin approves it.</p>
      ) : null}

      {log.length > 0 && (
        <div className="space-y-1 border-t pt-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Restore approvals
          </div>
          {[...log].reverse().map((e, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              Restored <span className="font-medium text-foreground">rev. {e.toRev}</span> (from rev. {e.fromRev}) — approved by{" "}
              <span className="font-medium text-foreground">{e.approvedByName}</span> ({e.approvedPosition}) · {when(e.approvedAt)}
              {e.requestedByName ? ` · requested by ${e.requestedByName}` : ""}
            </p>
          ))}
        </div>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
