"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminRollbackPurchase } from "../orders/actions";

/**
 * Admin-only escape hatch on a purchase request: roll the chain back to an
 * earlier stage. Sign-offs recorded after the chosen stage are cleared so the
 * chain can be walked forward again. Only rendered for admins.
 */
export function AdminPurchaseOverride({ prId, priorStatuses }: { prId: string; priorStatuses: { key: string; label: string }[] }) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!target) return;
    const label = priorStatuses.find((s) => s.key === target)?.label ?? "an earlier stage";
    if (!confirm(`Roll this request back to "${label}"? Sign-offs recorded after that stage will be cleared.`)) return;
    setBusy(true); setErr(null);
    try { await adminRollbackPurchase(prId, target); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2">
      <div className="text-xs font-semibold text-destructive">Admin override</div>
      <div className="text-[11px] font-medium text-muted-foreground">Roll back the workflow</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy || priorStatuses.length === 0}
        >
          <option value="">— choose an earlier stage —</option>
          {priorStatuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <Button size="sm" variant="destructive" className="h-8" disabled={busy || !target} onClick={run}>
          {busy ? "Rolling back…" : "Roll back"}
        </Button>
      </div>
      {priorStatuses.length === 0 && <p className="text-xs text-muted-foreground">The request is already at the first stage.</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
