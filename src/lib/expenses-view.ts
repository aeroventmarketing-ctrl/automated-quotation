import type { ExpenseRecord } from "@/app/(app)/management/pnl-actions";

// Shared filter / sort / group logic for the Expenses Records report, used by
// both the on-screen client component and the Excel / PDF export routes so a
// download always matches what the user sees.

export type ExpSortKey = "date" | "amount" | "dept" | "source";
export type ExpGroupKey = "none" | "dept" | "source" | "month";

export const EXPENSE_SORTS: { key: ExpSortKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "amount", label: "Amount" },
  { key: "dept", label: "Department" },
  { key: "source", label: "Source" },
];
export const EXPENSE_GROUPS: { key: ExpGroupKey; label: string }[] = [
  { key: "none", label: "None" },
  { key: "dept", label: "Department" },
  { key: "source", label: "Source" },
  { key: "month", label: "Month" },
];

export interface ExpViewOpts {
  query?: string;
  sort: ExpSortKey;
  dir: "asc" | "desc";
  group: ExpGroupKey;
}
export interface ExpGroup {
  key: string;
  rows: ExpenseRecord[];
  subtotal: number;
}
export interface ExpView {
  groups: ExpGroup[];
  total: number;
  count: number;
}

export const coerceSort = (v: string | null | undefined): ExpSortKey =>
  EXPENSE_SORTS.some((s) => s.key === v) ? (v as ExpSortKey) : "date";
export const coerceGroup = (v: string | null | undefined): ExpGroupKey =>
  EXPENSE_GROUPS.some((g) => g.key === v) ? (v as ExpGroupKey) : "none";
export const coerceDir = (v: string | null | undefined): "asc" | "desc" => (v === "asc" ? "asc" : "desc");

export function buildExpensesView(records: ExpenseRecord[], opts: ExpViewOpts): ExpView {
  const q = (opts.query ?? "").trim().toLowerCase();
  const filtered = q
    ? records.filter((r) =>
        [r.date, r.source, r.ref, r.deptLabel, r.who, r.detail].some((f) => f.toLowerCase().includes(q)),
      )
    : records;

  const mul = opts.dir === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    let c = 0;
    if (opts.sort === "amount") c = a.amount - b.amount;
    else if (opts.sort === "dept") c = a.deptLabel.localeCompare(b.deptLabel);
    else if (opts.sort === "source") c = a.source.localeCompare(b.source);
    else c = a.date.localeCompare(b.date);
    return (c || a.date.localeCompare(b.date)) * mul;
  });

  const total = sorted.reduce((s, r) => s + r.amount, 0);
  const keyOf = (r: ExpenseRecord): string =>
    opts.group === "dept" ? r.deptLabel : opts.group === "source" ? r.source : opts.group === "month" ? r.date.slice(0, 7) : "";

  const buckets = new Map<string, ExpenseRecord[]>();
  for (const r of sorted) {
    const k = keyOf(r);
    const arr = buckets.get(k);
    if (arr) arr.push(r);
    else buckets.set(k, [r]);
  }
  const groups: ExpGroup[] = [...buckets.entries()].map(([key, rows]) => ({
    key,
    rows,
    subtotal: rows.reduce((s, r) => s + r.amount, 0),
  }));
  return { groups, total, count: sorted.length };
}
