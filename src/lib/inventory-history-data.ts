/**
 * Server side of the Inventory history: loads the stock-movement ledger and the
 * price movements, and logs price changes. See lib/stock-history and
 * lib/price-history for the rules.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { classifyMovement, matchPurchaseReceipt, type MovementCategory } from "@/lib/stock-history";
import {
  coercePriceSource,
  maskPriceEntry,
  pricesDiffer,
  priceHistoryFromApprovals,
  type PriceHistoryEntry,
  type PriceSource,
  type Prices,
} from "@/lib/price-history";

// --- Logging price changes ---------------------------------------------------

type Db = Pick<Prisma.TransactionClient, "$queryRaw" | "stockPriceChange">;

export interface PriceChangeInput {
  item: { id: string; name: string; sku: string | null };
  /** Null for a new item. */
  before: Prices | null;
  after: Prices;
  source: PriceSource;
  byName: string;
  approvedByName?: string | null;
  stockActionId?: string | null;
  note?: string | null;
}

/**
 * Record a price change — a no-op when neither price moved, or when migration
 * 0062 hasn't been applied yet. The table is checked first rather than the
 * insert being caught: inside a transaction a failed statement would abort the
 * very price edit it was logging.
 */
export async function logPriceChange(db: Db, c: PriceChangeInput): Promise<void> {
  if (c.before && !pricesDiffer(c.before, c.after)) return;
  if (!c.before && c.after.unitCost <= 0 && c.after.sellPrice <= 0) return; // a new, unpriced item
  const [row] = await db.$queryRaw<{ ok: boolean }[]>`select to_regclass('public."StockPriceChange"') is not null as ok`;
  if (!row?.ok) return;
  await db.stockPriceChange.create({
    data: {
      stockItemId: c.item.id,
      itemName: c.item.name,
      sku: c.item.sku,
      oldUnitCost: c.before?.unitCost ?? null,
      newUnitCost: c.after.unitCost,
      oldSellPrice: c.before?.sellPrice ?? null,
      newSellPrice: c.after.sellPrice,
      source: c.source,
      byName: c.byName,
      approvedByName: c.approvedByName ?? null,
      stockActionId: c.stockActionId ?? null,
      note: c.note ?? null,
    },
  });
}

// --- Filters -------------------------------------------------------------------

export interface HistoryFilter {
  /** One item (the per-item History button). */
  itemId?: string;
  /** Item name or SKU contains. */
  q?: string;
  /** Inclusive start, YYYY-MM-DD. */
  from?: string;
  /** Inclusive end, YYYY-MM-DD. */
  to?: string;
  /** Who moved / changed it, contains. */
  by?: string;
  category?: MovementCategory | "reserve" | "";
}

const MANILA_OFFSET = "+08:00";
function dateRange(f: HistoryFilter): { gte?: Date; lt?: Date } {
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const out: { gte?: Date; lt?: Date } = {};
  if (ok(f.from)) out.gte = new Date(`${f.from}T00:00:00${MANILA_OFFSET}`);
  if (ok(f.to)) out.lt = new Date(new Date(`${f.to}T00:00:00${MANILA_OFFSET}`).getTime() + 86_400_000);
  return out;
}

function itemWhere(f: HistoryFilter): Prisma.StockItemWhereInput | undefined {
  const q = (f.q ?? "").trim();
  if (!q) return undefined;
  return { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] };
}

// --- Stock movements ---------------------------------------------------------

export interface StockHistoryRow {
  id: string;
  at: string;
  stockItemId: string;
  itemName: string;
  sku: string | null;
  unit: string;
  location: string | null;
  category: MovementCategory | "reserve";
  label: string;
  where: string | null;
  /** Signed quantity: + added, − deducted. Reservations carry their quantity, unsigned. */
  qty: number;
  /** On hand after the movement; null for a reservation (on hand doesn't change). */
  balanceAfter: number | null;
  /** What the person typed (the system's own wording is already in label / where). */
  note: string | null;
  /** The ledger's reason, verbatim — for the export. */
  reason: string | null;
  byName: string;
  /** The document it moved on — order, MRF, PO, counter sale. */
  ref: { label: string; href?: string } | null;
}

