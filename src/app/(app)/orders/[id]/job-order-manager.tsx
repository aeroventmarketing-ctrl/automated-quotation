"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { issueJobOrders, advanceJobOrder, receiveJobOrders } from "../actions";

interface JobRow {
  key: string;
  label: string;
  status: "issued" | "in_production" | "finished";
  events: { label: string; who: string; when: string }[];
  canAdvance: boolean;
  nextTo: "in_production" | "finished" | null;
  nextLabel: string | null;
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

export function JobOrderManager({
  orderId,
  stage,
  canIssue,
  canReceive,
  allDepts,
  jobs,
}: {
  orderId: string;
  stage: string;
  canIssue: boolean;
  canReceive: boolean;
  allDepts: { key: string; label: string }[];
  jobs: JobRow[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
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

  // Phase 2 — issuance (order released, not yet in production).
  if (stage === "released") {
    if (!canIssue) {
      return <p className="text-sm text-muted-foreground">Awaiting the Technical Head to issue job orders.</p>;
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Select the departments relevant to this order:</p>
        <div className="flex flex-wrap gap-2">
          {allDepts.map((d) => {
            const on = sel.has(d.key);
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => {
                  const next = new Set(sel);
                  if (on) next.delete(d.key); else next.add(d.key);
                  setSel(next);
                }}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        <Button
          size="sm"
          disabled={busy || sel.size === 0}
          onClick={() => run(() => issueJobOrders(orderId, Array.from(sel)))}
        >
          {busy ? "Issuing…" : `Issue job orders${sel.size ? ` (${sel.size})` : ""}`}
        </Button>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    );
  }

  // Phase 4 — production tracking.
  return (
    <div className="space-y-2">
      {/* JO released → the Plant Manager must receive the JO before production. */}
      {stage === "in_production" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <span className="text-amber-800 dark:text-amber-300">
            Job orders released. Awaiting the Plant Manager to receive them before production starts.
          </span>
          {canReceive && (
            <Button size="sm" className="h-7 text-xs" disabled={busy}
              onClick={() => run(() => receiveJobOrders(orderId))}>
              {busy ? "Receiving…" : "Receive job orders"}
            </Button>
          )}
        </div>
      )}
      {jobs.length === 0 && <p className="text-sm text-muted-foreground">No job orders on this order.</p>}
      {jobs.map((j) => (
        <div key={j.key} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">{j.label}</div>
            <div className="mt-0.5 space-y-0.5">
              {j.events.map((e, i) => (
                <div key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">{e.label}</span> — {e.who} · {e.when}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[j.status]}>{STATUS_LABEL[j.status]}</Badge>
            {j.canAdvance && j.nextTo && (
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
                onClick={() => run(() => advanceJobOrder(orderId, j.key, j.nextTo!))}>
                {busy ? "Saving…" : j.nextLabel}
              </Button>
            )}
          </div>
        </div>
      ))}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
