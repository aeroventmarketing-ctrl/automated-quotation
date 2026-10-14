/**
 * The order's Client Due Date — the date the client expects the order.
 *
 * The owner: *"In phase 1 box at the farthest right side put a word 'Client Due
 * Date' put a date picker below the word. This addition will help us monitor
 * the client due."* Then: *"wire Client Due date in order workflow to purchase
 * plan … Gray out the client due date in purchase plan, Editing client due date
 * will be available only in order workflow. Do not remove the history link in
 * purchase plan and add history link in order workflow."*
 *
 * So the ORDER holds the one client due date. The Purchase Plan shows it on
 * every MRF row of that order, read-only, with the same history.
 *
 * Stored on the quotation's classification as `clientDue` — its own key, beside
 * the workflow, never inside it: it is a date to watch, not a step, so it
 * changes nothing about who acts or when. `history` is append-only, newest
 * first, written in the same statement as the date (see the action). Who may
 * set it is the owner's ruling for a client due date
 * (`purchaserPlanAccess().canEditClientDue`: Admin, Engineer, Payment Approver,
 * Sales).
 *
 * Pure.
 */
export interface ClientDueChange {
  /** YYYY-MM-DD, or "" for blank. */
  from: string;
  to: string;
  byName: string;
  at: string;
}

export interface OrderClientDue {
  /** YYYY-MM-DD, or null once cleared. */
  date: string | null;
  byName: string;
  /** ISO — when it was last set. */
  at: string;
  /** Every change, newest first. */
  history: ClientDueChange[];
}

export const isYMD = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function readClientDue(classification: unknown): OrderClientDue | null {
  const v = (classification as Record<string, unknown> | null)?.clientDue as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object") return null;
  const history: ClientDueChange[] = Array.isArray(v.history)
    ? (v.history as unknown[])
        .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
        .map((h) => ({ from: str(h.from), to: str(h.to), byName: str(h.byName), at: str(h.at) }))
    : [];
  const date = isYMD(v.date) ? v.date : null;
  if (!date && history.length === 0) return null;
  return { date, byName: str(v.byName), at: str(v.at), history };
}

/** "Oct 17, 2026 → Oct 20, 2026", "set to Oct 17, 2026", "cleared (was …)". */
export function describeClientDueChange(c: Pick<ClientDueChange, "from" | "to">, fmt: (ymd: string) => string): string {
  if (!c.from) return `Set to ${fmt(c.to)}`;
  if (!c.to) return `Cleared (was ${fmt(c.from)})`;
  return `${fmt(c.from)} → ${fmt(c.to)}`;
}
