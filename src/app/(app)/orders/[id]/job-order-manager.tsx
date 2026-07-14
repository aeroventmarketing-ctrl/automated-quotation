"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { issueJobOrders, advanceJobOrder } from "../actions";

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
  allDepts,
  jobs,
}: {
  orderId: string;
  stage: string;
  canIssue: boolean;
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
