/**
 * Why the Inventory "Stock value" moved since a given moment.
 *
 * The owner: *"from 5 million plus yesterday it become 9 million plus in
 * inventory today. Please check"*. The tile is Σ quantity × unit cost over the
 * active items, and both halves are recorded whenever they change — every
 * quantity change is a stock movement (`StockMovement.delta`), every unit-cost
 * change a price movement (`StockPriceChange`, including the supplier-price sync
 * of #629). So the value at an earlier moment can be rebuilt exactly, per item:
 *
 *   quantity then  = quantity now − the movements since
 *   unit cost then = the OLD cost of the first price change since (else today's)
 *
 * and the change split into what came in / went out (valued at today's cost) and
 * what was re-priced (the earlier quantity × the cost difference). Pure.
 */
import { classifyMovement } from "@/lib/stock-history";

export interface ValueItem {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  location: string | null;
  quantity: number;
  unitCost: number;
  createdAt: Date | string;
}
export interface ValueMovement {
  stockItemId: string;
  kind: string;
  delta: number;
  reason: string | null;
  createdAt: Date | string;
}
export interface ValuePriceChange {
  stockItemId: string;
  oldUnitCost: number | null;
  newUnitCost: number;
  source: string;
  createdAt: Date | string;
}

/** What moved the quantity — the owner reads these, so they are plain words. */
export function movementCause(kind: string, reason: string | null): string {
  const r = (reason ?? "").trim();
  if (/^Bought — .*Cash & Check Released/i.test(r)) return "Bought — added at Cash & Check Released (not usable yet)";
  if (/^PO-?\S* .*bought stock taken back out|not delivered; bought stock taken back out/i.test(r)) return "Bought stock taken back out (not delivered / rolled back)";
  if (/^Purchase received early/i.test(r)) return "Received from purchases (early)";
  return classifyMovement(kind, Number(kind === "ISSUE" ? -1 : 1), reason).label;
}

export interface ItemValueChange {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  location: string | null;
  qtyThen: number;
  qtyNow: number;
  costThen: number;
  costNow: number;
  valueThen: number;
  valueNow: number;
  change: number;
  /** Quantity in/out since, valued at today's unit cost. */
  qtyEffect: number;
  /** Re-pricing: the earlier quantity × (today's cost − the earlier cost). */
  costEffect: number;
  /** Created since — all of its value is new. */
  isNew: boolean;
  /** Quantity moves since, by cause. */
  causes: { cause: string; qty: number; value: number; count: number }[];
  priceSources: string[];
}

export interface ValueChangeReport {
  valueThen: number;
  valueNow: number;
  change: number;
  /** Σ over items, by cause (value at today's cost). */
  byCause: { cause: string; value: number; count: number }[];
  costEffect: number;
  newItemsValue: number;
  items: ItemValueChange[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const t = (d: Date | string) => new Date(d).getTime();

export function stockValueChange(
  items: readonly ValueItem[],
  movements: readonly ValueMovement[],
  prices: readonly ValuePriceChange[],
  since: Date,
): ValueChangeReport {
  const from = since.getTime();
  const movesBy = new Map<string, ValueMovement[]>();
  for (const m of movements) if (t(m.createdAt) >= from) (movesBy.get(m.stockItemId) ?? movesBy.set(m.stockItemId, []).get(m.stockItemId)!).push(m);
  const pricesBy = new Map<string, ValuePriceChange[]>();
  for (const p of [...prices].sort((a, b) => t(a.createdAt) - t(b.createdAt))) {
    if (t(p.createdAt) >= from) (pricesBy.get(p.stockItemId) ?? pricesBy.set(p.stockItemId, []).get(p.stockItemId)!).push(p);
  }
  const out: ItemValueChange[] = [];
  const causeTotals = new Map<string, { value: number; count: number }>();
  let costEffect = 0;
  let newItemsValue = 0;
  for (const it of items) {
    const moves = movesBy.get(it.id) ?? [];
    const pc = pricesBy.get(it.id) ?? [];
    const isNew = t(it.createdAt) >= from;
    const qtyNow = it.quantity;
    const costNow = it.unitCost;
    const qtyThen = isNew ? 0 : r3(qtyNow - moves.reduce((a, m) => a + m.delta, 0));
    const costThen = isNew ? 0 : pc.length ? (pc[0].oldUnitCost ?? 0) : costNow;
    const valueThen = r2(qtyThen * costThen);
    const valueNow = r2(qtyNow * costNow);
    const change = r2(valueNow - valueThen);
    if (Math.abs(change) < 0.005 && moves.length === 0 && pc.length === 0) continue;
    const qtyEffect = isNew ? valueNow : r2((qtyNow - qtyThen) * costNow);
    const ce = isNew ? 0 : r2(qtyThen * (costNow - costThen));
    const causes = new Map<string, { qty: number; value: number; count: number }>();
    for (const m of moves) {
      const c = isNew ? "New item" : movementCause(m.kind, m.reason);
      const e = causes.get(c) ?? { qty: 0, value: 0, count: 0 };
      e.qty = r3(e.qty + m.delta);
      e.value = r2(e.value + m.delta * costNow);
      e.count++;
      causes.set(c, e);
    }
    if (isNew) {
      newItemsValue = r2(newItemsValue + valueNow);
      const e = causeTotals.get("New item (created since)") ?? { value: 0, count: 0 };
      causeTotals.set("New item (created since)", { value: r2(e.value + valueNow), count: e.count + 1 });
    } else {
      for (const [c, e] of causes) {
        const tot = causeTotals.get(c) ?? { value: 0, count: 0 };
        causeTotals.set(c, { value: r2(tot.value + e.value), count: tot.count + e.count });
      }
      costEffect = r2(costEffect + ce);
    }
    out.push({
      id: it.id, name: it.name, sku: it.sku, unit: it.unit, location: it.location,
      qtyThen, qtyNow, costThen, costNow, valueThen, valueNow, change, qtyEffect, costEffect: ce, isNew,
      causes: [...causes].map(([cause, e]) => ({ cause, ...e })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      priceSources: [...new Set(pc.map((p) => p.source))],
    });
  }
  const valueNow = r2(items.reduce((a, i) => a + i.quantity * i.unitCost, 0));
  const valueThen = r2(valueNow - out.reduce((a, i) => a + i.change, 0));
  return {
    valueThen,
    valueNow,
    change: r2(valueNow - valueThen),
    byCause: [...causeTotals].map(([cause, e]) => ({ cause, ...e })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    costEffect,
    newItemsValue,
    items: out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
  };
}
