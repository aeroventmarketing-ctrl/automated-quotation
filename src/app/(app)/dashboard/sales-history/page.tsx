import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { isClientRestricted } from "@/lib/client-visibility";
import { getTestMode, testModeCreatedAtFilter } from "@/lib/test-mode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { buildSalesHistory, counterSaleEvent, quoteSaleEvent, shareOf, type SalesMonth } from "@/lib/monthly-sales";

export const dynamic = "force-dynamic";

const RANGES = { "12": 12, "24": 24, all: Infinity } as const;
type Range = keyof typeof RANGES;

/** "₱6.0M" / "₱850K" — for the bar labels, where the full figure won't fit. */
function compactPeso(n: number): string {
  if (n >= 1_000_000) return `₱${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `₱${Math.round(n / 1_000)}K`;
  return n > 0 ? `₱${Math.round(n)}` : "";
}

function Change({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const cls = v > 0 ? "text-emerald-600" : v < 0 ? "text-red-600" : "text-muted-foreground";
  return <span className={cls}>{v > 0 ? "▲" : v < 0 ? "▼" : ""} {Math.abs(v)}%</span>;
}

export default async function SalesHistoryPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const [user, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  if (!user) redirect("/login");
  // Shop-floor roles don't see sales amounts — the same rule as the dashboard tile.
  if (await isClientRestricted(user, assignments)) redirect("/dashboard");

  const sp = await searchParams;
  const range: Range = sp.range === "24" || sp.range === "all" ? sp.range : "12";

  const cutoff = testModeCreatedAtFilter(await getTestMode());
  const [quotes, counterSales] = await Promise.all([
    prisma.quotation.findMany({
      where: cutoff ? { createdAt: cutoff } : undefined,
      select: { createdAt: true, total: true, discountPct: true, vatMode: true, classification: true, preparedBy: { select: { name: true } } },
    }),
    prisma.counterSale
      .findMany({
        where: { status: "COMPLETED", ...(cutoff ? { createdAt: cutoff } : {}) },
        select: { total: true, completedAt: true, createdAt: true, salespersonName: true, soldByName: true },
      })
      .catch(() => [] as { total: unknown; completedAt: Date | null; createdAt: Date; salespersonName: string | null; soldByName: string }[]),
  ]);
  const events = [
    ...quotes.map(quoteSaleEvent).filter((e): e is NonNullable<typeof e> => e != null),
    ...counterSales.map(counterSaleEvent),
  ];
  const h = buildSalesHistory(events, new Date());

  const shown: SalesMonth[] = h.months.slice(-Math.min(RANGES[range], h.months.length));
  const max = Math.max(1, ...shown.map((m) => m.total));
  const avgShown = shown.length ? shown.reduce((s, m) => s + m.total, 0) / shown.length : 0;
  const CH = 220; // chart height, px

  const tm = h.thisMonth;
  const lm = h.lastMonth;
  const share = tm && lm ? shareOf(tm.total, lm.total) : null;
  const deals = (m: SalesMonth) => m.quoteDeals + m.counterDeals;
  const ytdChange = h.ytdLastYear > 0 ? Math.round(((h.ytd - h.ytdLastYear) / h.ytdLastYear) * 1000) / 10 : null;
  const year = tm?.key.slice(0, 4);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Sales Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Monthly sales history</h1>
        <p className="text-sm text-muted-foreground">
          Confirmed sales booked on their payment / PO date, plus completed counter sales — the same figure as the &ldquo;Sales this month&rdquo; tile.
        </p>
      </div>

      {/* In words */}
      {tm && (
        <Card>
          <CardContent className="space-y-1.5 pt-5 text-sm leading-relaxed">
            <p>
              <b>{tm.label}</b> so far: <b>{formatCurrency(tm.total)}</b> from {deals(tm)} sale{deals(tm) === 1 ? "" : "s"}
              {tm.top && <> — led by <b>{tm.top.name}</b> ({formatCurrency(tm.top.amount)})</>}.
            </p>
            {lm && (
              <p>
                <b>{lm.label}</b> closed at <b>{formatCurrency(lm.total)}</b> from {deals(lm)} sale{deals(lm) === 1 ? "" : "s"}
                {share != null && <>; this month has reached <b>{share}%</b> of it</>}.
              </p>
            )}
            {h.best && (
              <p>
                Best month on record: <b>{h.best.label}</b> at <b>{formatCurrency(h.best.total)}</b>.
              </p>
            )}
            {h.last12.months > 0 && (
              <p>
                The last {h.last12.months} complete month{h.last12.months === 1 ? "" : "s"} total <b>{formatCurrency(h.last12.total)}</b>, an average of{" "}
                <b>{formatCurrency(h.last12.average)}</b> a month.
              </p>
            )}
            <p>
              {year} to date: <b>{formatCurrency(h.ytd)}</b>
              {h.ytdLastYear > 0 && (
                <>
                  {" "}against {formatCurrency(h.ytdLastYear)} over the same months of {Number(year) - 1} (<Change v={ytdChange} />)
                </>
              )}
              .
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "This month", value: formatCurrency(tm?.total ?? 0) },
          { label: "Last month", value: formatCurrency(lm?.total ?? 0) },
          { label: "Monthly average (12 mo)", value: formatCurrency(h.last12.average) },
          { label: `${year ?? ""} to date`, value: formatCurrency(h.ytd) },
        ].map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs uppercase text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold tabular-nums">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Graph */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0">
          <CardTitle>Sales per month</CardTitle>
          <div className="flex gap-1 text-xs">
            {(["12", "24", "all"] as Range[]).map((r) => (
              <Link
                key={r}
                href={`/dashboard/sales-history?range=${r}`}
                className={`rounded-md border px-2 py-1 ${r === range ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                {r === "all" ? "All" : `${r} months`}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {/* rtl on the scroller opens a narrow screen at the latest month; the bars stay left-to-right. */}
          <div className="overflow-x-auto" style={{ direction: "rtl" }}>
            <div className="relative" style={{ minWidth: shown.length * 44, direction: "ltr" }}>
              {avgShown > 0 && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-amber-500"
                  style={{ bottom: 34 + Math.round((avgShown / max) * CH) }}
                  title={`Average ${formatCurrency(avgShown)}`}
                >
                  <span className="absolute right-0 -top-4 bg-card px-1 text-[10px] text-amber-600">avg {compactPeso(avgShown)}</span>
                </div>
              )}
              <div className="flex items-end gap-1.5" style={{ height: CH + 34 }}>
                {shown.map((m, i) => {
                  const current = i === shown.length - 1;
                  return (
                    <div key={m.key} className="flex min-w-0 flex-1 flex-col items-center justify-end">
                      <span className="mb-0.5 whitespace-nowrap text-[10px] font-medium text-muted-foreground">{compactPeso(m.total)}</span>
                      <div
                        className={`w-full rounded-t ${current ? "bg-primary/50" : "bg-primary"}`}
                        style={{ height: Math.max(m.total ? 3 : 0, Math.round((m.total / max) * CH)) }}
                        title={`${m.label}: ${formatCurrency(m.total)} · ${deals(m)} sale(s)${current ? " (so far)" : ""}`}
                      />
                      <span className="mt-1 whitespace-nowrap text-[10px] text-muted-foreground">{m.short}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The lighter bar is the month in progress. Dashed line: the average of the months shown.</p>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Month by month</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3">Month</th>
                <th className="py-2 pr-3 text-right">Sales</th>
                <th className="py-2 pr-3 text-right">vs prior month</th>
                <th className="py-2 pr-3 text-right">Orders</th>
                <th className="py-2 pr-3 text-right">Counter sales</th>
                <th className="py-2 pr-3">Top salesperson</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {[...h.months].reverse().map((m, i) => (
                <tr key={m.key} className="border-b last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 font-medium">
                    {m.label}
                    {i === 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">(so far)</span>}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums">{formatCurrency(m.total)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-xs tabular-nums">
                    {/* A month in progress against a whole month reads as a slump — say so instead. */}
                    {i === 0 ? <span className="text-muted-foreground">in progress</span> : <Change v={m.change} />}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{m.quoteDeals}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{m.counterDeals}</td>
                  <td className="py-2 pr-3">
                    {m.top ? (
                      <>
                        {m.top.name} <span className="text-xs text-muted-foreground">{formatCurrency(m.top.amount)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right text-xs">
                    {m.total > 0 && (
                      <Link href={`/inquiries/report?from=${m.from}&to=${m.to}&basis=won`} className="text-primary hover:underline">
                        Deals →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
