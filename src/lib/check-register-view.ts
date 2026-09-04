/**
 * Searching, sorting and grouping the check register.
 *
 * The owner, once the register passed fifty rows: *"add a search bar, sort and
 * group by ascending and descending. Make the default arrangement by clearing
 * date, top most is the soonest to clear."*
 *
 * Kept out of the table component because it is the part with rules in it — what
 * a search matches, where an undated row lands, what a group is worth — and a
 * rule buried in a `.map()` is a rule nobody can check.
 */
import { normalizeCheckNo } from "@/lib/voucher-check";
import type { CheckWatchRow } from "@/lib/check-monitor";

export type CheckSortKey = "poDate" | "company" | "poNumber" | "checkNo" | "amount" | "clearing" | "form" | "status";
export type SortDir = "asc" | "desc";
export type CheckGroupBy = "none" | "company" | "status" | "month";

/**
 * *"the default arrangement by clearing date, top most is the soonest to
 * clear."* Ascending, because the soonest date is the smallest one.
 */
export const DEFAULT_CHECK_SORT: { key: CheckSortKey; dir: SortDir } = { key: "clearing", dir: "asc" };

export const CHECK_SORT_LABEL: Record<CheckSortKey, string> = {
  poDate: "Date",
  company: "Company",
  poNumber: "Purchase Order Number",
  checkNo: "Check No.",
  amount: "Amount",
  clearing: "Date Paid/Cleared",
  form: "Form of Payment",
  status: "Status",
};

export const CHECK_GROUP_LABEL: Record<CheckGroupBy, string> = {
  none: "No grouping",
  company: "Company",
  status: "Status",
  month: "Clearing month",
};

/**
 * Everything on the row a person might type into the box, as one string.
 *
 * The check number goes in TWICE — as printed and stripped of its padding —
 * because someone reading the check types `0000486723` and someone reading the
 * register types `486723`, and both have to find it.
 */
function haystack(r: CheckWatchRow): string {
  const parts = [
    r.supplier, r.poNumber, r.checkNo ?? "", r.checkNo ? normalizeCheckNo(r.checkNo) : "",
    r.statusLabel, r.form, r.remarks ?? "", r.poDate ?? "", r.clearingYMD ?? "", r.clearedOn ?? "",
    r.clearedByName ?? "", r.orderId ?? "",
    // The amount both as stored and as printed, so "28,344.64" and "28344.64"
    // both land.
    r.amount != null ? String(r.amount) : "",
    r.amount != null ? r.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 }) : "",
  ];
  return parts.join(" ").toLowerCase();
}

/** Rows matching every whitespace-separated term. Empty query keeps everything. */
export function searchCheckRows(rows: CheckWatchRow[], query: string): CheckWatchRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((r) => {
    const hay = haystack(r);
    // EVERY term, not any: typing "tozen oct" should narrow, not widen.
    return terms.every((t) => hay.includes(t));
  });
}

/** The value a column sorts on. Null means "this row has nothing to sort by". */
function sortValue(r: CheckWatchRow, key: CheckSortKey): string | number | null {
  switch (key) {
    case "poDate": return r.poDate;
    case "company": return r.supplier ? r.supplier.toLowerCase() : null;
    case "poNumber": return r.poNumber && r.poNumber !== "—" ? r.poNumber.toLowerCase() : null;
    // By the digits that identify the check, so padding never decides the order.
    case "checkNo": return r.checkNo ? Number(normalizeCheckNo(r.checkNo)) || 0 : null;
    case "amount": return r.amount;
    case "clearing": return r.state === "cleared" ? r.clearedOn ?? r.clearingYMD : r.clearingYMD;
    case "form": return r.form.toLowerCase();
    case "status": return r.statusLabel.toLowerCase();
  }
}

/**
 * Sorted, without mutating the input.
 *
 * **A row with nothing to sort by always sinks**, in both directions. An undated
 * check and a PO whose check is not yet written have no day; floating them to
 * the top of a descending sort would bury the dated rows that the screen exists
 * to watch. The tie-break is the PO number, so the order is stable and
 * repeatable rather than whatever the input happened to be.
 */
export function sortCheckRows(rows: CheckWatchRow[], key: CheckSortKey, dir: SortDir): CheckWatchRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va == null && vb == null) return a.poNumber.localeCompare(b.poNumber);
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb));
    return cmp !== 0 ? cmp * sign : a.poNumber.localeCompare(b.poNumber);
  });
}

export interface CheckGroup {
  key: string;
  label: string;
  rows: CheckWatchRow[];
  /** What the group is worth — the figure a person reads a group FOR. */
  total: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function groupOf(r: CheckWatchRow, by: CheckGroupBy): { key: string; label: string } {
  if (by === "company") return { key: r.supplier || "—", label: r.supplier || "No company" };
  if (by === "status") return { key: r.state, label: r.statusLabel };
  // Clearing month — how a register is read when planning the bank balance.
  const ymd = r.state === "cleared" ? r.clearedOn ?? r.clearingYMD : r.clearingYMD;
  if (!ymd) return { key: "zzz-none", label: "No clearing date" };
  const [y, m] = ymd.split("-");
  return { key: `${y}-${m}`, label: `${MONTHS[Number(m) - 1] ?? m} ${y}` };
}

/**
 * Rows in groups, each group keeping the order it was given.
 *
 * Groups appear in the order their FIRST row does, so grouping never fights the
 * sort: group by company on a register sorted by clearing date and the company
 * clearing soonest is still at the top.
 */
export function groupCheckRows(rows: CheckWatchRow[], by: CheckGroupBy): CheckGroup[] {
  if (by === "none") return [{ key: "all", label: "", rows, total: rows.reduce((s, r) => s + (r.amount ?? 0), 0) }];
  const out: CheckGroup[] = [];
  const index = new Map<string, CheckGroup>();
  for (const r of rows) {
    const { key, label } = groupOf(r, by);
    let g = index.get(key);
    if (!g) {
      g = { key, label, rows: [], total: 0 };
      index.set(key, g);
      out.push(g);
    }
    g.rows.push(r);
    g.total = Math.round((g.total + (r.amount ?? 0)) * 100) / 100;
  }
  return out;
}
