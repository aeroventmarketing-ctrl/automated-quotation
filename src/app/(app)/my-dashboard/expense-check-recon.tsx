"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Scale, Search, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { getExpenseCheckRecon, type ExpenseCheckRecon } from "@/app/(app)/management/pnl-actions";
import { RECON_STATUS_LABEL, reconSummary, type ReconStatus } from "@/lib/expense-check-recon";

const TONE: Record<ReconStatus, string> = {
  match: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  mismatch: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  "no-check": "bg-muted text-muted-foreground",
  unread: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  cash: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

const peso = (n: number) => formatCurrency(n);

/**
 * Expenses ↔ Checks reconciliation — beside Expenses Records. One row per
 * purchase order: what Expenses Records books (net of VAT), the VAT, the EWT,
 * what the check should say (total − EWT) and what the check photo says. Rows
 * whose check is more than ₱1 out are listed first, in red.
 */
export function ExpenseCheckReconCard({ initial }: { initial: ExpenseCheckRecon }) {
  const [data, setData] = useState(initial);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [open, setOpen] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reload(f: string, t: string) {
    setFrom(f);
    setTo(t);
    setErr(null);
    start(async () => {
      try {
        setData(await getExpenseCheckRecon(f, t));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't load the reconciliation.");
      }
    });
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.rows.filter((r) =>
      (!onlyIssues || r.status === "mismatch" || r.status === "unread") &&
      (!q || `${r.poNumber} ${r.supplier} ${r.deptLabels.join(" ")}`.toLowerCase().includes(q)));
  }, [data.rows, query, onlyIssues]);
  const s = useMemo(() => reconSummary(rows), [rows]);
  const all = data.summary;

  return (
    <Card>
      <CardHeader className="pb-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <CardTitle className="flex flex-1 flex-wrap items-center gap-2 text-sm">
            <Scale className="h-4 w-4 text-muted-foreground" /> Expenses ↔ Checks reconciliation
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{all.count} POs</span>
            {all.mismatches > 0
              ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">{all.mismatches} check{all.mismatches === 1 ? "" : "s"} differ</span>
              : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">No check differs</span>}
            {all.unread > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">{all.unread} not read</span>}
          </CardTitle>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Expenses Records books a PO <b>net of VAT</b> (total ÷ 1.12 for a VAT-registered supplier); the check pays the supplier
            the <b>total less EWT</b>. So they differ by design — a row is red only when the check is more than ₱1 away from total − EWT.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>From</span>
              <Input type="date" className="h-9 w-40" value={from} onChange={(e) => e.target.value && reload(e.target.value, to)} />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>To</span>
              <Input type="date" className="h-9 w-40" value={to} onChange={(e) => e.target.value && reload(from, e.target.value)} />
            </label>
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="PO number, supplier, department" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
              Discrepancies only
            </label>
            {pending && <span className="text-xs text-muted-foreground">Loading…</span>}
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[980px] text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Released</th>
                  <th className="px-2 py-2 text-left font-medium">PO</th>
                  <th className="px-2 py-2 text-left font-medium">Supplier</th>
                  <th className="px-2 py-2 text-left font-medium">Dept</th>
                  <th className="px-2 py-2 text-right font-medium">PO total</th>
                  <th className="px-2 py-2 text-right font-medium">Expense (net of VAT)</th>
                  <th className="px-2 py-2 text-right font-medium">VAT</th>
                  <th className="px-2 py-2 text-right font-medium">EWT</th>
                  <th className="px-2 py-2 text-right font-medium">Check should be</th>
                  <th className="px-2 py-2 text-right font-medium">Check says</th>
                  <th className="px-2 py-2 text-right font-medium">Difference</th>
                  <th className="px-2 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={12} className="px-2 py-6 text-center text-muted-foreground">No purchase orders released in this range{onlyIssues ? " with a discrepancy" : ""}.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.key} className={`border-t ${r.status === "mismatch" ? "bg-red-50/70 dark:bg-red-950/20" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{r.releasedYMD}</td>
                    <td className="px-2 py-1.5">
                      {r.href ? <Link href={r.href} className="whitespace-nowrap font-medium text-primary hover:underline">{r.poNumber}</Link> : r.poNumber}
                      {r.requests > 1 && <div className="text-[10px] text-muted-foreground">combined · {r.requests} requests</div>}
                    </td>
                    <td className="px-2 py-1.5">{r.supplier}</td>
                    <td className="px-2 py-1.5">
                      {r.deptLabels.join(", ")}
                      {!r.inExpenses && <div className="text-[10px] text-muted-foreground">not in Expenses Records</div>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{peso(r.gross)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{peso(r.expense)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{peso(r.vat)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{peso(r.ewt)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{peso(r.expectedCheck)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {r.actualCheck == null ? "—" : peso(r.actualCheck)}
                      {r.checks > 1 && <div className="text-[10px] text-muted-foreground">{r.checks} checks</div>}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${r.status === "mismatch" ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>
                      {r.diff == null ? "—" : `${r.diff > 0 ? "+" : r.diff < 0 ? "−" : ""}${peso(Math.abs(r.diff))}`}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE[r.status]}`}>{RECON_STATUS_LABEL[r.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="border-t bg-muted/30 font-semibold">
                  <tr>
                    <td className="px-2 py-2" colSpan={5}>Total · {s.count} PO{s.count === 1 ? "" : "s"}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap" title="Only the POs Expenses Records books">{peso(s.expense)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{peso(s.vat)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{peso(s.ewt)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{peso(s.expectedChecks)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{peso(s.actualChecks)}</td>
                    <td className="px-2 py-2" colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A <b>combined PO</b> (several requests on one PO) is one row, as on Check monitoring and now on Expenses Records. A check
            amount comes from its photo, or the correction someone typed over it. <b>Check not read</b>: a photo whose amount
            couldn&apos;t be read — open it on Check monitoring and fix the amount.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
