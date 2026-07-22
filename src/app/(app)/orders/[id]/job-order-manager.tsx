"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { receiveJobOrders, setJobOrderDue } from "../actions";

interface JobRow {
  key: string;
  label: string;
  status: "issued" | "in_production" | "finished";
  dueAt: string | null;
  canSetDue: boolean;
  events: { label: string; who: string; designation?: string; when: string }[];
  canAdvance: boolean;
  nextTo: "in_production" | "finished" | null;
  nextLabel: string | null;
}

/** Days from today (local) to a YYYY-MM-DD date (negative = past). */
function daysUntil(due: string): number {
  const [y, m, d] = due.split("-").map(Number);
  const dueMid = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((dueMid - todayMid) / 86_400_000);
}
function fmtDue(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}
/** Traffic-light styling + label for a job order's deadline. */
function deadlineChip(dueAt: string | null, status: JobRow["status"]): { text: string; cls: string } | null {
  if (!dueAt) return null;
  const days = daysUntil(dueAt);
  if (status === "finished") {
    return { text: `Due ${fmtDue(dueAt)}`, cls: "border-border bg-muted text-muted-foreground" };
  }
  if (days < 0) return { text: `Delayed · ${-days}d overdue (due ${fmtDue(dueAt)})`, cls: "border-destructive/40 bg-destructive/10 text-destructive" };
  if (days === 0) return { text: `Due today (${fmtDue(dueAt)})`, cls: "border-destructive/40 bg-destructive/10 text-destructive" };
  if (days <= 3) return { text: `Due in ${days}d (${fmtDue(dueAt)})`, cls: "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" };
  return { text: `On track · due ${fmtDue(dueAt)}`, cls: "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" };
}

const STATUS_VARIANT: Record<JobRow["status"], "secondary" | "warning" | "success"> = {
  issued: "secondary",
  in_production: "warning",
  finished: "success",
};
const STATUS_LABEL: Record<JobRow["status"], string> = {
  issued: "Issued",
  in_production: "In production",
  finished: "Finished",
};

// Per-department colours — must match the job-order section blocks on the page.
const DEPT_BG: Record<string, string> = {
  fans: "border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30",
  duct: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
  accessories: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
  motor: "border-violet-300 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/30",
};
const DEPT_TEXT: Record<string, string> = {
  fans: "text-sky-800 dark:text-sky-300",
  duct: "text-emerald-800 dark:text-emerald-300",
  accessories: "text-amber-800 dark:text-amber-300",
  motor: "text-violet-800 dark:text-violet-300",
};

export function JobOrderManager({
  orderId,
  stage,
  canIssue,
  canReceive,
  jobs,
}: {
  orderId: string;
  stage: string;
  canIssue: boolean;
  canReceive: boolean;
  jobs: JobRow[];
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

  // Overview: the Plant Manager's "Receive" step + a read-only status summary of
  // the issued departments. Issuing and Start production / Mark finished are done
  // per department on each job-order panel below.
  return (
    <div className="space-y-2">
      {stage === "released" && jobs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {canIssue
            ? "Issue each department's job order from its section below."
            : "Awaiting the departments' job orders to be issued."}
        </p>
      )}
      {/* JO released → the Plant Manager must receive the JO before production. */}
      {stage === "in_production" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <span className="text-amber-800 dark:text-amber-300">
            Job orders released. Awaiting the Plant Manager to receive them before production starts.
          </span>
          {canReceive && (
            <Button size="sm" className="h-7 text-xs" disabled={busy}
              onClick={() => run(() => receiveJobOrders(orderId))}>
              {busy ? "Receiving…" : "Job Orders Received"}
            </Button>
          )}
        </div>
      )}
      {jobs.map((j) => {
        const chip = deadlineChip(j.dueAt, j.status);
        return (
        <div key={j.key} className={`flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 ${DEPT_BG[j.key] ?? ""}`}>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-sm font-medium ${DEPT_TEXT[j.key] ?? ""}`}>{j.label}</span>
              {chip && <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>}
            </div>
            <div className="mt-0.5 space-y-0.5">
              {j.events.map((e, i) => (
                <div key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">{e.label}</span> — {e.who}{e.designation ? ` (${e.designation})` : ""} · {e.when}
                </div>
              ))}
            </div>
            {/* Deadline editor (Technical Head / Plant Manager / dept head / admin). */}
            {j.canSetDue && j.status !== "finished" && (
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                Deadline
                <input type="date" defaultValue={j.dueAt ?? ""} disabled={busy}
                  className="h-7 rounded-md border bg-background px-2 text-xs"
                  onChange={(e) => run(() => setJobOrderDue(orderId, j.key, e.target.value || null))} />
                {j.dueAt && (
                  <button type="button" className="text-muted-foreground hover:text-destructive" disabled={busy}
                    onClick={() => run(() => setJobOrderDue(orderId, j.key, null))}>Clear</button>
                )}
              </label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[j.status]}>{STATUS_LABEL[j.status]}</Badge>
          </div>
        </div>
        );
      })}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
