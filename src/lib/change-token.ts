/**
 * "Has anything changed?" — asked cheaply, so a page can refresh often without
 * re-reading the world.
 *
 * The auto-refreshing pages used to re-run their whole query on a timer whether
 * or not anything had happened. At eight seconds that is 450 refreshes an hour
 * per open tab, of which perhaps five return different data; `/orders` was
 * paying 3.2 MB for each of the other 445. That came to about **2.1 TB of
 * Supabase egress a month** and enough query load to take the app down.
 *
 * So the browser now polls a TOKEN instead — `max(updatedAt)` and a row count
 * per table, about a hundred bytes — and only does the real refresh when the
 * token moves. The result is faster than the old timer, not slower: a change
 * shows up within one poll of being made, rather than whenever the next
 * scheduled render happened to land.
 *
 * Two properties matter more than the saving:
 *
 *  1. **It fails OPEN.** If a token cannot be computed — a missing column, a
 *     database hiccup — this returns `UNKNOWN_TOKEN`, and the client falls back
 *     to refreshing on the timer exactly as before. A token that silently stops
 *     changing would leave a page frozen forever, which is far worse than a page
 *     that refreshes too often.
 *  2. **`count` is in the token, not just `max`.** A deletion moves no
 *     `updatedAt` anywhere; without the count, deleting a row would be invisible
 *     until something else happened to change.
 */
import { prisma } from "@/lib/db";

/** What a page watches. Each is one or more tables it is built from. */
export type ChangeScope = "orders" | "order-detail" | "purchasing" | "checks" | "requisitions" | "cash-requests" | "calendar" | "my-dashboard" | "management" | "approvals";

/**
 * The token could not be read, so the caller should behave as it did before —
 * refresh on the timer. Deliberately a constant rather than an empty string: an
 * empty token compared against an empty token looks like "nothing changed".
 */
export const UNKNOWN_TOKEN = "?";

/**
 * `key` narrows a counter to the ONE thing on screen, where a page has one — see
 * `oneQuotation`. Counters that watch a whole table ignore it.
 */
type Counter = (key?: string) => Promise<{ n: number; at: Date | null }>;

const quotations: Counter = async () => {
  const r = await prisma.quotation.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  return { n: r._count._all, at: r._max.updatedAt };
};
const purchaseRequests: Counter = async () => {
  const r = await prisma.purchaseRequest.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  return { n: r._count._all, at: r._max.updatedAt };
};

/**
 * ONE order's own row, rather than `max(updatedAt)` across every order.
 *
 * The order page shows a single order, but it was watching the whole `Quotation`
 * table — so anybody stamping a stage on ANY order re-rendered EVERY open order
 * page. And an order page is expensive to re-render: Postgres records it reading
 * the entire stock catalogue 14,174 times and the entire product catalogue 10,559
 * times, ~1,045 rows each, which together are 44% of all rows leaving the
 * database.
 *
 * Watching the row itself is strictly MORE correct than watching the table, not
 * a trade: this page's data is that row, its purchase requests and stock. An
 * unrelated order moving was never news here.
 *
 * `n` is 1 or 0 rather than a count, so a DELETED order still moves the token and
 * the page re-renders into its 404 instead of sitting there for good.
 *
 * With no key it falls back to the whole table — exactly what it did before. That
 * matters during a deploy: a browser still running the previous bundle asks
 * without an id, and must keep refreshing rather than freeze on a token that
 * never moves.
 */
const oneQuotation: Counter = async (key) => {
  if (!key) return quotations();
  const r = await prisma.quotation.findUnique({ where: { id: key }, select: { updatedAt: true } });
  return { n: r ? 1 : 0, at: r?.updatedAt ?? null };
};

