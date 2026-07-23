"use client";

import { useEffect, useState } from "react";
import { getPnlDetail, type PnlDetail } from "./pnl-actions";
import { DEPT_LABEL } from "@/lib/department-pnl";
import { formatCurrency } from "@/lib/utils";

const ROUTING_LABEL: Record<string, string> = {
  fan: "Fan",
  production_markup: "Fabricated ÷1.3",
  office_full: "Bought-in",
};

/** Self-fetching audit breakdown for a period. Remount (via key) to refetch. */
export function PnlDetailView({ from, to }: { from: string; to: string }) {
  const [detail, setDetail] = useState<PnlDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    getPnlDetail(from, to)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load detail."));
    return () => {
      alive = false;
    };
  }, [from, to]);

  if (error) return <p className="py-3 text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (!detail) return <p className="py-3 text-xs text-muted-foreground">Loading detail…</p>;

  return (
    <div className="space-y-5 border-t pt-4">
      {/* Sales */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sales detail ({detail.sales.length})</div>
        {detail.sales.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sales recognised in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-xs">
              <thead>
                <tr className="border-b text-[11px] text-muted-foreground">
                  <th className="py-1.5 pr-2 text-left font-medium">Date · Quote · Customer</th>
                  <th className="py-1.5 px-2 text-left font-medium">Item</th>
                  <th className="py-1.5 px-2 text-left font-medium">Routing</th>
                  <th className="py-1.5 px-2 text-right font-medium">Net</th>
                  <th className="py-1.5 px-2 text-right font-medium">Dept</th>
                  <th className="py-1.5 px-2 text-right font-medium">Office</th>
                  <th className="py-1.5 pl-2 text-right font-medium">COGS / cost</th>
                </tr>
              </thead>
              <tbody>
                {detail.sales.map((s) =>
                  s.lines.map((l, i) => (
                    <tr key={`${s.quoteNumber}-${i}`} className={i === 0 ? "border-t" : ""}>
                      <td className="py-1 pr-2 align-top">
                        {i === 0 && (
                          <div className="leading-tight">
                            <div className="font-medium">{s.recognizedAt}</div>
                            <div className="font-mono text-[11px]">{s.quoteNumber}</div>
                            <div className="text-muted-foreground">{s.customer}</div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.basis}</div>
                          </div>
                        )}
                      </td>
                      <td className="py-1 px-2 align-top">{l.label}{l.qty > 1 ? ` ×${l.qty}` : ""}</td>
                      <td className="py-1 px-2 align-top text-muted-foreground">{ROUTING_LABEL[l.routing] ?? l.routing}</td>
                      <td className="py-1 px-2 text-right align-top tabular-nums">{formatCurrency(l.net)}</td>
                      <td className="py-1 px-2 text-right align-top tabular-nums">
                        {l.deptShare > 0 ? <span>{formatCurrency(l.deptShare)}<span className="ml-1 text-[10px] text-muted-foreground">{DEPT_LABEL[l.dept]}</span></span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1 px-2 text-right align-top tabular-nums">{formatCurrency(l.officeShare)}</td>
                      <td className="py-1 pl-2 text-right align-top tabular-nums">
                        {l.routing === "fan"
                          ? (l.cogs && l.cogs > 0 ? formatCurrency(l.cogs) : <span className="text-amber-600">no COGS</span>)
                          : l.routing === "office_full"
                            ? (l.officeCost != null ? <span className="text-muted-foreground">−{formatCurrency(l.officeCost)}</span> : <span className="text-amber-600">no cost</span>)
                            : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Expenses */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expense detail ({detail.expenses.length})</div>
        {detail.expenses.length === 0 ? (
          <p className="text-xs text-muted-foreground">No expenses recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-xs">
              <thead>
                <tr className="border-b text-[11px] text-muted-foreground">
                  <th className="py-1.5 pr-2 text-left font-medium">Date</th>
                  <th className="py-1.5 px-2 text-left font-medium">Source</th>
                  <th className="py-1.5 px-2 text-left font-medium">Ref</th>
                  <th className="py-1.5 px-2 text-left font-medium">Department</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.expenses.map((e, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 pr-2">{e.date}</td>
                    <td className="py-1 px-2 text-muted-foreground">{e.source}</td>
                    <td className="py-1 px-2 font-mono text-[11px]">{e.ref}</td>
                    <td className="py-1 px-2">{DEPT_LABEL[e.dept]}</td>
                    <td className="py-1 pl-2 text-right tabular-nums">{formatCurrency(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
