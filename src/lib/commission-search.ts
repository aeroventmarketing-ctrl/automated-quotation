/**
 * Finding one commission among hundreds — by order number or client name.
 *
 * The owner: *"add a search bar so I can search by order number and client
 * name"*. Those two fields and no others, which is a deliberate narrowing: the
 * Commissions page shows a card per salesperson per month, so the salesperson is
 * already the heading you scroll to, and the month is written beside it. What is
 * hard to find is the ROW — one order among seventeen, on one of a dozen cards.
 *
 * Nothing here touches money. It decides which rows are on screen; every peso is
 * still computed server-side from the confirmed sales, and a voucher still
 * recomputes its own lines. A search that matched nothing would hide rows, never
 * change one.
 */

/** Lower-cased, collapsed whitespace — what a human typed, tidied. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Letters and digits only.
 *
 * Order numbers are written `2026 - AFBM00003264S` but spoken and typed
 * `AFBM00003264` or `2026-AFBM00003264S`. Without this pass, the separators a
 * person did or didn't type decide whether their own order number finds it —
 * which reads as the search being broken.
 */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The text a row can be found by: its order number and its client.
 *
 * Built once per row on render rather than per keystroke — a card of 17 rows
 * re-tested on every character otherwise rebuilds the same strings each time.
 */
export function dealHaystack(refLabel: string, company: string): string {
  return norm(`${refLabel} ${company}`);
}

/**
 * Does this row match what was typed?
 *
 * Two passes, either of which is a hit:
 *
 *  1. **Plain substring** — `ternion` finds TERNION ENGINEERING COMPANY, and
 *     `eng` finds it too. Every word the user sees is searchable as they see it.
 *  2. **Alphanumeric** — `afbm00003264` finds `2026 - AFBM00003264S`, and so
 *     does `2026-AFBM00003264S`, because both sides lose their punctuation.
 *
 * Multiple words are ANDed, so `ternion 3264` narrows rather than widens — the
 * behaviour of every other search box in this app.
 *
 * An empty or whitespace-only query matches EVERYTHING. That matters: it is what
 * makes clearing the box restore the page rather than empty it.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = norm(query);
  if (!q) return true;

  const squashedHay = squash(haystack);
  return q.split(" ").every((term) => {
    if (haystack.includes(term)) return true;
    const st = squash(term);
    return st.length > 0 && squashedHay.includes(st);
  });
}