/** …and the purchase requests raised against that one order — its Phase 4 chain. */
const purchaseRequestsOfOrder: Counter = async (key) => {
  if (!key) return purchaseRequests();
  const r = await prisma.purchaseRequest.aggregate({
    where: { quotationId: key },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  return { n: r._count._all, at: r._max.updatedAt };
};
const cashRequests: Counter = async () => {
  const r = await prisma.cashRequest.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  return { n: r._count._all, at: r._max.updatedAt };
};
const stockActions: Counter = async () => {
  const r = await prisma.stockAction.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  return { n: r._count._all, at: r._max.updatedAt };
};
const schedules: Counter = async () => {
  const r = await prisma.schedule.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  return { n: r._count._all, at: r._max.updatedAt };
};
/**
 * Stock levels, watched directly rather than through `stockActions`.
 *
 * Most quantity changes do write a StockAction, but not all of them: an admin
 * editing an item's reorder level, name or unit on the Inventory page writes
 * only the StockItem. The Management Dashboard's low-stock card is built from
 * exactly those fields, so watching the movements alone would leave it stale
 * until something unrelated happened to move.
 */
const stockItems: Counter = async () => {
  const r = await prisma.stockItem.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  return { n: r._count._all, at: r._max.updatedAt };
};
/**
 * The key/value settings table — watched only by the approver alarm.
 *
 * Four of its rows decide whether the alarm rings at all: the notifications
 * on/off switch, the workflow role assignments, the notification baseline and
 * the alerts go-live moment. None of them is a table of its own, and an admin
 * turning notifications off must not leave sirens going for everyone still
 * holding the old token.
 *
 * It is a small table read by key everywhere else, so one aggregate over it is
 * cheap — and it is the difference between "the alarm asks before it fetches"
 * being an optimisation and being a bug.
 */
const appSettings: Counter = async () => {
  const r = await prisma.appSetting.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  return { n: r._count._all, at: r._max.updatedAt };
};

/**
 * Which tables each page is built from.
 *
 * Err towards including a table rather than leaving it out: a scope that watches
 * one table too many refreshes a little more often than it needs to, while one
 * that misses a table shows stale data and looks broken.
 */
const SCOPES: Record<ChangeScope, Counter[]> = {
  orders: [quotations],
  /**
   * One order, open on screen — the busiest page in the app and, at eight
   * seconds, the fastest refresh in it. Rebuilding it means the whole workflow,
   * the job orders, the MRFs, the purchasing chain, stock availability and the
   * commission, all recomputed.
   *
   * FOUR tables, because an order page is not built from one. Almost everything
   * on it lives in `Quotation.classification` — every stage stamp, job order,
   * material request and delivery batch — but the Phase 4 chain is
   * `PurchaseRequest` rows, and the MRF panels show live stock availability,
   * which moves when material is issued (`StockAction`) or an item is edited
   * directly (`StockItem`).
   *
   * Leaving any of them out would freeze one panel of a page whose whole purpose
   * is showing several departments what the others have just done.
   */
  "order-detail": [oneQuotation, purchaseRequestsOfOrder, stockActions, stockItems],
  purchasing: [purchaseRequests],
  checks: [purchaseRequests],
  requisitions: [purchaseRequests],
  "cash-requests": [cashRequests],
  calendar: [schedules],
  // The one screen that genuinely spans the app.
  "my-dashboard": [quotations, purchaseRequests, cashRequests, stockActions],
  /**
   * The Management Dashboard — the widest read in the app, and until now the
   * only list page still refreshing on a plain timer. At 60 seconds that is 60
   * full renders an hour per open tab, each one rebuilding the P&L, the
   * receivables, the vouchers and the commissions whether or not a single row
   * had moved.
   *
   * `User` is deliberately left out. The page reads it only for names beside
   * figures, and a renamed member of staff showing their old name until the next
   * order or payment moves is not a stale dashboard — it is not worth a sixth
   * aggregate on every poll.
   */
  management: [quotations, purchaseRequests, cashRequests, stockActions, stockItems, schedules],
  /**
   * The approver alarm — mounted in the app-wide layout, so it polls from every
   * page, for every signed-in user, all day.
   *
   * It was the last surface in the app still fetching on a plain timer, and by
   * far the most expensive one to fetch: `pendingApprovalsForUser` reads EVERY
   * confirmed order and EVERY line item of every confirmed order, and its own
   * comment records it as the top query by bytes in the database. At 30 seconds
   * that is ~120 of those an hour per open tab, of which almost all return the
   * same answer as the one before.
   *
   * Two tables, and the second is not optional: `AppSetting` holds the
   * notifications switch, the role assignments, the notification baseline and
   * the go-live moment, all four of which change whether the alarm rings.
   * Watching only `Quotation` would leave an admin's "turn notifications off"
   * ignored until somebody happened to touch an order.
   */
  approvals: [quotations, appSettings],
};

export function isChangeScope(v: string | null | undefined): v is ChangeScope {
  return !!v && Object.prototype.hasOwnProperty.call(SCOPES, v);
}

/** Build a token from what each table reports. Pure, so it can be tested alone. */
export function tokenFrom(parts: Array<{ n: number; at: Date | null }>): string {
  return parts.map((p) => `${p.n}:${p.at ? p.at.getTime() : 0}`).join("|");
}

/**
 * The current token for a scope, or `UNKNOWN_TOKEN` if it cannot be read.
 *
 * `key` names the one record on screen, for a scope built around one — today
 * only `order-detail`, which passes the order's id. Scopes that watch whole
 * tables ignore it, and a scope that WANTS one falls back to the whole table
 * without it (see `oneQuotation`), so an unkeyed request is never worse than
 * the behaviour this replaced.
 */
export async function changeToken(scope: ChangeScope, key?: string): Promise<string> {
  try {
    return tokenFrom(await Promise.all(SCOPES[scope].map((c) => c(key))));
  } catch (e) {
    // Fail open: the caller refreshes on its timer, as it always did.
    console.error("change token unavailable", scope, e);
    return UNKNOWN_TOKEN;
  }
}
