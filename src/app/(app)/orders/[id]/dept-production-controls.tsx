"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { issueJobOrders, advanceJobOrder } from "../actions";
import { JobOrderProofs, type JobProof } from "./job-order-proofs";

type Status = "issued" | "in_production" | "finished";
const STATUS_VARIANT: Record<Status, "secondary" | "warning" | "success"> = {
  issued: "secondary",
  in_production: "warning",
  finished: "success",
};
const STATUS_LABEL: Record<Status, string> = {
  issued: "Issued",
  in_production: "In production",
  finished: "Finished",
};

/**
 * Per-department production strip shown on each job-order panel: "Issue job
 * order" (until issued), then "Start production" / "Mark finished" for that
 * department's production head.
 */
export function DeptProductionControls({
  orderId,
  deptKey,
  status,
  canIssue,
  canAdvance,
  nextTo,
  nextLabel,
  awaitingReceive,
  proofs,
  canEditProofs,
  admin = false,
}: {
  orderId: string;
  deptKey: string;
  status: Status | null;
  canIssue: boolean;
  canAdvance: boolean;
  nextTo: "in_production" | "finished" | null;
  nextLabel: string | null;
  awaitingReceive: boolean;
  proofs: JobProof[];
  canEditProofs: boolean;
  admin?: boolean;
}) {
  const router = useRouter();
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

  // "Mark finished" is blocked until at least one proof picture is attached
  // (the server enforces the same rule).
  const finishBlockedNoProof = nextTo === "finished" && proofs.length === 0;

  return (
    <div className="mb-2">
      {/* Proofing pictures — shown once the department's job order exists. */}
      {status != null && (
        <JobOrderProofs orderId={orderId} deptKey={deptKey} initialProofs={proofs} canEdit={canEditProofs} admin={admin} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {status == null ? (
          canIssue ? (
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => issueJobOrders(orderId, [deptKey]))}>
              {busy ? "Issuing…" : "Issue job order"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Not yet issued to production.</span>
          )
        ) : (
          <>
            <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
            {canAdvance && nextTo && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy || finishBlockedNoProof}
                title={finishBlockedNoProof ? "Attach at least one proof picture first." : undefined}
                onClick={() => run(() => advanceJobOrder(orderId, deptKey, nextTo))}
              >
                {busy ? "Saving…" : nextLabel}
              </Button>
            )}
            {finishBlockedNoProof && canAdvance && (
              <span className="text-xs text-muted-foreground">Attach a proof picture to enable &ldquo;Mark finished&rdquo;.</span>
            )}
            {status === "issued" && awaitingReceive && (
              <span className="text-xs text-muted-foreground">Awaiting the Plant Manager to receive the job orders.</span>
            )}
          </>
        )}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
