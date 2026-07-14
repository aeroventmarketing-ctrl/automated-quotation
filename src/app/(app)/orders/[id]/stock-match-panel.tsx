"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface MatchLine {
  label: string;
  qtyDefault: string;
}
export interface StockOpt {
  id: string;
  name: string;
  unit: string;
}

/** Match request/purchase lines to stock items + quantities before issuing/receiving. */
export function StockMatchPanel({
  lines,
  stockItems,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  lines: MatchLine[];
  stockItems: StockOpt[];
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (matches: { stockItemId: string; qty: number }[]) => Promise<void>;
}) {
  const [rows, setRows] = useState(lines.map((l) => ({ stockItemId: "", qty: l.qtyDefault ?? "" })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(i: number, key: "stockItemId" | "qty", value: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const matches = rows
        .map((r) => ({ stockItemId: r.stockItemId, qty: Number(r.qty) }))
        .filter((m) => m.stockItemId && Number.isFinite(m.qty) && m.qty > 0);
      await onSubmit(matches);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">
        Match each line to a stock item and quantity. Leave a line blank to skip it (nothing deducted/added).
      </div>
      {stockItems.length === 0 && (
        <div className="text-xs text-amber-600">No stock items yet — add them under Inventory. You can still proceed; nothing will be adjusted.</div>
      )}
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="min-w-[10rem] flex-1 text-sm">{l.label}</span>
            <select
              value={rows[i].stockItemId}
              onChange={(e) => set(i, "stockItemId", e.target.value)}
              className="h-8 min-w-[10rem] rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— skip —</option>
              {stockItems.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>
              ))}
            </select>
            <Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Qty" value={rows[i].qty} onChange={(e) => set(i, "qty", e.target.value)} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy} onClick={submit}>{busy ? "Saving…" : submitLabel}</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onCancel}>Cancel</Button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
