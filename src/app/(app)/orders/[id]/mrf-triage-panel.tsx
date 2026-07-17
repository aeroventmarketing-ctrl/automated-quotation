"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StockOpt } from "./stock-match-panel";

export interface TriageLine {
  description: string;
  qty: string;
  unit: string;
  remark?: string;
}

type TriageAction = "issue" | "reserve" | "purchase";
interface RowState {
  action: TriageAction;
  stockItemId: string;
  qty: string;
}

/**
 * Warehouse triage: for each Material Request line, decide "Issue from stock"
 * (pick the stock item + qty to deduct) or "Purchase" (escalate to purchasing).
 * Submits every line's disposition together.
 */
export function MrfTriagePanel({
  lines,
  stockItems,
  onCancel,
  onSubmit,
}: {
  lines: TriageLine[];
  stockItems: StockOpt[];
  onCancel: () => void;
  onSubmit: (dispositions: { action: TriageAction; stockItemId?: string; qty?: number }[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<RowState[]>(
    lines.map((l) => ({ action: "issue", stockItemId: "", qty: l.qty ?? "" })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(i: number, patch: Partial<RowState>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const dispositions = rows.map((r) =>
        r.action === "purchase"
          ? { action: "purchase" as const }
          : { action: r.action, stockItemId: r.stockItemId || undefined, qty: Number(r.qty) || undefined },
      );
      await onSubmit(dispositions);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  const issueCount = rows.filter((r) => r.action === "issue").length;
  const reserveCount = rows.filter((r) => r.action === "reserve").length;
  const buyCount = rows.filter((r) => r.action === "purchase").length;

  return (
    <div className="mt-2 space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">
        For each line, choose <b>Issue from stock</b> (pick the item &amp; quantity to deduct) or <b>Purchase</b> (send that line to purchasing). Lines can be split — some issued, some purchased.
      </div>
      {stockItems.length === 0 && (
        <div className="text-xs text-amber-600">No stock items yet — add them under Inventory. You can still mark lines for purchase.</div>
      )}

      <div className="space-y-2">
        {lines.map((l, i) => {
          const r = rows[i];
          return (
            <div key={i} className="rounded-md border bg-background p-2">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{l.description}</span>
                <span className="text-xs text-muted-foreground">{[l.qty, l.unit].filter(Boolean).join(" ")}{l.remark ? ` · ${l.remark}` : ""}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex overflow-hidden rounded-md border">
                  <button
                    type="button"
                    onClick={() => set(i, { action: "issue" })}
                    className={`px-2.5 py-1 text-xs ${r.action === "issue" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                  >
                    Issue from stock
                  </button>
                  <button
                    type="button"
                    onClick={() => set(i, { action: "reserve" })}
                    className={`border-l px-2.5 py-1 text-xs ${r.action === "reserve" ? "bg-indigo-600 text-white" : "hover:bg-accent"}`}
                  >
                    Reserve
                  </button>
                  <button
                    type="button"
                    onClick={() => set(i, { action: "purchase" })}
                    className={`border-l px-2.5 py-1 text-xs ${r.action === "purchase" ? "bg-amber-500 text-white" : "hover:bg-accent"}`}
                  >
                    Purchase
                  </button>
                </div>
                {(r.action === "issue" || r.action === "reserve") && (
                  <>
                    <select
                      value={r.stockItemId}
                      onChange={(e) => set(i, { stockItemId: e.target.value })}
                      className="h-8 min-w-[10rem] rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">— pick stock item —</option>
                      {stockItems.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>
                      ))}
                    </select>
                    <Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Qty"
                      value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
                    {r.action === "reserve" && <span className="text-xs text-indigo-600">Held, not deducted</span>}
                  </>
                )}
                {r.action === "purchase" && (
                  <span className="text-xs text-amber-600">Will be sent to purchasing</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy} onClick={submit}>
          {busy ? "Processing…" : `Process — issue ${issueCount}, reserve ${reserveCount}, purchase ${buyCount}`}
        </Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onCancel}>Cancel</Button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
