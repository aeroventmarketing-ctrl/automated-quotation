"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { advancePurchaseRequest } from "../actions";

interface ActionOpt {
  key: string;
  label: string;
  canAct: boolean;
  roleLabel: string;
}
interface PRRow {
  id: string;
  deptLabel: string;
  items: string[];
  note?: string | null;
  status: string;
  statusLabel: string;
  variant: "secondary" | "warning" | "success" | "destructive";
  trail: string[];
  actions: ActionOpt[];
}

export function PurchasingChain({ requests }: { requests: PRRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(prId: string, stepKey: string) {
    setBusy(prId + stepKey);
    setErr(null);
    try {
      await advancePurchaseRequest(prId, stepKey);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(null);
    }
  }

  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">No purchase requests. They appear here when the warehouse marks a material request &ldquo;For purchasing.&rdquo;</p>;
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => {
        const actionable = r.actions.filter((a) => a.canAct);
        const awaiting = r.actions.find((a) => !a.canAct);
        return (
          <div key={r.id} className="rounded-md border p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{r.deptLabel}</span>
              <Badge variant={r.variant}>{r.statusLabel}</Badge>
            </div>
            <ul className="ml-4 list-disc text-sm text-muted-foreground">
              {r.items.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
            {r.note && <p className="mt-1 text-xs text-muted-foreground">Note: {r.note}</p>}
            {r.trail.length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">{r.trail.join(" · ")}</div>
            )}
            {actionable.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {actionable.map((a) => (
                  <Button
                    key={a.key}
                    size="sm"
                    variant={a.key === "reject" ? "outline" : "default"}
                    className="h-7 text-xs"
                    disabled={busy === r.id + a.key}
                    onClick={() => run(r.id, a.key)}
                  >
                    {busy === r.id + a.key ? "Saving…" : a.label}
                  </Button>
                ))}
              </div>
            ) : awaiting ? (
              <div className="mt-2 text-xs text-muted-foreground">Awaiting {awaiting.roleLabel}</div>
            ) : null}
          </div>
        );
      })}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
