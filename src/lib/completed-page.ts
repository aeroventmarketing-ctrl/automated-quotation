/**
 * The three "Completed" boxes — Purchasing's completed department POs,
 * Requisitions' completed requisitions, and the settled cash vouchers — and how
 * much of their history a page load carries.
 *
 * ## Why they are paged at all
 *
 * All three are collapsed by default, and all three were built by sending the
 * ENTIRE completed history into the page: every finished purchase order, with
 * its PO lines, chain log, reconciliation and returns, on every render. A
 * finished purchase request is ~1.6 kB in the test fixture and rather more in
 * real life, where a PO carries a dozen lines and a settled reconciliation.
 *
 * These are also the three pages that carry `<AutoRefresh seconds={8}>`. So the
 * cost is not one page load: it is the whole archive, every eight seconds, for
 * every open tab — to draw a bar that says "Completed requisitions (N)" and, in
 * the overwhelming majority of loads, is never opened at all.
 *
 * ## How the paging works
 *
 * A page load carries the newest {@link COMPLETED_PAGE} of them, plus the true
 * total from a `count()` — so the bar still says how many there are — and the
 * box says "25 of 312" rather than pretending 25 is all of them.
 *
 * "Show all" is a LINK that adds `?completed=all`, not a fetch. The server
 * component then loads the lot. That matters for more than simplicity: these
 * rows are built with the viewer's roles, the names behind each step, the
 * voucher numbers and the supplier terms all folded in, and a second builder
 * inside a "load more" action would be a second copy of that context to keep in
 * step. There is exactly one builder, and the page already re-renders on a timer,
 * so the expanded view refreshes like any other.
 *
 * The search box then filters everything, exactly as it did before — which is
 * why the control loads the REST rather than the next 25. A half-loaded list
 * behind a search box answers "no matches" when it means "not here yet".
 */

/** How many completed rows a normal page load carries. */
export const COMPLETED_PAGE = 25;

/**
 * Does this request ask for the whole completed history?
 *
 * A deep link to a specific row (`?req=` / `?id=`) counts as YES: the row it
 * names may be any age, and a notification that lands on an empty box is worse
 * than a slow one. Deep links are rare; the timer-driven loads that dominate the
 * egress are not.
 */
export function wantsAllCompleted(sp: { completed?: string } | undefined, highlightId?: string): boolean {
  return sp?.completed === "all" || !!highlightId;
}
