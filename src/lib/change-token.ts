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
export type ChangeScope = "orders" | "purchasing" | "checks" | "requisitions" | "cash-requests" | "calendar" | "my-dashboard";

/**
 * The token could not be read, so the caller should behave as it did before —
 * refresh on the timer. Deliberately a constant rather than an empty string: an
 * empty token compared against an empty token looks like "nothing changed".
 */
export const UNKNOWN_TOKEN = "?";

type Counter = () => Promise<{ n: number; at: Date | null }>;

const quotations: Counter = async () => {
  const r = await prisma.quotation.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  return { n: r._count._all, at: r._max.updatedAt };
};
const purchaseRequests: Counter = async () => {
  const r = await prisma.purchaseRequest.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
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
 * Which tables each page is built from.
 *
 * Err towards including a table rather than leaving it out: a scope that watches
 * one table too many refreshes a little more often than it needs to, while one
 * that misses a table shows stale data and looks broken.
 */
const SCOPES: Record<ChangeScope, Counter[]> = {
  orders: [quotations],
  purchasing: [purchaseRequests],
  checks: [purchaseRequests],
  requisitions: [purchaseRequests],
  "cash-requests": [cashRequests],
  calendar: [schedules],
  // The one screen that genuinely spans the app.
  "my-dashboard": [quotations, purchaseRequests, cashRequests, stockActions],
};

export function isChangeScope(v: string | null | undefined): v is ChangeScope {
  return !!v && Object.prototype.hasOwnProperty.call(SCOPES, v);
}

/** Build a token from what each table reports. Pure, so it can be tested alone. */
export function tokenFrom(parts: Array<{ n: number; at: Date | null }>): string {
  return parts.map((p) => `${p.n}:${p.at ? p.at.getTime() : 0}`).join("|");
}

/** The current token for a scope, or `UNKNOWN_TOKEN` if it cannot be read. */
export async function changeToken(scope: ChangeScope): Promise<string> {
  try {
    return tokenFrom(await Promise.all(SCOPES[scope].map((c) => c())));
  } catch (e) {
    // Fail open: the caller refreshes on its timer, as it always did.
    console.error("change token unavailable", scope, e);
    return UNKNOWN_TOKEN;
  }
}