export interface StockHistoryResult {
  rows: StockHistoryRow[];
  /** More matched than were loaded — narrow the dates. */
  truncated: boolean;
}

/** MRF form number → its order, read from the orders' workflow JSON. */
async function mrfOrders(formNos: string[]): Promise<Map<string, { id: string; quoteNumber: string | null }>> {
  const out = new Map<string, { id: string; quoteNumber: string | null }>();
  if (formNos.length === 0) return out;
  try {
    const rows = await prisma.$queryRaw<{ id: string; quoteNumber: string | null; formNo: string }[]>`
      select q.id, q."quoteNumber", m->>'formNo' as "formNo"
      from "Quotation" q,
        jsonb_array_elements(
          case when jsonb_typeof(q.classification->'workflow'->'materialRequests') = 'array'
               then q.classification->'workflow'->'materialRequests' else '[]'::jsonb end
        ) m
      where m->>'formNo' = any(${formNos})`;
    for (const r of rows) out.set(r.formNo, { id: r.id, quoteNumber: r.quoteNumber });
  } catch {
    /* the history still shows the MRF number */
  }
  return out;
}

export async function loadStockHistory(f: HistoryFilter, limit = 500): Promise<StockHistoryResult> {
  const range = dateRange(f);
  const at = range.gte || range.lt ? range : undefined;
  const by = (f.by ?? "").trim();
  const iw = itemWhere(f);
  const wantMoves = f.category !== "reserve";
  const wantResv = !f.category || f.category === "reserve";
  // Category is read from the reason text, so it's filtered after loading —
  // load wider than the page shows.
  const fetchCap = f.category ? limit * 6 : limit + 1;

  const [moves, resvs] = await Promise.all([
    wantMoves
      ? prisma.stockMovement.findMany({
          where: {
            ...(f.itemId ? { stockItemId: f.itemId } : {}),
            ...(at ? { createdAt: at } : {}),
            ...(by ? { byName: { contains: by, mode: "insensitive" } } : {}),
            ...(iw ? { stockItem: iw } : {}),
          },
          include: { stockItem: { select: { name: true, sku: true, unit: true, location: true } } },
          orderBy: { createdAt: "desc" },
          take: fetchCap,
        })
      : Promise.resolve([]),
    wantResv
      ? prisma.stockReservation
          .findMany({
            where: {
              ...(f.itemId ? { stockItemId: f.itemId } : {}),
              ...(iw ? { stockItem: iw } : {}),
              ...(at || by
                ? {
                    OR: [
                      { ...(at ? { createdAt: at } : {}), ...(by ? { byName: { contains: by, mode: "insensitive" as const } } : {}) },
                      { ...(at ? { releasedAt: at } : { releasedAt: { not: null } }), ...(by ? { releasedByName: { contains: by, mode: "insensitive" as const } } : {}) },
                    ],
                  }
                : {}),
            },
            include: { stockItem: { select: { name: true, sku: true, unit: true, location: true } } },
            orderBy: { createdAt: "desc" },
            take: limit + 1,
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const rows: StockHistoryRow[] = [];
  const classified = moves.map((m) => ({ m, c: classifyMovement(m.kind, Number(m.delta), m.reason) }));
  const kept = f.category && f.category !== "reserve" ? classified.filter((x) => x.c.category === f.category) : classified;

  // References: MRF → order, order number → order, counter sale → sale, receipt → PO.
  const mrfNos = [...new Set(kept.map((x) => x.c.mrfNo).filter((s): s is string => !!s))];
  // A reservation's "for" is usually an order number — linked when it is one.
  const orderNos = [...new Set([...kept.map((x) => x.c.orderNo), ...resvs.map((r) => r.forRef.trim())].filter((s): s is string => !!s))];
  const saleNos = [...new Set(kept.map((x) => x.c.saleNo).filter((s): s is string => !!s))];
  const receiptTimes = kept.filter((x) => x.c.purchase).map((x) => x.m.createdAt.getTime());
  const [mrfMap, orders, sales, receipts] = await Promise.all([
    mrfOrders(mrfNos),
    orderNos.length
      ? prisma.quotation.findMany({ where: { quoteNumber: { in: orderNos } }, select: { id: true, quoteNumber: true } }).catch(() => [])
      : Promise.resolve([]),
    saleNos.length
      ? prisma.counterSale.findMany({ where: { saleNumber: { in: saleNos } }, select: { id: true, saleNumber: true } }).catch(() => [])
      : Promise.resolve([]),
    receiptTimes.length
      ? prisma.purchaseRequest
          .findMany({
            where: { receivedAt: { gte: new Date(Math.min(...receiptTimes) - 120_000), lte: new Date(Math.max(...receiptTimes) + 120_000) } },
            select: { id: true, receivedAt: true, receivedByName: true, po: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const orderId = new Map(orders.map((o) => [o.quoteNumber, o.id]));
  const saleId = new Map(sales.map((s) => [s.saleNumber, s.id]));
  const receiptList = receipts
    .filter((r) => r.receivedAt)
    .map((r) => ({ receivedAt: r.receivedAt as Date, receivedByName: r.receivedByName, id: r.id, poNumber: coercePurchaseOrder(r.po)?.poNumber ?? null }));

  for (const { m, c } of kept) {
    let ref: StockHistoryRow["ref"] = null;
    let where = c.where;
    if (c.mrfNo) {
      const o = mrfMap.get(c.mrfNo);
      ref = { label: `MRF #${c.mrfNo}${o?.quoteNumber ? ` · ${o.quoteNumber}` : ""}`, ...(o ? { href: `/orders/${o.id}` } : {}) };
    } else if (c.orderNo) {
      const id = orderId.get(c.orderNo);
      ref = { label: c.orderNo, ...(id ? { href: `/orders/${id}` } : {}) };
    } else if (c.saleNo) {
      const id = saleId.get(c.saleNo);
      ref = { label: c.saleNo, ...(id ? { href: `/counter-sales/${id}` } : {}) };
    } else if (c.purchase) {
      const r = matchPurchaseReceipt(m.createdAt, m.byName, receiptList);
      if (r?.poNumber) {
        ref = { label: r.poNumber };
        where = `${where} · ${r.poNumber}`;
      }
    }
    rows.push({
      id: m.id,
      at: m.createdAt.toISOString(),
      stockItemId: m.stockItemId,
      itemName: m.stockItem.name,
      sku: m.stockItem.sku,
      unit: m.stockItem.unit,
      location: m.stockItem.location,
      category: c.category,
      label: c.label,
      where,
      qty: Number(m.delta),
      balanceAfter: Number(m.balanceAfter),
      note: c.note ?? null,
      reason: m.reason,
      byName: m.byName,
      ref,
    });
  }

  // Reservations: on hand doesn't move, but they hold stock for an order and
  // are part of where it's going. One row when reserved, one when released.
  const inRange = (d: Date) => (!at?.gte || d >= at.gte) && (!at?.lt || d < at.lt);
  const byOk = (n: string | null) => !by || (n ?? "").toLowerCase().includes(by.toLowerCase());
  for (const r of resvs) {
    const resvOrder = orderId.get(r.forRef.trim());
    const base = {
      stockItemId: r.stockItemId,
      itemName: r.stockItem.name,
      sku: r.stockItem.sku,
      unit: r.stockItem.unit,
      location: r.stockItem.location,
      category: "reserve" as const,
      qty: Number(r.qty),
      balanceAfter: null,
      ref: { label: r.forRef, ...(resvOrder ? { href: `/orders/${resvOrder}` } : {}) },
    };
    if (inRange(r.createdAt) && byOk(r.byName)) {
      const valid = r.validUntil ? ` · valid until ${r.validUntil.toISOString().slice(0, 10)}` : "";
      const note = `${r.note ?? ""}${valid}`.replace(/^ · /, "") || null;
      rows.push({ ...base, id: `resv:${r.id}`, at: r.createdAt.toISOString(), label: "Reserved", where: "Set aside — still on hand", note, reason: note, byName: r.byName });
    }
    if (r.releasedAt && inRange(r.releasedAt) && byOk(r.releasedByName)) {
      rows.push({ ...base, id: `resv-rel:${r.id}`, at: r.releasedAt.toISOString(), label: "Reservation released", where: "Back to available", note: null, reason: null, byName: r.releasedByName ?? "" });
    }
  }

  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const truncated = rows.length > limit || moves.length >= fetchCap;
  return { rows: rows.slice(0, limit), truncated };
}

// --- Price movements ---------------------------------------------------------

export interface PriceHistoryResult {
  rows: PriceHistoryEntry[];
  /** Migration 0062 not applied: only the approved-edit history is shown. */
  logMissing: boolean;
  truncated: boolean;
}

export async function loadPriceHistory(f: HistoryFilter, see: { cost: boolean; sell: boolean }, limit = 500): Promise<PriceHistoryResult> {
  if (!see.cost && !see.sell) return { rows: [], logMissing: false, truncated: false };
  const range = dateRange(f);
  const at = range.gte || range.lt ? range : undefined;
  const by = (f.by ?? "").trim().toLowerCase();
  const q = (f.q ?? "").trim();

  let logged: PriceHistoryEntry[] = [];
  let loggedActionIds = new Set<string>();
  let logMissing = false;
  try {
    const rows = await prisma.stockPriceChange.findMany({
      where: {
        ...(f.itemId ? { stockItemId: f.itemId } : {}),
        ...(q ? { OR: [{ itemName: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    loggedActionIds = new Set(rows.map((r) => r.stockActionId).filter((s): s is string => !!s));
    logged = rows.map((r) => ({
      id: r.id,
      stockItemId: r.stockItemId,
      itemName: r.itemName,
      sku: r.sku,
      at: r.createdAt.toISOString(),
      oldUnitCost: r.oldUnitCost == null ? null : Number(r.oldUnitCost),
      newUnitCost: Number(r.newUnitCost),
      oldSellPrice: r.oldSellPrice == null ? null : Number(r.oldSellPrice),
      newSellPrice: Number(r.newSellPrice),
      source: coercePriceSource(r.source),
      byName: r.byName,
      approvedByName: r.approvedByName,
      note: r.note,
      fromApprovals: false,
    }));
  } catch {
    logMissing = true;
  }

  // The history before the log: approved Edit requests. Loaded across all dates
  // (each edit's "from" is the edit before it), filtered afterwards.
  let derived: PriceHistoryEntry[] = [];
  try {
    const iw = itemWhere(f);
    const ids = iw ? (await prisma.stockItem.findMany({ where: iw, select: { id: true } })).map((i) => i.id) : null;
    const edits = await prisma.stockAction.findMany({
      where: {
        kind: "EDIT",
        status: "APPLIED",
        ...(f.itemId ? { stockItemId: f.itemId } : ids ? { stockItemId: { in: ids } } : {}),
      },
      select: {
        id: true, stockItemId: true, itemName: true, payload: true, proposedByName: true,
        warehouseByName: true, purchaserByName: true, approverByName: true, appliedAt: true,
      },
    });
    const skus = new Map(
      (await prisma.stockItem.findMany({ where: { id: { in: [...new Set(edits.map((e) => e.stockItemId))] } }, select: { id: true, sku: true } })).map((i) => [i.id, i.sku]),
    );
    derived = priceHistoryFromApprovals(edits, loggedActionIds, (id) => skus.get(id) ?? null);
  } catch {
    /* StockAction not migrated — nothing to rebuild from */
  }

  const inRange = (iso: string) => {
    const d = new Date(iso);
    return (!at?.gte || d >= at.gte) && (!at?.lt || d < at.lt);
  };
  const all = [...logged, ...derived]
    .filter((e) => inRange(e.at))
    .filter((e) => !by || e.byName.toLowerCase().includes(by) || (e.approvedByName ?? "").toLowerCase().includes(by))
    .map((e) => maskPriceEntry(e, see))
    .filter((e): e is PriceHistoryEntry => e != null)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { rows: all.slice(0, limit), logMissing, truncated: all.length > limit };
}
