"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw } from "lucide-react";
import { setJobOrderApproval, type JobOrderDept } from "../actions";

/**
 * Engineer/admin review sign-off shown on each job order: an "Approve" button, or
 * an "Approved by …" badge with a reopen control. Editing a job order clears its
 * approval (handled server-side), so an edited order must be re-approved.
 */
export function JobOrderApproval({
  orderId,
  dept,
  index,
  approvedByName,
  canApprove,
}: {
  orderId: string;
  dept: JobOrderDept;
  index: number;
  approvedByName?: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const approved = !!(approvedByName && approvedByName.trim());

  async function set(approve: boolean) {
    setBusy(true);
    try {
      await setJobOrderApproval(orderId, dept, index, approve);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (approved) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
          <Check className="h-3 w-3" /> Approved · {approvedByName}
        </span>
        {canApprove && (
          <button type="button" disabled={busy} onClick={() => set(false)} className="text-muted-foreground hover:text-primary" title="Reopen for review" aria-label="Reopen for review">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    );
  }
  if (!canApprove) return <span className="text-muted-foreground">Pending review</span>;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => set(true)}
      className="inline-flex items-center gap-1 rounded-md border border-emerald-600 px-2 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-50"
    >
      <Check className="h-3.5 w-3.5" /> {busy ? "…" : "Approve"}
    </button>
  );
}
