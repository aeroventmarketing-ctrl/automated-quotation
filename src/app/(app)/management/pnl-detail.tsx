"use client";

import { Fragment } from "react";
import Link from "next/link";
import { getPnlDetail, type PnlDetail, type PnlSaleDetail, type PnlSaleLine, type PnlOrderAmount } from "./pnl-actions";
import { DEPT_LABEL, type DeptKey } from "@/lib/department-pnl";
import { formatCurrency, cn } from "@/lib/utils";

export { getPnlDetail };
export type { PnlDetail };

const ROUTING_LABEL: Record<string, string> = {
  fan: "Fan",
  production_markup: "Fabricated ÷1.3",
  office_full: "Bought-in",
};

function SaleRef({ s }: { s: PnlSaleDetail }) {
  return (
    <div className="leading-tight">
      <div className="font-medium">{s.recognizedAt}</div>
      <Link href={s.href ?? `/quotations/${s.quotationId}`} className="block font-mono text-[11px] text-primary hover:underline">{s.quoteNumber}</Link>
      {s.customerId ? (
        <Link href={`/customers/${s.customerId}`} className="block text-primary hover:underline">{s.customer}</Link>
      ) : (
        <div className="text-muted-foreground">{s.customer}</div>
      )}
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.basis}</div>
    </div>
  );
}

function CostNote({ l }: { l: PnlSaleLine }) {
  if (l.routing === "fan") return l.cogs && l.cogs > 0 ? <>{formatCurrency(l.cogs)}</> : <span className="text-amber-600">no COGS</span>;
  if (l.routing === "office_full") return l.officeCost != null ? <span className="text-muted-foreground">−{formatCurrency(l.officeCost)}</span> : <span className="text-amber-600">no COGS</span>;
  return <span className="text-muted-foreground">—</span>;
}

