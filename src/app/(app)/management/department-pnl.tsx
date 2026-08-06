"use client";

import { Fragment, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getDepartmentPnl, getPnlDetail, type PnlReport, type PnlDetail } from "./pnl-actions";
import { PnlFullDetail, DeptDrill } from "./pnl-detail";
import type { DeptKey } from "@/lib/department-pnl";
import { formatCurrency } from "@/lib/utils";

const MS_PH = 8 * 3600 * 1000;

/** Manila "now" pieces, so month options match the server's UTC+8 bucketing. */
function manilaNow(): { y: number; m: number } {
  const d = new Date(Date.now() + MS_PH);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
}
function rangeLabel(from: string, to: string): string {
  const f = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${f(from)} – ${f(to)}`;
}

export function DepartmentPnl({ initial, admin = false }: { initial: PnlReport; admin?: boolean }) {
  const [report, setReport] = useState<PnlReport>(initial);
  const [mode, setMode] = useState<"month" | "custom">("month");
  const { y, m } = useMemo(manilaNow, []);
  const currentYm = `${y}-${String(m).padStart(2, "0")}`;
  const [month, setMonth] = useState(currentYm);
  const [customFrom, setCustomFrom] = useState(report.from);
  const [customTo, setCustomTo] = useState(report.to);
  const [openKey, setOpenKey] = useState<DeptKey | "company" | null>(null);
  const [vatOpen, setVatOpen] = useState(false);
  const [detail, setDetail] = useState<PnlDetail | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [detailPending, startDetail] = useTransition();
  const [pending, startTransition] = useTransition();

  const periodKey = `${report.from}:${report.to}`;
  const ensureDetail = () => {
    if (detailFor === periodKey) return;
    startDetail(async () => {
      const d = await getPnlDetail(report.from, report.to);
      setDetail(d);
      setDetailFor(`${d.from}:${d.to}`);
    });
  };
  const toggleRow = (key: DeptKey | "company") => {
    setOpenKey((cur) => (cur === key ? null : key));
    ensureDetail();
  };

  const monthOptions = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    return out;
  }, [y, m]);

  const load = (from: string, to: string) =>
    startTransition(async () => {
      setReport(await getDepartmentPnl(from, to));
      setOpenKey(null);
      setDetail(null);
      setDetailFor(null);
    });

  const onMonth = (ym: string) => {
    setMonth(ym);
    const { from, to } = monthRange(ym);
    load(from, to);
  };

  // After an admin deletes a P&L record, re-pull both the summary and the open
  // detail for the current period so the figures update in place.
  const refreshAfterDelete = () =>
    startDetail(async () => {
      const [rep, d] = await Promise.all([
        getDepartmentPnl(report.from, report.to),
        getPnlDetail(report.from, report.to),
      ]);
      setReport(rep);
      setDetail(d);
      setDetailFor(`${d.from}:${d.to}`);
    });

  const profit = report.totals.income >= 0;
  const detailReady = detail != null && detailFor === periodKey;
  const drillCell = (body: ReactNode) => (
    <tr>
      <td colSpan={4} className="bg-muted/20 px-3 py-3">
        {detailReady ? body : <p className="text-xs text-muted-foreground">{detailPending ? "Loading detail…" : "…"}</p>}
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex rounded-md border p-0.5">
          <button
            onClick={() => setMode("month")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${mode === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setMode("custom")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${mode === "custom" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Custom range
          </button>
        </div>
        {mode === "month" ? (
          <select
            value={month}
            onChange={(e) => onMonth(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {monthOptions.map((ym) => (
              <option key={ym} value={ym}>{monthLabel(ym)}</option>
            ))}
          </select>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" />
            <span className="text-muted-foreground">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" />
            <button
              onClick={() => load(customFrom, customTo)}
              disabled={!customFrom || !customTo}
              className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}
        {pending && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>

      {/* Company summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">Total sales (net)</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{formatCurrency(report.totals.sales)}</div>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">Total expenses</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{formatCurrency(report.totals.expenses)}</div>
        </div>
        <div className={`rounded-lg border p-3 ${profit ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30"}`}>
          <div className="text-xs text-muted-foreground">Net income</div>
          <div className={`mt-0.5 text-lg font-semibold tabular-nums ${profit ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{formatCurrency(report.totals.income)}</div>
        </div>
      </div>

      {/* Per-department table — click a row to drill into its sales, expenses & VAT */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 text-left font-medium">Department</th>
              <th className="py-2 text-right font-medium">Sales</th>
              <th className="py-2 text-right font-medium">Expenses</th>
              <th className="py-2 text-right font-medium">Income</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <Fragment key={r.key}>
                <tr className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => toggleRow(r.key)}>
                  <td className="py-2">
                    <span className="inline-flex items-center gap-2">
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${openKey === r.key ? "rotate-90" : ""}`} />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                      <span className="font-medium">{r.label}</span>
                      {!r.production && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Sales &amp; ops</span>}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(r.sales)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{formatCurrency(r.expenses)}</td>
                  <td className={`py-2 text-right font-medium tabular-nums ${r.income >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{formatCurrency(r.income)}</td>
                </tr>
                {openKey === r.key && drillCell(detail && <DeptDrill detail={detail} deptKey={r.key} admin={admin} onChanged={refreshAfterDelete} />)}
              </Fragment>
            ))}
            <tr className="cursor-pointer border-t-2 font-semibold hover:bg-muted/40" onClick={() => toggleRow("company")}>
              <td className="py-2">
                <span className="inline-flex items-center gap-2">
                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${openKey === "company" ? "rotate-90" : ""}`} />
                  Company
                </span>
              </td>
              <td className="py-2 text-right tabular-nums">{formatCurrency(report.totals.sales)}</td>
              <td className="py-2 text-right tabular-nums">{formatCurrency(report.totals.expenses)}</td>
              <td className={`py-2 text-right tabular-nums ${profit ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{formatCurrency(report.totals.income)}</td>
            </tr>
            {openKey === "company" && drillCell(detail && <PnlFullDetail detail={detail} admin={admin} onChanged={refreshAfterDelete} />)}
          </tbody>
        </table>
      </div>

      {/* VAT for BIR — a pass-through, kept out of the profit figures above.
          Click to break Output VAT down per order and Input VAT per supplier. */}
      <div className="rounded-lg border p-3">
        <button
          type="button"
          onClick={() => { setVatOpen((o) => !o); ensureDetail(); }}
          className="mb-2 flex w-full items-center gap-1.5 text-left"
        >
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${vatOpen ? "rotate-90" : ""}`} />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">VAT (for BIR — not in the profit above)</span>
        </button>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Output VAT (on sales)</div>
            <div className="mt-0.5 font-medium tabular-nums">{formatCurrency(report.vat.output)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Input VAT (on purchases)</div>
            <div className="mt-0.5 font-medium tabular-nums">− {formatCurrency(report.vat.input)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Net VAT payable</div>
            <div className={`mt-0.5 font-semibold tabular-nums ${report.vat.payable >= 0 ? "" : "text-emerald-700 dark:text-emerald-400"}`}>{formatCurrency(report.vat.payable)}</div>
          </div>
        </div>
        {vatOpen && (detailReady && detail ? (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {/* Output VAT — per order number */}
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Output VAT · per order ({detail.vatOutputByOrder.length})</div>
              {detail.vatOutputByOrder.length === 0 ? (
                <p className="text-xs text-muted-foreground">No VAT-charged sales in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[18rem] text-xs">
                    <thead>
                      <tr className="border-b text-[11px] text-muted-foreground">
                        <th className="py-1 pr-2 text-left font-medium">Order · Customer</th>
                        <th className="py-1 pl-2 text-right font-medium">Output VAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.vatOutputByOrder.map((o) => (
                        <tr key={o.quotationId} className="border-t align-top">
                          <td className="py-1 pr-2">
                            <Link href={o.href ?? `/quotations/${o.quotationId}`} className="font-mono text-[11px] text-primary hover:underline">{o.quoteNumber}</Link>
                            <div className="text-muted-foreground">{o.customer}</div>
                          </td>
                          <td className="py-1 pl-2 text-right tabular-nums">{formatCurrency(o.output)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 font-semibold">
                        <td className="py-1 pr-2">Total output VAT</td>
                        <td className="py-1 pl-2 text-right tabular-nums">{formatCurrency(report.vat.output)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {/* Input VAT — per supplier's name */}
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Input VAT · per supplier ({detail.vatInputBySupplier.length})</div>
              {detail.vatInputBySupplier.length === 0 ? (
                <p className="text-xs text-muted-foreground">No creditable input VAT in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[18rem] text-xs">
                    <thead>
                      <tr className="border-b text-[11px] text-muted-foreground">
                        <th className="py-1 pr-2 text-left font-medium">Supplier</th>
                        <th className="py-1 pl-2 text-right font-medium">Input VAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.vatInputBySupplier.map((s, i) => (
                        <tr key={i} className="border-t">
                          <td className="py-1 pr-2">{s.supplier}</td>
                          <td className="py-1 pl-2 text-right tabular-nums text-muted-foreground">− {formatCurrency(s.input)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 font-semibold">
                        <td className="py-1 pr-2">Total input VAT</td>
                        <td className="py-1 pl-2 text-right tabular-nums">− {formatCurrency(report.vat.input)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">{detailPending ? "Loading details…" : "…"}</p>
        ))}
      </div>

      {/* Notes */}
      <div className="space-y-1 rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <div>
          {rangeLabel(report.from, report.to)} · {report.salesCount} sale{report.salesCount === 1 ? "" : "s"} recognised
          {" "}(Terms clients on PO date, others on payment date). Click a department — or Company — for its sales, expenses and VAT.
        </div>
        <div>
          Sales are net of VAT: production lines keep net ÷ 1.3 with the balance to Office; for bought-in goods (KDK, AlphaAir, VFD, induction motors) Office keeps the margin — selling net less the item&apos;s COGS (the Products-tab supplier / unit price, net). Departments book their sales at the list price before the quote&apos;s mark-up and discount: the mark-up is Office income (&ldquo;Income from Mark up&rdquo;) and the discount an Office expense (&ldquo;Client Discounts&rdquo;), both net of VAT. Expenses are material POs (net), cash vouchers released in the period, and payroll.
        </div>
        <div>
          VAT is a pass-through, kept out of profit. Output VAT is 12% of VAT-charged sales (VAT-exclusive quotes excluded). Input VAT is 12% of purchases from VAT-inclusive (EWT-capable) suppliers — material POs and bought-in goods; cash vouchers and payroll carry none.
        </div>
        {report.fanLinesPending > 0 && (
          <div className="text-amber-700 dark:text-amber-500">
            {report.fanLinesPending} fan line{report.fanLinesPending === 1 ? " is" : "s are"} booked entirely to Office — add a matching fan-body COGS (by model code, or size + material) to attribute them to Fans.
          </div>
        )}
        {report.officeCostUnmatched > 0 && (
          <div className="text-amber-700 dark:text-amber-500">
            {report.officeCostUnmatched} bought-in line{report.officeCostUnmatched === 1 ? " has" : "s have"} no matching COGS (the Products-tab supplier / unit price) — Office income is overstated until the product (with a supplier price) is on file.
            {report.officeUnmatchedItems.length > 0 && (
              <span> Needs a supplier price: {report.officeUnmatchedItems.join(", ")}.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
