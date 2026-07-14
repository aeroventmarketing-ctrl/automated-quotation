/**
 * Purchaser reorder tracking. When the purchaser places a replenishment order for
 * a low/out stock item, the "on order" state (qty, who, when) rides in the
 * AppSetting key/value table keyed by stock-item id — no schema migration. When
 * the goods arrive, receiving records a RECEIPT movement and clears the entry.
 */
export const REORDER_KEY = "reorder_orders";

export interface ReorderEntry {
  qty: number;
  byName: string;
  at: string; // ISO timestamp
  note?: string;
}

export type ReorderMap = Record<string, ReorderEntry>;

/** Coerce arbitrary AppSetting JSON into a clean ReorderMap. */
export function coerceReorderMap(value: unknown): ReorderMap {
  if (!value || typeof value !== "object") return {};
  const out: ReorderMap = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const qty = Number(e.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out[id] = {
      qty,
      byName: typeof e.byName === "string" ? e.byName : "",
      at: typeof e.at === "string" ? e.at : "",
      note: typeof e.note === "string" ? e.note : undefined,
    };
  }
  return out;
}

/**
 * Suggested order quantity to bring stock back up to twice its reorder level.
 * Returns "" when there is no reorder level to base a suggestion on.
 */
export function suggestReorderQty(quantity: number, reorderLevel: number): string {
  if (!(reorderLevel > 0)) return "";
  const target = reorderLevel * 2;
  const need = Math.round((target - quantity) * 1000) / 1000;
  return need > 0 ? String(need) : String(reorderLevel);
}
