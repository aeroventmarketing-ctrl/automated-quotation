"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pickIssueRow } from "@/lib/stock-location";

export interface MatchLine {
  label: string;
  qtyDefault: string;
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
  // Compare on alphanumerics only, so punctuation/spacing differences don't block
  // a match — e.g. "G.I BOLT 5/16 X 1" matches "GI BOLT 5/16 X 1".
  const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Word/code tokens for a fuzzy fallback. A "code" token carries a digit (a
  // part number or size, e.g. "50s", "450m", "25") — these disambiguate
  // otherwise-similar items, so a fuzzy match must agree on all of them.
  const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const hasDigit = (t: string) => /\d/.test(t);
  const autoMatchId = (desc: string): string => {
    const dc = canon(desc);
    if (!dc) return "";
    const dToks = tokenize(desc);
    const dCodes = dToks.filter(hasDigit);
    let best = "";
    let score = 0;
    for (const s of stockItems) {
      // Deterministic Item-Code / SKU match (per the Item Listing Standard): when
      // a stock item's SKU appears in the line, that's an exact identity — it
      // outranks every fuzzy name score below, so differently-worded descriptions
      // (e.g. "Induction Motor (TECO)" vs "TECO 1HP 4-Pole Motor") still match as
      // long as both carry the same code. Length-gated to avoid a short code
      // colliding inside an unrelated word; the longest matching SKU wins.
      const skc = canon(s.sku ?? "");
      if (skc.length >= 4 && dc.includes(skc)) {
        const sc = 2000 + skc.length;
        if (sc > score) { score = sc; best = s.id; }
        continue;
      }
      const nc = canon(s.name);
      if (!nc) continue;
      let sc = 0;
      if (nc === dc) sc = 1000;
      else if (dc.includes(nc)) sc = 500 + nc.length;
      else if (nc.includes(dc)) sc = 300 + dc.length;
      else {
        // Fuzzy fallback for word-order / extra-word differences (e.g. a stock
        // item named "PTH-S-50S VIBRATION ISOLATOR" vs a line "VIBRATION
        // ISOLATOR - PTH-S-50S"). Only accept it when every part-code token
        // agrees, so two isolators with different codes never cross-match.
        const nToks = new Set(tokenize(s.name));
        const shared = dToks.filter((t) => nToks.has(t));
        const sharedCodes = dCodes.filter((c) => nToks.has(c));
        if (dCodes.length > 0 && sharedCodes.length === dCodes.length && shared.length >= 2) {
          sc = 100 + shared.length * 10 + sharedCodes.length * 30;
        } else if (dCodes.length === 0 && dToks.length >= 2 && shared.length === dToks.length) {
          // No code to key on (e.g. "ANGLE BAR"): require every word present.
          sc = 80 + shared.length * 10;
        }
      }
      if (sc > score) { score = sc; best = s.id; }
    }
    if (!best) return "";
    // Route to the department's location: among the matched item's rows (same
    // name or SKU), pick the Plant/Office row per policy. A single-location item
    // is unchanged.
    const bestRow = stockItems.find((s) => s.id === best);
    if (!bestRow) return best;
    const siblings = stockItems.filter((s) => canon(s.name) === canon(bestRow.name) || (!!bestRow.sku && s.sku === bestRow.sku));
    return pickIssueRow(siblings, dept)?.id ?? best;
  };
  const nameOf = (id: string) => stockItems.find((s) => s.id === id)?.name ?? "";
  const locOf = (id: string) => stockItems.find((s) => s.id === id)?.location ?? null;
  const verb = selectable ? "released from" : "received into"; // selectable = the release flow
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
                <option key={s.id} value={s.id}>{s.name} ({s.unit}){s.location ? ` · ${s.location}` : ""}</option>
              ))}
            </select>
            <Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Qty" value={rows[i].qty} disabled={selectable && !rows[i].checked} onChange={(e) => set(i, "qty", e.target.value)} />
            {/* Confirmation of exactly which stock item gets the quantity. */}
            {(!selectable || rows[i].checked) && (
              <span className="w-full pl-6 text-[11px]">
                {rows[i].stockItemId && Number(rows[i].qty) > 0 ? (
                  <span className="text-muted-foreground">→ {rows[i].qty} {verb} <span className="font-medium text-foreground">{nameOf(rows[i].stockItemId)}</span>{locOf(rows[i].stockItemId) ? ` · ${locOf(rows[i].stockItemId)}` : ""}</span>
                ) : (
                  <span className="text-amber-600">→ not matched to a stock item — nothing will be posted for this line</span>
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
