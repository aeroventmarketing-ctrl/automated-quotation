"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pickIssueRow } from "@/lib/stock-location";
import { buildSkuIndex, skuFor } from "@/lib/item-sku";
import { ItemSku } from "@/components/item-sku";
import { stockRowsForLine } from "@/lib/stock-line-match";

export interface MatchLine {
  label: string;
  qtyDefault: string;
  /** The line's recorded SKU, when it has one (`PurchaseRequest.itemSkus`). */
  sku?: string | null;
}
export interface StockOpt {
  id: string;
  name: string;
  unit: string;
  /** Short scan/item code. When present it's matched first — an exact Item-Code
   *  hit beats any fuzzy name similarity (see the Item Listing Standard). */
  sku?: string | null;
  /** Warehouse location — routes issuing (Plant Warehouse vs Office). */
  location?: string | null;
  /** Free to issue right now (on hand − active reservations); absent ⇒ unknown. */
  available?: number;
}

/** Match request/purchase lines to stock items + quantities before issuing/receiving. */
export function StockMatchPanel({
  lines,
  stockItems,
  submitLabel,
  onCancel,
  onSubmit,
  selectable = false,
  dept,
}: {
  lines: MatchLine[];
  stockItems: StockOpt[];
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (matches: { stockItemId: string; qty: number; lineIndex: number }[]) => Promise<void>;
  /** Show a per-line tick box; only ticked lines are submitted (for releasing). */
  selectable?: boolean;
  /** Requesting department — routes the auto-match to Plant vs Office stock. */
  dept?: string;
}) {
  /** Name → item code, for the SKU beside each line being matched. */
  const skuIndex = useMemo(() => buildSkuIndex({ stock: stockItems }), [stockItems]);
  // Lines look like "9 pc · ANGLE BAR 2.0 X 25 X 25 (remark)" — the qty is read
  // off the front; the item is identified by its SKU, never by the words.
  const qtyOf = (label: string): string => {
    const noRemark = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const dot = noRemark.indexOf("·");
    if (dot >= 0) return (noRemark.slice(0, dot).trim().match(/^[\d.]+/) ?? [""])[0];
    return (noRemark.match(/^([\d.]+)\s+\S+\s+/) ?? ["", ""])[1];
  };
  /** The SKU printed beside the line: its recorded code, else the SKU chip's. */
  const lineSku = (l: MatchLine): string | null => (l.sku ?? "").trim() || skuFor(l.label, skuIndex);
  /**
   * Pre-select the stock item with exactly the line's SKU — and nothing else.
   * The owner: *"Match by SKU only, do not use anything else"*, then *"switch
   * receiving to SKU only too"*. This used to score names fuzzily, which can put
   * goods into NIHONBOND #16 (1.2mm) that were bought as (1.3mm). No SKU, or a
   * SKU no stock item carries → nothing pre-selected; the warehouse picks the
   * item by hand (the list shows each item's SKU) or skips the line. The
   * department's location policy chooses among that SKU's rows.
   */
  const autoMatchId = (l: MatchLine): string => pickIssueRow(stockRowsForLine(lineSku(l), stockItems), dept)?.id ?? "";
  const nameOf = (id: string) => stockItems.find((s) => s.id === id)?.name ?? "";
  const locOf = (id: string) => stockItems.find((s) => s.id === id)?.location ?? null;
  const verb = selectable ? "released from" : "received into"; // selectable = the release flow
  const [rows, setRows] = useState(() =>
    lines.map((l) => ({ stockItemId: autoMatchId(l), qty: (l.qtyDefault ?? "").trim() || qtyOf(l.label), checked: true })),
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
        .map((r, i) => ({ stockItemId: r.stockItemId, qty: Number(r.qty), lineIndex: i, checked: r.checked }))
        .filter((m) => (!selectable || m.checked) && m.stockItemId && Number.isFinite(m.qty) && m.qty > 0)
        .map(({ stockItemId, qty, lineIndex }) => ({ stockItemId, qty, lineIndex }));
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
          : "Each line is matched to the stock item with its SKU — review and adjust if needed. A line with no SKU match is left for you to choose. Set a line to “skip” to leave it out (nothing deducted/added)."}
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
            <span className={`min-w-[10rem] flex-1 text-sm ${selectable && !rows[i].checked ? "text-muted-foreground line-through" : ""}`}>{l.label}<ItemSku code={lineSku(l)} /></span>
            <select
              value={rows[i].stockItemId}
              onChange={(e) => set(i, "stockItemId", e.target.value)}
              disabled={selectable && !rows[i].checked}
              className="h-8 min-w-[10rem] rounded-md border bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="">— skip —</option>
              {stockItems.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.unit}){s.sku ? ` · SKU ${s.sku}` : ""}{s.location ? ` · ${s.location}` : ""}</option>
              ))}
            </select>
            <Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Qty" value={rows[i].qty} disabled={selectable && !rows[i].checked} onChange={(e) => set(i, "qty", e.target.value)} />
            {/* Confirmation of exactly which stock item gets the quantity. */}
            {(!selectable || rows[i].checked) && (
              <span className="w-full pl-6 text-[11px]">
                {rows[i].stockItemId && Number(rows[i].qty) > 0 ? (
                  <span className="text-muted-foreground">→ {rows[i].qty} {verb} <span className="font-medium text-foreground">{nameOf(rows[i].stockItemId)}</span>{locOf(rows[i].stockItemId) ? ` · ${locOf(rows[i].stockItemId)}` : ""}</span>
                ) : (
                  <span className="text-amber-600">
                    → {lineSku(l) ? `no stock item has SKU ${lineSku(l)}` : "no SKU on this line"} — choose the item, or nothing will be posted for this line
                  </span>
                )}
              </span>
            )}
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
