/**
 * The order's Client Due Date — the date the client expects the order.
 *
 * The owner: *"In phase 1 box at the farthest right side put a word 'Client Due
 * Date' put a date picker below the word. This addition will help us monitor
 * the client due."*
 *
 * Stored on the quotation's classification as `clientDue` — its own key, beside
 * the workflow, never inside it: it is a date to watch, not a step, so it
 * changes nothing about who acts or when. Who may set it is the owner's existing
 * ruling for a client due date (`purchaserPlanAccess().canEditClientDue`:
 * Admin, Engineer, Payment Approver, Sales).
 *
 * Pure.
 */
export interface OrderClientDue {
  /** YYYY-MM-DD. */
  date: string;
  byName: string;
  /** ISO — when it was last set. */
  at: string;
}

export const isYMD = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function readClientDue(classification: unknown): OrderClientDue | null {
  const v = (classification as Record<string, unknown> | null)?.clientDue as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object" || !isYMD(v.date)) return null;
  return {
    date: v.date,
    byName: typeof v.byName === "string" ? v.byName : "",
    at: typeof v.at === "string" ? v.at : "",
  };
}
