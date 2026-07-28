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
  selectable = false,
}: {
  lines: MatchLine[];
  stockItems: StockOpt[];
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (matches: { stockItemId: string; qty: number }[]) => Promise<void>;
  /** Show a per-line tick box; only ticked lines are submitted (for releasing). */
  selectable?: boolean;
}) {
  // Auto-match each line to an existing stock item (and quantity) so receiving
  // posts to inventory by default — the warehouse can still change or skip a row.
  // Lines look like "9 pc · ANGLE BAR 2.0 X 25 X 25 (remark)".
  const parseLine = (label: string): { qty: string; desc: string } => {
    const noRemark = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const dot = noRemark.indexOf("·");
    if (dot >= 0) {
      const head = noRemark.slice(0, dot).trim(); // "9 pc"
      const qty = (head.match(/^[\d.]+/) ?? [""])[0];
      return { qty, desc: noRemark.slice(dot + 1).trim() };
    }
    const m = noRemark.match(/^([\d.]+)\s+\S+\s+(.*)$/);
    return m ? { qty: m[1], desc: m[2].trim() } : { qty: "", desc: noRemark };
  };
  const autoMatchId = (desc: string): string => {
    const d = desc.trim().toLowerCase();
    if (!d) return "";
    let best = "";
    let score = 0;
    for (const s of stockItems) {
      const name = s.name.trim().toLowerCase();
      if (!name) continue;
      let sc = 0;
      if (name === d) sc = 1000;
      else if (d.includes(name)) sc = 500 + name.length;
      else if (name.includes(d)) sc = 300 + d.length;
      if (sc > score) { score = sc; best = s.id; }
    }
    return best;
  };
  const [rows, setRows] = useState(() =>
    lines.map((l) => {
      const { qty, desc } = parseLine(l.label);
      return { stockItemId: autoMatchId(desc), qty: (l.qtyDefault ?? "").trim() || qty, checked: true };
    }),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(i: number, key: "stockItemId" | "qty", value: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }
  function toggle(i: number, checked: boolean) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, checked } : r)));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const matches = rows
        .filter((r) => !selectable || r.checked)
        .map((r) => ({ stockItemId: r.stockItemId, qty: Number(r.qty) }))
        .filter((m) => m.stockItemId && Number.isFinite(m.qty) && m.qty > 0);
      if (selectable && matches.length === 0) { setErr("Tick at least one item (with a quantity) to release."); setBusy(false); return; }
      await onSubmit(matches);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">
        {selectable
          ? "Tick the item(s) to release and set the quantity to release for each. Only ticked items are released and deducted from stock."
          : "Each line is matched to its stock item and quantity automatically — review and adjust if needed. Set a line to “skip” to leave it out (nothing deducted/added)."}
      </div>
      {stockItems.length === 0 && (
        <div className="text-xs text-amber-600">No stock items yet — add them under Inventory. You can still proceed; nothing will be adjusted.</div>
      )}
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {selectable && (
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={rows[i].checked}
                onChange={(e) => toggle(i, e.target.checked)}
                aria-label={`Release ${l.label}`}
              />
            )}
            <span className={`min-w-[10rem] flex-1 text-sm ${selectable && !rows[i].checked ? "text-muted-foreground line-through" : ""}`}>{l.label}</span>
            <select
              value={rows[i].stockItemId}
              onChange={(e) => set(i, "stockItemId", e.target.value)}
              disabled={selectable && !rows[i].checked}
              className="h-8 min-w-[10rem] rounded-md border bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="">— skip —</option>
              {stockItems.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>
              ))}
            </select>
            <Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Qty" value={rows[i].qty} disabled={selectable && !rows[i].checked} onChange={(e) => set(i, "qty", e.target.value)} />
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
