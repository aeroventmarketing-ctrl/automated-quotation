"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminRollbackStage, adminRollbackApproval } from "../actions";
import type { OrderStage } from "@/lib/order-workflow";

/**
 * Admin-only escape hatch: roll the order back to an earlier stage, or undo a
 * specific approver's sign-off (which returns the order to just before it).
 */
export function AdminWorkflowOverride({
  orderId,
  priorStages,
  approvals,
}: {
  orderId: string;
  priorStages: { key: string; label: string }[];
  approvals: { key: string; label: string; byName: string; at: string }[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>, confirmMsg: string) {
    if (!confirm(confirmMsg)) return;
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

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-xs font-semibold text-muted-foreground">Roll back the workflow</div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy || priorStages.length === 0}
          >
            <option value="">— choose an earlier stage —</option>
            {priorStages.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="destructive"
            className="h-8"
            disabled={busy || !target}
            onClick={() =>
              run(
                () => adminRollbackStage(orderId, target as OrderStage),
                `Roll the order back to "${priorStages.find((s) => s.key === target)?.label}"? Sign-offs recorded after that stage will be cleared and job-order progress reset to match.`,
              )
            }
          >
            {busy ? "Rolling back…" : "Roll back"}
          </Button>
        </div>
        {priorStages.length === 0 && <p className="mt-1 text-xs text-muted-foreground">The order is already at the first stage.</p>}
      </div>

      {approvals.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">Roll back an approval</div>
          <ul className="space-y-1.5">
            {approvals.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-2 text-xs">
                <span>
                  <span className="font-medium">{a.label}</span> — {a.byName}
                  {a.at ? ` · ${a.at}` : ""}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => adminRollbackApproval(orderId, a.key),
                      `Roll back "${a.label}" by ${a.byName}? The order returns to just before this approval, so it can be approved again.`,
                    )
                  }
                >
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
