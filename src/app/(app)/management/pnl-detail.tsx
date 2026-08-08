"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { getPnlDetail, deletePnlRecord, type PnlDetail, type PnlSaleDetail, type PnlSaleLine, type PnlOrderAmount, type PnlPricingAudit, type PnlDeleteRef } from "./pnl-actions";
import { DEPT_LABEL, type DeptKey } from "@/lib/department-pnl";
import { formatCurrency, cn } from "@/lib/utils";

/**
 * Admin-only "delete test row" control. Permanently removes the underlying
 * record (order / counter sale / PO / voucher / payroll / transfer) and, on
 * success, asks the parent to re-pull the P&L. Shows the reason inline on
 * failure (the action returns it, since a thrown Server Action error is masked
 * in production).
 */
function DeleteButton({ del, label, onChanged }: { del: PnlDeleteRef; label: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    if (!window.confirm(`Permanently delete ${label}?\n\nThis removes the underlying record from the database and cannot be undone.`)) return;
    setBusy(true);
    setErr(null);
    const r = await deletePnlRecord(del.kind, del.id);
    if (r.ok) { onChanged(); return; } // parent re-renders with fresh data
    setErr(r.error);
    setBusy(false);
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" disabled={busy} onClick={run} title={`Delete ${label}`} className="text-muted-foreground hover:text-destructive disabled:opacity-50">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      {err && <span className="text-[10px] text-destructive">{err}</span>}
    </span>
  );
}

const VAT_MODE_LABEL: Record<string, string> = { INCLUSIVE: "Inclusive", EXCLUSIVE: "Excl. ÷1.12", EXCLUSIVE_PLUS: "Excl. +12%", ZERO_RATED: "Zero-rated" };
const r2 = (n: number) => Math.round((n + 1e-9) * 100) / 100;

/**
 * Independently recompute a row's net-of-VAT mark-up / discount from its inputs —
 * a self-contained re-implementation of the server's pricing math (mark-up by the
 * margin method, flat amounts VAT-inclusive in +12%), so the ✓ genuinely
 * cross-checks the booked figures rather than echoing the same code.
 */
function expectedNets(a: PnlPricingAudit): { markupNet: number; discountNet: number } {
  const F = 1.12;
  // For +12%, a flat (amount) mark-up/discount is VAT-inclusive → scale by 1.12.
  const mV = a.vatMode === "EXCLUSIVE_PLUS" && a.markupMode === "amount" ? a.markupValue / F : a.markupValue;
  const dV = a.vatMode === "EXCLUSIVE_PLUS" && a.discountMode === "amount" ? a.discountValue / F : a.discountValue;
  // INCLUSIVE and ZERO_RATED display on the gross (entered-price) basis; the
  // exclusive modes strip VAT. Only INCLUSIVE has VAT to strip back out (toNet).
  const displayedNet = a.vatMode === "INCLUSIVE" || a.vatMode === "ZERO_RATED" ? a.grossBase : a.grossBase / F;
  const afterMarkup = a.markupMode === "percent" ? (1 - mV / 100 > 0 ? displayedNet / (1 - mV / 100) : displayedNet) : displayedNet + mV;
  const markupAmt = afterMarkup - displayedNet;
  const discountAmt = a.discountMode === "percent" ? afterMarkup * (dV / 100) : dV;
  const toNet = (x: number) => (a.vatMode === "INCLUSIVE" ? x / F : x);
  return { markupNet: r2(toNet(markupAmt)), discountNet: r2(toNet(discountAmt)) };
}

