import Link from "next/link";
import { Coins, Wallet, AlertTriangle, ShoppingCart, Banknote } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { FinanceMonitor } from "@/lib/finance-monitor";

const CURRENCY = "PHP";

/**
 * The Receivables / Unreconciled payments / Cash vouchers / Stock alerts /
 * Purchasing & commissions cards, rendered from shared finance-monitor data.
 * Used on the Management Dashboard's audience and on Accounting's My Dashboard.
 */
export function FinanceMonitorCards({ data }: { data: FinanceMonitor }) {
  const { unbalanced, outstanding, deliveredUnpaid, collected, billed, collectedPct, lowStock, prPendingCount, commissionsUnpaidCount, unpaidCommission, vouchers } = data;
  const notTallied = vouchers.filter((v) => v.state === "mismatch").length;
  const awaiting = vouchers.filter((v) => v.state === "awaiting").length;

  return (
    <div className="space-y-4">
      {/* Unreconciled payments */}
      <Card className={`shadow-sm ${unbalanced.length > 0 ? "border-amber-300 dark:border-amber-900" : ""}`}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Coins className="h-4 w-4 text-muted-foreground" /> Unreconciled payments
            {unbalanced.length > 0 && (
              <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{unbalanced.length}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unbalanced.length === 0 ? (
            <div className="flex items-center gap-2 py-1 text-sm text-emerald-700">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/10">✓</span>
              Every confirmed order is fully paid &amp; reconciled.
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-6">
                <div>
                  <div className="text-3xl font-bold tabular-nums">{formatCurrency(outstanding, CURRENCY)}</div>
                  <div className="text-xs text-muted-foreground">Total unreconciled</div>
                </div>
                {deliveredUnpaid > 0 && (
                  <div>
                    <div className="text-3xl font-bold tabular-nums text-destructive">{deliveredUnpaid}</div>
                    <div className="text-xs text-muted-foreground">Delivered but unpaid</div>
                  </div>
                )}
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">A balance may just be un-recorded EWT (record it as &ldquo;EWT withheld&rdquo; on the sale) or an uncollected amount. Click a row to open the client and check the details.</p>
              <ul className="divide-y">
                {unbalanced.slice(0, 10).map((u) => {
                  const tag = u.closed ? "Closed · unpaid" : u.delivered ? "Delivered · unpaid" : "In progress";
                  const cls = u.delivered ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-amber-400 bg-amber-50 text-amber-700";
                  const href = u.customerId ? `/customers/${u.customerId}` : `/orders/${u.orderId}`;
                  return (
                    <li key={u.orderId}>
                      <Link href={href} className="-mx-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-1.5 text-sm hover:bg-accent">
                        <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{tag}</span>
                        <span className="min-w-0 truncate font-medium">{u.company}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{u.quoteNumber}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatCurrency(u.collected, CURRENCY)} / {formatCurrency(u.value, CURRENCY)}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-destructive">{formatCurrency(u.balance, CURRENCY)} due</span>
                      </Link>
                    </li>
                  );
                })}
                {unbalanced.length > 10 && <li className="pt-1 text-xs text-muted-foreground">+ {unbalanced.length - 10} more</li>}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Receivables */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Wallet className="h-4 w-4 text-muted-foreground" /> Receivables</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end justify-between">
              <span className="text-xs text-muted-foreground">Outstanding balance</span>
              <span className="text-xl font-bold tabular-nums">{formatCurrency(outstanding, CURRENCY)}</span>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Collected</span>
                <span className="font-medium tabular-nums">{collectedPct}%</span>
              </div>
              <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${collectedPct}%`, backgroundColor: "#1baf7a" }} />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{formatCurrency(collected, CURRENCY)} in</span>
                <span>{formatCurrency(billed, CURRENCY)} billed</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stock alerts */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-muted-foreground" /> Stock alerts</CardTitle></CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <div className="flex items-center gap-2 py-2 text-sm text-emerald-700">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/10">✓</span>
                All stock above reorder levels.
              </div>
            ) : (
              <div className="space-y-1.5">
                {lowStock.slice(0, 7).map((i) => {
                  const out = i.quantity <= 0;
                  return (
                    <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{i.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-muted-foreground">{i.quantity} {i.unit}</span>
                        <Badge variant={out ? "destructive" : "warning"}>{out ? "Out" : "Low"}</Badge>
                      </span>
                    </div>
                  );
                })}
                {lowStock.length > 7 && <Link href="/inventory/reorder" className="mt-1 inline-block text-xs text-primary hover:underline">+ {lowStock.length - 7} more →</Link>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Purchasing & commissions */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ShoppingCart className="h-4 w-4 text-muted-foreground" /> Purchasing &amp; commissions</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <Link href="/purchasing" className="text-muted-foreground hover:underline">Purchase requests in progress</Link>
              <span className="text-lg font-bold tabular-nums">{prPendingCount}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <Link href="/commissions" className="text-muted-foreground hover:underline">Commissions unpaid</Link>
              <span className="text-lg font-bold tabular-nums">{commissionsUnpaidCount}</span>
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="text-muted-foreground">Amount due</span>
              <span className="font-semibold tabular-nums">{formatCurrency(unpaidCommission, CURRENCY)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cash vouchers */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Banknote className="h-4 w-4 text-muted-foreground" /> Cash vouchers
            {vouchers.length > 0 && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">({notTallied} not tallied · {awaiting} awaiting reconciliation)</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vouchers.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No cash vouchers printed yet. Print one from <Link href="/purchasing" className="text-primary hover:underline">Purchasing</Link> (tick approved requests → Print voucher) and it will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Voucher No.</th>
                    <th className="py-1.5 pr-3 font-medium">Details</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 font-medium">Printed</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => (
                    <tr key={v.no} className="border-b align-top last:border-0">
                      <td className="py-1.5 pr-3 font-semibold tabular-nums text-red-600">{v.no}</td>
                      <td className="py-1.5 pr-3">
                        <div className="font-medium">Paid to {v.paidTo || "—"}</div>
                        <div className="text-xs text-muted-foreground">{v.lines.map((l) => l.description).filter(Boolean).join("; ")}</div>
                        {v.state === "mismatch" && <div className="text-xs text-amber-700">Approved total {formatCurrency(v.approvedTotal, CURRENCY)} · voucher {formatCurrency(v.total, CURRENCY)}</div>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(v.total, CURRENCY)}</td>
                      <td className="py-1.5 pr-3">
                        {v.state === "mismatch" ? <Badge variant="warning">Not tallied</Badge> : v.state === "awaiting" ? <Badge variant="secondary">Awaiting reconciliation</Badge> : <Badge variant="success">Tallied</Badge>}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">{v.printedByName}{v.printedAt ? ` · ${formatDateTime(v.printedAt)}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
