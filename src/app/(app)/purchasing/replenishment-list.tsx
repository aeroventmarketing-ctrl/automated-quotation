"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { advancePurchaseRequest, receivePurchaseRequest } from "../orders/actions";

interface ActionOpt {
  key: string;
  label: string;
  roleLabel: string;
  canAct: boolean;
}
export interface PRRow {
  id: string;
  stockItemId: string;
  items: string[];
  note?: string | null;
  status: string;
  statusLabel: string;
  variant: "secondary" | "warning" | "success" | "destructive";
  trail: string[];
  actions: ActionOpt[];
}

function PRCard({ row }: { row: PRRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [recvQty, setRecvQty] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{row.items.join(", ") || "—"}</div>
          {row.note && <div className="text-xs text-muted-foreground">{row.note}</div>}
        </div>
        <Badge variant={row.variant}>{row.statusLabel}</Badge>
      </div>

      {row.trail.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {row.trail.map((t, i) => <div key={i} className="text-xs text-muted-foreground">{t}</div>)}
        </div>
      )}

      {row.actions.length > 0 && (
        <div className="mt-3 space-y-2">
          {/* Receive step needs a quantity to post into stock. */}
          {row.actions.some((a) => a.key === "receive") && row.actions.find((a) => a.key === "receive")?.canAct && (
            <div className="flex flex-wrap items-end gap-2">
              <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Received qty" value={recvQty} onChange={(e) => setRecvQty(e.target.value)} />
              <Button size="sm" className="h-8" disabled={busy || !(Number(recvQty) > 0)}
                onClick={() => run(() => receivePurchaseRequest(row.id, [{ stockItemId: row.stockItemId, qty: Number(recvQty) }]))}>
                {busy ? "…" : "Receive into stock"}
              </Button>
            </div>
          )}
          {/* Approve/reject take an optional note. */}
          {row.actions.some((a) => (a.key === "approve" || a.key === "reject") && a.canAct) && (
            <Input className="h-8 w-full max-w-md" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          )}
          <div className="flex flex-wrap gap-2">
            {row.actions.filter((a) => a.key !== "receive").map((a) => (
              a.canAct ? (
                <Button key={a.key} size="sm" variant={a.key === "reject" ? "outline" : "default"} className="h-8" disabled={busy}
                  onClick={() => run(() => advancePurchaseRequest(row.id, a.key, note || undefined))}>
                  {a.label}
                </Button>
              ) : (
                <span key={a.key} className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs text-muted-foreground">
                  {a.label} · {a.roleLabel}
                </span>
              )
            ))}
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
      )}
    </div>
  );
}

export function ReplenishmentList({ rows }: { rows: PRRow[] }) {
  return <div className="space-y-3">{rows.map((r) => <PRCard key={r.id} row={r} />)}</div>;
}