function PricingAudit({ rows }: { rows: PnlPricingAudit[] }) {
  const fmtIn = (mode: string, val: number) => (val > 0 ? (mode === "percent" ? `${val}%` : formatCurrency(val)) : "—");
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mark-up &amp; discount audit ({rows.length})</div>
      <p className="text-[11px] text-muted-foreground">
        Each order&apos;s VAT mode, the mark-up / discount entered, and the net-of-VAT figures the P&amp;L books. Quick check: a <strong>%</strong> adjustment = the marked-up net × %; a <strong>flat ₱</strong> amount = amount ÷ 1.12 (Inclusive / +12%) or the full amount (÷1.12 mode). The VAT slice sits in Output VAT. <span className="text-emerald-600">✓</span> = the booked figure reproduces from the inputs.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-xs">
          <thead>
            <tr className="border-b text-[11px] text-muted-foreground">
              <th className="py-1.5 pr-2 text-left font-medium">Quote · Customer</th>
              <th className="py-1.5 px-2 text-left font-medium">VAT mode</th>
              <th className="py-1.5 px-2 text-right font-medium">Gross (incl. VAT)</th>
              <th className="py-1.5 px-2 text-right font-medium">Net base</th>
              <th className="py-1.5 px-2 text-right font-medium">Mark-up in</th>
              <th className="py-1.5 px-2 text-right font-medium">→ net</th>
              <th className="py-1.5 px-2 text-right font-medium">Discount in</th>
              <th className="py-1.5 px-2 text-right font-medium">→ net</th>
              <th className="py-1.5 pl-2 text-center font-medium">✓</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const exp = expectedNets(a);
              const ok = Math.abs(exp.markupNet - a.markupNet) < 0.02 && Math.abs(exp.discountNet - a.discountNet) < 0.02;
              return (
                <tr key={a.quotationId} className="border-t">
                  <td className="py-1 pr-2 align-top">
                    <Link href={`/quotations/${a.quotationId}`} className="block font-mono text-[11px] text-primary hover:underline">{a.quoteNumber}</Link>
                    <span className="text-muted-foreground">{a.customer}</span>
                  </td>
                  <td className="py-1 px-2 align-top">{VAT_MODE_LABEL[a.vatMode] ?? a.vatMode}</td>
                  <td className="py-1 px-2 text-right align-top tabular-nums">{formatCurrency(a.grossBase)}</td>
                  <td className="py-1 px-2 text-right align-top tabular-nums">{formatCurrency(a.orderNet)}</td>
                  <td className="py-1 px-2 text-right align-top tabular-nums">{fmtIn(a.markupMode, a.markupValue)}</td>
                  <td className="py-1 px-2 text-right align-top tabular-nums">{a.markupNet > 0 ? formatCurrency(a.markupNet) : "—"}</td>
                  <td className="py-1 px-2 text-right align-top tabular-nums">{fmtIn(a.discountMode, a.discountValue)}</td>
                  <td className="py-1 px-2 text-right align-top tabular-nums">{a.discountNet > 0 ? formatCurrency(a.discountNet) : "—"}</td>
                  <td className="py-1 pl-2 text-center align-top">{ok ? <span className="text-emerald-600">✓</span> : <span className="font-semibold text-red-600">✗</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
  // A service / charge line legitimately has no cost — show "service", not the
  // amber "no COGS" warning used for a bought-in product with a missing cost.
  if (l.service) return <span className="text-muted-foreground">service</span>;
  if (l.routing === "fan") return l.cogs && l.cogs > 0 ? <>{formatCurrency(l.cogs)}</> : <span className="text-amber-600">no COGS</span>;
  if (l.routing === "office_full") return l.officeCost != null ? <span className="text-muted-foreground">−{formatCurrency(l.officeCost)}</span> : <span className="text-amber-600">no COGS</span>;
  return <span className="text-muted-foreground">—</span>;
}

/** The full audit view — every sale and every expense (the Company drill-down). */
export function PnlFullDetail({ detail, admin = false, onChanged = () => {} }: { detail: PnlDetail; admin?: boolean; onChanged?: () => void }) {
  const markupMap = new Map(detail.markupByOrder.map((o) => [o.quotationId, o.amount]));
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
                {detail.sales.map((s) => {
                  const mk = markupMap.get(s.quotationId) ?? 0;
                  return (
                    <Fragment key={s.quoteNumber}>
                      {s.lines.map((l, i) => (
                        // Red row when Office books a negative margin (COGS &gt; selling net).
                        <tr key={i} className={cn(i === 0 && "border-t", l.officeShare < 0 && "bg-red-50 dark:bg-red-950/20")}>
                          <td className="py-1 pr-2 align-top">
                            {i === 0 && (
                              <div className="flex items-start gap-1.5">
                                <SaleRef s={s} />
                                {admin && s.del && <DeleteButton del={s.del} label={`sale ${s.quoteNumber}`} onChanged={onChanged} />}
                              </div>
                            )}
                          </td>
                          <td className="py-1 px-2 align-top">{l.label}{l.qty > 1 ? ` ×${l.qty}` : ""}</td>
                          <td className="py-1 px-2 align-top text-muted-foreground">{ROUTING_LABEL[l.routing] ?? l.routing}</td>
                          <td className="py-1 px-2 text-right align-top tabular-nums">{formatCurrency(l.net)}</td>
                          <td className="py-1 px-2 text-right align-top tabular-nums">
                            {l.deptShare > 0 ? <span>{formatCurrency(l.deptShare)}<span className="ml-1 text-[10px] text-muted-foreground">{DEPT_LABEL[l.dept]}</span></span> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className={cn("py-1 px-2 text-right align-top tabular-nums", l.officeShare < 0 && "font-medium text-red-600 dark:text-red-400")}>{formatCurrency(l.officeShare)}</td>
                          <td className="py-1 pl-2 text-right align-top tabular-nums"><CostNote l={l} /></td>
                        </tr>
                      ))}
                      {mk > 0 && (
                        <tr>
                          <td className="py-1 pr-2" />
                          <td className="py-1 px-2 font-medium">Income from Mark up</td>
                          <td className="py-1 px-2 text-muted-foreground">—</td>
                          <td className="py-1 px-2 text-right text-muted-foreground">—</td>
                          <td className="py-1 px-2 text-right text-muted-foreground">—</td>
                          <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(mk)}</td>
                          <td className="py-1 pl-2 text-right text-muted-foreground">—</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ExpenseTable items={detail.expenses} extra={{ label: "Client Discount", rows: detail.discountByOrder }} admin={admin} onChanged={onChanged} />
      {detail.pricingAudit.length > 0 && <PricingAudit rows={detail.pricingAudit} />}
    </div>
  );
}

function ExpenseTable({ items, extra, admin = false, onChanged = () => {} }: { items: PnlDetail["expenses"]; extra?: { label: string; rows: PnlOrderAmount[] } | null; admin?: boolean; onChanged?: () => void }) {
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
                {admin && <th className="py-1.5 pl-2 w-6" />}
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
                  {admin && <td className="py-1 pl-2 text-right">{e.del && <DeleteButton del={e.del} label={`${e.source} ${e.ref}`} onChanged={onChanged} />}</td>}
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
                  {admin && <td className="py-1 pl-2" />}
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
export function DeptDrill({ detail, deptKey, admin = false, onChanged = () => {} }: { detail: PnlDetail; deptKey: DeptKey; admin?: boolean; onChanged?: () => void }) {
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
  const markupMap = new Map(detail.markupByOrder.map((o) => [o.quotationId, o.amount]));

  return (
    <div className="space-y-4">
      <VatTiles output={vat.output} input={vat.input} payable={vat.payable} />

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{DEPT_LABEL[deptKey]} sales ({rowCount})</div>
        {isOffice && groups.some((g) => g.lines.reduce((a, r) => a + r.amt, 0) + (markupMap.get(g.s.quotationId) ?? 0) < 0) && (
          <p className="text-[11px] text-red-600 dark:text-red-400">
            Rows in red book a <strong>negative margin</strong> — the line&rsquo;s recorded COGS exceeds its selling price, which is what pulls Office sales below zero. Check the item&rsquo;s cost / price (or delete the row if it&rsquo;s test data).
          </p>
        )}
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
                  const gMarkup = isOffice ? (markupMap.get(g.s.quotationId) ?? 0) : 0;
                  const gAmt = g.lines.reduce((a, r) => a + r.amt, 0) + gMarkup;
                  return (
                    <Fragment key={`${g.s.quoteNumber}-${gi}`}>
                      {g.lines.map((r, i) => (
                        // A line sold below its recorded COGS books a NEGATIVE margin
                        // to its dept — flag it red so a bad cost / below-cost line stands out.
                        <tr key={i} className={cn("align-top", i === 0 && "border-t", r.amt < 0 && "bg-red-50 dark:bg-red-950/20")}>
                          <td className="py-1 pr-2">
                            {i === 0 && (
                              <div className="flex items-start gap-1.5">
                                <SaleRef s={g.s} />
                                {admin && g.s.del && <DeleteButton del={g.s.del} label={`sale ${g.s.quoteNumber}`} onChanged={onChanged} />}
                              </div>
                            )}
                          </td>
                          <td className="py-1 px-2">{r.l.label}{r.l.qty > 1 ? ` ×${r.l.qty}` : ""}<span className="ml-1 text-[10px] text-muted-foreground">{ROUTING_LABEL[r.l.routing] ?? ""}</span></td>
                          <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(r.l.net)}</td>
                          {isOffice && (
                            <td className={cn("py-1 px-2 text-right tabular-nums", r.amt < 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                              {r.l.routing === "office_full" ? (r.l.officeCost != null ? `− ${formatCurrency(r.l.officeCost)}` : <span className="text-amber-600">no COGS</span>) : "—"}
                            </td>
                          )}
                          <td className={cn("py-1 pl-2 text-right font-medium tabular-nums", r.amt < 0 && "text-red-600 dark:text-red-400")}>{formatCurrency(r.amt)}</td>
                        </tr>
                      ))}
                      {/* Mark-up income booked to this same order */}
                      {gMarkup > 0 && (
                        <tr className="align-top">
                          <td className="py-1 pr-2" />
                          <td className="py-1 px-2"><span className="font-medium">Income from Mark up</span></td>
                          <td className="py-1 px-2 text-right text-muted-foreground">—</td>
                          {isOffice && <td className="py-1 px-2 text-right text-muted-foreground">—</td>}
                          <td className="py-1 pl-2 text-right font-medium tabular-nums">{formatCurrency(gMarkup)}</td>
                        </tr>
                      )}
                      {/* Per-order subtotal — red when the order's margin is negative
                          (its booked COGS exceeds its selling price). */}
                      <tr className={cn("text-[11px] font-medium", gAmt < 0 ? "bg-red-100 dark:bg-red-950/40" : "bg-muted/40")}>
                        <td className="py-1 pr-2 text-right text-muted-foreground" colSpan={2}>Subtotal · {g.s.quoteNumber}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(gNet)}</td>
                        {isOffice && <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">− {formatCurrency(gCogs)}</td>}
                        <td className={cn("py-1 pl-2 text-right tabular-nums", gAmt < 0 && "text-red-600 dark:text-red-400")}>{formatCurrency(gAmt)}</td>
                      </tr>
                    </Fragment>
                  );
                })}
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

      <ExpenseTable items={exp} extra={isOffice ? { label: "Client Discount", rows: detail.discountByOrder } : null} admin={admin} onChanged={onChanged} />
    </div>
  );
}
