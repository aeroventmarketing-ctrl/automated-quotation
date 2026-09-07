/**
 * How many times the AI may be run against **one attachment**.
 *
 * The owner, looking at an order's *Payments Collected* rows: *"in AI reading,
 * allow unlimited number of rows but limit to 3 reads per row. In the first
 * picture, 1st to 3rd row the AI reading is allowed but after the 4th row it
 * message that it exceeded the AI reading."*
 *
 * Every reader in the app started with a budget belonging to the ORDER — one
 * number, spent by whichever row was read first. So an order with four payments
 * could read three of them and was told it had exhausted its allowance on the
 * fourth, which had never been read at all. The allowance was counting the wrong
 * thing.
 *
 * A try is a read, and an **attachment** is what has three of them. Rows are
 * unlimited: attach a fifth payment and it arrives with its own three.
 *
 * The counters are keyed by STORAGE PATH — the one thing that is unique per
 * attachment and stable across renames of everything around it. `slipValidations`
 * on the same classification is already keyed that way, so the count now sits
 * beside the stamp it belongs to.
 */

/** Reads used, by attachment path. */
export type ReadCounts = Record<string, number>;

const clamp = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

/** Read the map back off a classification blob, dropping anything malformed. */
export function coerceReadCounts(v: unknown): ReadCounts {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: ReadCounts = {};
  for (const [path, n] of Object.entries(v as Record<string, unknown>)) {
    const used = clamp(n);
    if (path && used > 0) out[path] = used;
  }
  return out;
}

/**
 * Reads this attachment has cost a limited reader.
 *
 * A read that FAILED costs nothing — it produced no answer to be tempted by, and
 * a run of server errors must not lock the one person who can fix the record out
 * of trying again. Nor does a read by someone with no limit: their reads are
 * outside the count, so looking at a slip on a colleague's behalf cannot spend
 * that colleague's allowance.
 */
export function readsUsed(counts: ReadCounts, path: string): number {
  return clamp(counts[path]);
}

/** Tries left on this attachment — `null` for a reader who has no limit. */
export function readsLeft(counts: ReadCounts, path: string, limit: number, opts?: { unlimited?: boolean }): number | null {
  if (opts?.unlimited) return null;
  return Math.max(0, limit - readsUsed(counts, path));
}

/** May this attachment be read (again) by this reader? */
export function canReadAgain(counts: ReadCounts, path: string, limit: number, opts?: { unlimited?: boolean }): boolean {
  const left = readsLeft(counts, path, limit, opts);
  return left === null || left > 0;
}

/**
 * The map after a SUCCESSFUL read — unchanged for a reader with no limit, one
 * more for everyone else.
 *
 * Returns a new object rather than mutating: the caller is usually spreading it
 * into a classification blob it is about to write.
 */
export function bumpReadCount(counts: ReadCounts, path: string, opts?: { unlimited?: boolean }): ReadCounts {
  if (opts?.unlimited) return { ...counts };
  return { ...counts, [path]: readsUsed(counts, path) + 1 };
}

/**
 * What to tell someone who has run out — naming the ROW, so it cannot be read as
 * "this order is finished with AI".
 */
export function readLimitMessage(limit: number, subject: string, who: string): string {
  return `This ${subject} has already been read ${limit} times — that is the limit per attachment. Check it by hand and type the figures, or ask ${who}. Every other row still has its own ${limit}.`;
}
