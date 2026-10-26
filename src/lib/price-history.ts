/**
 * Price movement of stock items — the unit cost and selling price over time.
 *
 * The owner, on the Inventory tab: *"Monitor the price movement of each items in
 * inventory, show the date of price movement, show who edited or changed the
 * price and when."*
 *
 * Every price write logs a row (`StockPriceChange`, migration 0062, via
 * `logPriceChange`). Before that table existed nothing was logged, so the
 * history is seeded from the one record that did survive: the approved Edit
 * requests (`StockAction`, kind EDIT), which carry the prices they set, who
 * proposed them and who signed. Changes made outside that chain before the log
 * started (a direct set, an import) cannot be recovered.
 */

export interface Prices {
  unitCost: number;
  sellPrice: number;
}

export type PriceSource = "approval" | "direct" | "import" | "create" | "merge";

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  approval: "Approved edit",
  direct: "Set directly",
  import: "Excel import",
  create: "New item",
  merge: "Merged duplicates",
};

export interface PriceHistoryEntry {
  id: string;
  stockItemId: string;
  itemName: string;
  sku: string | null;
  /** ISO timestamp the new price took effect. */
  at: string;
  /** Null when there was no earlier price on record (a new item, or the first approved edit found). */
  oldUnitCost: number | null;
  newUnitCost: number;
  oldSellPrice: number | null;
  newSellPrice: number;
  source: PriceSource;
  byName: string;
  approvedByName: string | null;
  note: string | null;
  /** Rebuilt from an approved Edit request, not from the log. */
  fromApprovals: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function coercePriceSource(v: unknown): PriceSource {
  return v === "approval" || v === "direct" || v === "import" || v === "create" || v === "merge" ? v : "direct";
}

/** Did either price move? Compared to the centavo, as the columns store it. */
export function pricesDiffer(a: Prices, b: Prices): boolean {
  return round2(a.unitCost) !== round2(b.unitCost) || round2(a.sellPrice) !== round2(b.sellPrice);
}

/** Percent change old → new, one decimal; null when there's no old price to compare to. */
export function pctChange(oldV: number | null, newV: number): number | null {
  if (oldV == null || oldV <= 0) return null;
  return Math.round(((newV - oldV) / oldV) * 1000) / 10;
}

/**
 * "Approved by" for an Edit request: the people who signed it, in order, less the
 * proposer (their own slot is filled by proposing). Empty → it applied on the
 * spot (raised by the Admin / Payment Approver, the final approver).
 */
export function approvalSigners(proposedByName: string, signers: (string | null | undefined)[]): string | null {
  const out: string[] = [];
  for (const s of signers) {
    const n = (s ?? "").trim();
    if (n && n !== proposedByName && !out.includes(n)) out.push(n);
  }
  return out.length ? out.join(", ") : null;
}

export interface AppliedEdit {
  id: string;
  stockItemId: string;
  itemName: string;
  payload: unknown;
  proposedByName: string;
  warehouseByName: string | null;
  purchaserByName: string | null;
  approverByName: string | null;
  appliedAt: Date | string | null;
}

function editPrices(payload: unknown): Prices | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const unitCost = Number(p.unitCost);
  const sellPrice = Number(p.sellPrice);
  if (!Number.isFinite(unitCost) || !Number.isFinite(sellPrice)) return null;
  return { unitCost, sellPrice };
}

/**
 * The price history before the log began, rebuilt from applied Edit requests.
 * Every Edit carries both prices, changed or not, so the edits are walked per
 * item in order and only those that moved a price are kept. The earliest one
 * found has nothing before it to compare to — it reads as "price on record".
 * Requests already in the log (`loggedActionIds`) are skipped, but still count
 * as the previous price for the next one.
 */
export function priceHistoryFromApprovals(edits: AppliedEdit[], loggedActionIds: Set<string>, sku: (stockItemId: string) => string | null = () => null): PriceHistoryEntry[] {
  const at = (e: AppliedEdit) => (e.appliedAt ? new Date(e.appliedAt).getTime() : NaN);
  const byItem = new Map<string, AppliedEdit[]>();
  for (const e of edits) {
    if (!Number.isFinite(at(e)) || !editPrices(e.payload)) continue;
    (byItem.get(e.stockItemId) ?? byItem.set(e.stockItemId, []).get(e.stockItemId)!).push(e);
  }
  const out: PriceHistoryEntry[] = [];
  for (const list of byItem.values()) {
    list.sort((a, b) => at(a) - at(b));
    let prev: Prices | null = null;
    for (const e of list) {
      const now = editPrices(e.payload)!;
      const moved = prev == null || pricesDiffer(prev, now);
      if (moved && !loggedActionIds.has(e.id)) {
        out.push({
          id: `approval:${e.id}`,
          stockItemId: e.stockItemId,
          itemName: e.itemName,
          sku: sku(e.stockItemId),
          at: new Date(at(e)).toISOString(),
          oldUnitCost: prev?.unitCost ?? null,
          newUnitCost: now.unitCost,
          oldSellPrice: prev?.sellPrice ?? null,
          newSellPrice: now.sellPrice,
          source: "approval",
          byName: e.proposedByName,
          approvedByName: approvalSigners(e.proposedByName, [e.warehouseByName, e.purchaserByName, e.approverByName]),
          note: null,
          fromApprovals: true,
        });
      }
      prev = now;
    }
  }
  return out;
}

/**
 * What a viewer may see of an entry: unit cost to those who see prices, the
 * selling price only to those who also see it (`showSellPrice` — hidden from the
 * Purchaser, Warehouse and Accounting). An entry that moved only a price the
 * viewer can't see is dropped. Null: nothing to show.
 */
export function maskPriceEntry(e: PriceHistoryEntry, see: { cost: boolean; sell: boolean }): PriceHistoryEntry | null {
  if (!see.cost && !see.sell) return null;
  const costMoved = e.oldUnitCost == null || round2(e.oldUnitCost) !== round2(e.newUnitCost);
  const sellMoved = e.oldSellPrice == null || round2(e.oldSellPrice) !== round2(e.newSellPrice);
  if (!((see.cost && costMoved) || (see.sell && sellMoved))) return null;
  return {
    ...e,
    ...(see.cost ? {} : { oldUnitCost: null, newUnitCost: 0 }),
    ...(see.sell ? {} : { oldSellPrice: null, newSellPrice: 0 }),
  };
}
