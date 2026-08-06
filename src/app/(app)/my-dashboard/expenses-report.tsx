"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Search, ArrowUp, ArrowDown, FileSpreadsheet, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { getExpensesReport, type ExpenseRecord, type ExpensesReport as ExpensesReportData } from "@/app/(app)/management/pnl-actions";
import {
  buildExpensesView,
  EXPENSE_SORTS,
  EXPENSE_GROUPS,
  type ExpSortKey,
  type ExpGroupKey,
} from "@/lib/expenses-view";

const SOURCE_VARIANT: Record<ExpenseRecord["source"], "default" | "secondary" | "warning" | "success"> = {
  "Purchase order": "default",
  "Cash voucher": "warning",
  Payroll: "secondary",
  "Stock transfer": "success",
};

/**
 * Expenses records report — a searchable, sortable, groupable list of every
 * recognised expense (material POs, cash vouchers, payroll, inter-department
 * stock transfers) in a date range. Shown on the Accounting My Dashboard and the
 * admin Production Dashboard. Data is fetched server-side (auth-gated); the date
 * range re-fetches, everything else filters/sorts/groups on the client. Excel and
 * PDF downloads hit server routes with the same params so they mirror the view.
 */
export function ExpensesReport({ initial }: { initial: ExpensesReportData }) {
  const [data, setData] = useState<ExpensesReportData>(initial);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ExpSortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [group, setGroup] = useState<ExpGroupKey>("none");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reload(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    setErr(null);
    startTransition(async () => {
      try {
        setData(await getExpensesReport(nextFrom, nextTo));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load expenses.");
      }
    });
  }

  const view = useMemo(
    () => buildExpensesView(data.records, { query, sort, dir, group }),
    [data.records, query, sort, dir, group],
  );

  // Params shared with the Excel / PDF routes so the download mirrors the view.
  const exportQs = new URLSearchParams({ from: data.from, to: data.to, q: query, sort, dir, group }).toString();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" /> Expenses Records
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{view.count}</span>
          <span className="ml-auto font-mono text-sm font-semibold text-foreground">{formatCurrency(view.total)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Date range — re-fetches from the server. */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <input type="date" value={from} max={to} onChange={(e) => reload(e.target.value, to)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <input type="date" value={to} min={from} onChange={(e) => reload(from, e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" />
          </label>
          <div className="ml-auto flex items-center gap-2">
            <a
              href={`/my-dashboard/expenses/xlsx?${exportQs}`}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent ${view.count === 0 ? "pointer-events-none opacity-50" : ""}`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </a>
            <a
              href={`/my-dashboard/expenses/pdf?${exportQs}`}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent ${view.count === 0 ? "pointer-events-none opacity-50" : ""}`}
            >
              <FileText className="h-3.5 w-3.5" /> PDF
            </a>
          </div>
        </div>

        {/* Search / sort / group / direction. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ref, supplier, department, who…"
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as ExpSortKey)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
              {EXPENSE_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={dir === "asc" ? "Ascending" : "Descending"}
            className="inline-flex h-9 items-center gap-1 rounded-md border bg-background px-2 text-xs text-muted-foreground hover:bg-accent"
          >
            {dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
            {dir === "asc" ? "Asc" : "Desc"}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Group
            <select value={group} onChange={(e) => setGroup(e.target.value as ExpGroupKey)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
              {EXPENSE_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}

        {view.count === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {pending ? "Loading…" : "No expenses recorded in this range."}
          </p>
        ) : (
          <div className={`space-y-4 ${pending ? "opacity-50" : ""}`}>
            {view.groups.map((g) => (
              <div key={g.key || "all"} className="space-y-1.5">
                {group !== "none" && (
                  <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.key || "—"} <span className="text-muted-foreground/70">({g.rows.length})</span>
                    <span className="ml-auto font-mono tabular-nums text-foreground/80">{formatCurrency(g.subtotal)}</span>
                  </div>
                )}
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">Date</th>
                        <th className="px-2 py-1.5 font-medium">Source</th>
                        <th className="px-2 py-1.5 font-medium">Reference</th>
                        <th className="px-2 py-1.5 font-medium">Department</th>
                        <th className="px-2 py-1.5 font-medium">Who</th>
                        <th className="px-2 py-1.5 font-medium">Detail</th>
                        <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-accent/50">
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{r.date}</td>
                          <td className="px-2 py-1.5"><Badge variant={SOURCE_VARIANT[r.source]} className="font-normal">{r.source}</Badge></td>
                          <td className="px-2 py-1.5 font-medium">
                            {r.href ? <Link href={r.href} className="text-primary hover:underline">{r.ref}</Link> : r.ref}
                          </td>
                          <td className="px-2 py-1.5">{r.deptLabel}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.who}</td>
                          <td className="max-w-[16rem] truncate px-2 py-1.5 text-muted-foreground" title={r.detail}>{r.detail || "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">{formatCurrency(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