/** The full audit view — every sale and every expense (the Company drill-down). */
export function PnlFullDetail({ detail }: { detail: PnlDetail }) {
  return (
    <div className="space-y-5">
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
                  <th className="py-1.5 pl-2 text-right font-medium">COGS</th>
                </tr>
              </thead>
              <tbody>
                {detail.sales.map((s) =>
                  s.lines.map((l, i) => (
                    <tr key={`${s.quoteNumber}-${i}`} className={i === 0 ? "border-t" : ""}>
                      <td className="py-1 pr-2 align-top">{i === 0 && <SaleRef s={s} />}</td>
                      <td className="py-1 px-2 align-top">{l.label}{l.qty > 1 ? ` ×${l.qty}` : ""}</td>
                      <td className="py-1 px-2 align-top text-muted-foreground">{ROUTING_LABEL[l.routing] ?? l.routing}</td>
                      <td className="py-1 px-2 text-right align-top tabular-nums">{formatCurrency(l.net)}</td>
                      <td className="py-1 px-2 text-right align-top tabular-nums">
                        {l.deptShare > 0 ? <span>{formatCurrency(l.deptShare)}<span className="ml-1 text-[10px] text-muted-foreground">{DEPT_LABEL[l.dept]}</span></span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1 px-2 text-right align-top tabular-nums">{formatCurrency(l.officeShare)}</td>
                      <td className="py-1 pl-2 text-right align-top tabular-nums"><CostNote l={l} /></td>
                    </tr>
                  )),
                )}
                {detail.markupByOrder.map((o) => (
                  <tr key={`mk-${o.quotationId}`} className="border-t">
                    <td className="py-1 pr-2 align-top">
                      <Link href={o.href ?? `/quotations/${o.quotationId}`} className="font-mono text-[11px] text-primary hover:underline">{o.quoteNumber}</Link>
                      <div className="text-[10px] text-muted-foreground">{o.customer}</div>
                    </td>
                    <td className="py-1 px-2 align-top font-medium">Income from Mark up</td>
                    <td className="py-1 px-2 align-top text-muted-foreground">—</td>
                    <td className="py-1 px-2 text-right align-top text-muted-foreground">—</td>
                    <td className="py-1 px-2 text-right align-top text-muted-foreground">—</td>
                    <td className="py-1 px-2 text-right align-top tabular-nums">{formatCurrency(o.amount)}</td>
                    <td className="py-1 pl-2 text-right align-top text-muted-foreground">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ExpenseTable items={detail.expenses} extra={{ label: "Client Discount", rows: detail.discountByOrder }} />
    </div>
  );
}

function ExpenseTable({ items, extra }: { items: PnlDetail["expenses"]; extra?: { label: string; rows: PnlOrderAmount[] } | null }) {
  const extraRows = extra?.rows ?? [];
  const count = items.length + extraRows.length;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expense detail ({count})</div>
      {count === 0 ? (
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
              {items.map((e, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1 pr-2">{e.date}</td>
                  <td className="py-1 px-2 text-muted-foreground">{e.source}</td>
                  <td className="py-1 px-2 font-mono text-[11px]">{e.ref}</td>
                  <td className="py-1 px-2">{DEPT_LABEL[e.dept]}</td>
                  <td className="py-1 pl-2 text-right tabular-nums">{formatCurrency(e.amount)}</td>
                </tr>
              ))}
              {extraRows.map((r) => (
                <tr key={`x-${r.quotationId}`} className="border-t">
                  <td className="py-1 pr-2 text-muted-foreground">—</td>
                  <td className="py-1 px-2 font-medium">{extra!.label}</td>
                  <td className="py-1 px-2">
                    <Link href={r.href ?? `/quotations/${r.quotationId}`} className="font-mono text-[11px] text-primary hover:underline">{r.quoteNumber}</Link>
                    <span className="ml-1 text-[10px] text-muted-foreground">{r.customer}</span>
                  </td>
                  <td className="py-1 px-2">{DEPT_LABEL.office}</td>
                  <td className="py-1 pl-2 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VatTiles({ output, input, payable }: { output: number; input: number; payable: number }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-md border bg-muted/30 p-2">
        <div className="text-[11px] text-muted-foreground">Output VAT</div>
        <div className="text-sm font-medium tabular-nums">{formatCurrency(output)}</div>
      </div>
      <div className="rounded-md border bg-muted/30 p-2">
        <div className="text-[11px] text-muted-foreground">Input VAT</div>
        <div className="text-sm font-medium tabular-nums">− {formatCurrency(input)}</div>
      </div>
      <div className="rounded-md border bg-muted/30 p-2">
        <div className="text-[11px] text-muted-foreground">Net VAT payable</div>
        <div className="text-sm font-semibold tabular-nums">{formatCurrency(payable)}</div>
      </div>
    </div>
  );
}

/** One department's drill-down: its VAT, its sales lines, and its expenses. */
export function DeptDrill({ detail, deptKey }: { detail: PnlDetail; deptKey: DeptKey }) {
  const isOffice = deptKey === "office";
  const lineCogs = (l: PnlSaleLine) => (l.routing === "office_full" && l.officeCost != null ? l.officeCost : 0);
  // Group the department's sale lines per order (quote number) so each order gets
  // its own Line net / Less COGS / To-<dept> subtotal, under one grand total.
  const groups: { s: PnlSaleDetail; lines: { l: PnlSaleLine; amt: number }[] }[] = [];
  for (const s of detail.sales) {
    const lines: { l: PnlSaleLine; amt: number }[] = [];
    for (const l of s.lines) {
      const amt = isOffice ? l.officeShare : l.dept === deptKey ? l.deptShare : 0;
      if (amt > 0) lines.push({ l, amt });
    }
    if (lines.length) groups.push({ s, lines });
  }
  const rowCount = groups.reduce((a, g) => a + g.lines.length, 0);
  const salesTotal = groups.reduce((a, g) => a + g.lines.reduce((b, r) => b + r.amt, 0), 0);
  const netTotal = groups.reduce((a, g) => a + g.lines.reduce((b, r) => b + r.l.net, 0), 0);
  const costTotal = groups.reduce((a, g) => a + g.lines.reduce((b, r) => b + lineCogs(r.l), 0), 0);
  const exp = detail.expenses.filter((e) => e.dept === deptKey);
  const vat = detail.vatByDept[deptKey];
  // Office also carries the quote mark-ups (income) and client discounts (expense).
  const markup = isOffice ? detail.markupIncome : 0;

  return (
    <div className="space-y-4">
      <VatTiles output={vat.output} input={vat.input} payable={vat.payable} />

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{DEPT_LABEL[deptKey]} sales ({rowCount})</div>
        {rowCount === 0 && markup === 0 ? (
          <p className="text-xs text-muted-foreground">No sales for this department in the period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-xs">
              <thead>
                <tr className="border-b text-[11px] text-muted-foreground">
                  <th className="py-1.5 pr-2 text-left font-medium">Date · Quote · Customer</th>
                  <th className="py-1.5 px-2 text-left font-medium">Item</th>
                  <th className="py-1.5 px-2 text-right font-medium">Line net</th>
                  {isOffice && <th className="py-1.5 px-2 text-right font-medium">Less COGS</th>}
                  <th className="py-1.5 pl-2 text-right font-medium">To {DEPT_LABEL[deptKey]}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => {
                  const gNet = g.lines.reduce((a, r) => a + r.l.net, 0);
                  const gCogs = g.lines.reduce((a, r) => a + lineCogs(r.l), 0);
                  const gAmt = g.lines.reduce((a, r) => a + r.amt, 0);
                  return (
                    <Fragment key={`${g.s.quoteNumber}-${gi}`}>
                      {g.lines.map((r, i) => (
                        <tr key={i} className={cn("align-top", i === 0 && "border-t")}>
                          <td className="py-1 pr-2">{i === 0 && <SaleRef s={g.s} />}</td>
                          <td className="py-1 px-2">{r.l.label}{r.l.qty > 1 ? ` ×${r.l.qty}` : ""}<span className="ml-1 text-[10px] text-muted-foreground">{ROUTING_LABEL[r.l.routing] ?? ""}</span></td>
                          <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(r.l.net)}</td>
                          {isOffice && (
                            <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">
                              {r.l.routing === "office_full" ? (r.l.officeCost != null ? `− ${formatCurrency(r.l.officeCost)}` : <span className="text-amber-600">no COGS</span>) : "—"}
                            </td>
                          )}
                          <td className="py-1 pl-2 text-right font-medium tabular-nums">{formatCurrency(r.amt)}</td>
                        </tr>
                      ))}
                      {/* Per-order subtotal */}
                      <tr className="bg-muted/40 text-[11px] font-medium">
                        <td className="py-1 pr-2 text-right text-muted-foreground" colSpan={2}>Subtotal · {g.s.quoteNumber}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(gNet)}</td>
                        {isOffice && <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">− {formatCurrency(gCogs)}</td>}
                        <td className="py-1 pl-2 text-right tabular-nums">{formatCurrency(gAmt)}</td>
                      </tr>
                    </Fragment>
                  );
                })}
                {isOffice && detail.markupByOrder.map((o) => (
                  <tr key={`mk-${o.quotationId}`} className="border-t align-top">
                    <td className="py-1 pr-2">
                      <Link href={o.href ?? `/quotations/${o.quotationId}`} className="font-mono text-[11px] text-primary hover:underline">{o.quoteNumber}</Link>
                      <div className="text-[10px] text-muted-foreground">{o.customer}</div>
                    </td>
                    <td className="py-1 px-2"><span className="font-medium">Income from Mark up</span></td>
                    <td className="py-1 px-2 text-right text-muted-foreground">—</td>
                    <td className="py-1 px-2 text-right text-muted-foreground">—</td>
                    <td className="py-1 pl-2 text-right font-medium tabular-nums">{formatCurrency(o.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold">
                  <td className="py-1 pr-2" colSpan={2}>Total sales</td>
                  <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(netTotal)}</td>
                  {isOffice && <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">− {formatCurrency(costTotal)}</td>}
                  <td className="py-1 pl-2 text-right tabular-nums">{formatCurrency(salesTotal + markup)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ExpenseTable items={exp} extra={isOffice ? { label: "Client Discount", rows: detail.discountByOrder } : null} />
    </div>
  );
}
