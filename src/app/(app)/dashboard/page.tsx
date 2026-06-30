import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InquiryStatusBadge } from "@/components/status-badge";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Award } from "lucide-react";
import type { InquiryStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUSES: InquiryStatus[] = ["NEW", "DRAFTING", "QUOTED", "SENT", "WON", "LOST"];
const DAYS = 14; // daily quotations bar chart window
const LINE_DAYS = 30; // value-over-time + salesperson/customer window
const MONTHS = 6; // monthly trend window

/** Local Y-M-D key so day buckets line up with the server's "today". */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since14 = new Date(startOfDay);
  since14.setDate(since14.getDate() - (DAYS - 1));
  const since30 = new Date(startOfDay);
  since30.setDate(since30.getDate() - (LINE_DAYS - 1));
  const weekAgo = new Date(startOfDay);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const since6mo = new Date(startOfDay);
  since6mo.setDate(1);
  since6mo.setMonth(since6mo.getMonth() - (MONTHS - 1));

  const [byStatus, quotesToday, recentInquiries, quotes] = await Promise.all([
    prisma.inquiry.groupBy({ by: ["status"], _count: true }),
    prisma.quotation.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.inquiry.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: true, _count: { select: { items: true } } },
    }),
    prisma.quotation.findMany({
      where: { createdAt: { gte: since6mo } },
      select: {
        createdAt: true,
        total: true,
        classification: true,
        preparedBy: { select: { name: true } },
        inquiry: { select: { customer: { select: { company: true } } } },
      },
    }),
  ]);

  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count])) as Record<
    InquiryStatus,
    number
  >;

  // --- Daily quotations (last 14 days): count + value ----------------------
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(startOfDay);
    d.setDate(d.getDate() - (DAYS - 1 - i));
    return d;
  });
  const countByDay = new Map(days.map((d) => [dayKey(d), 0]));
  const valueByDay = new Map(days.map((d) => [dayKey(d), 0]));
  // --- Value over time (last 30 days) --------------------------------------
  const days30 = Array.from({ length: LINE_DAYS }, (_, i) => {
    const d = new Date(startOfDay);
    d.setDate(d.getDate() - (LINE_DAYS - 1 - i));
    return d;
  });
  const value30 = new Map(days30.map((d) => [dayKey(d), 0]));
  // --- Monthly trend (last 6 months) ---------------------------------------
  const months = Array.from({ length: MONTHS }, (_, i) => {
    const d = new Date(startOfDay);
    d.setDate(1);
    d.setMonth(d.getMonth() - (MONTHS - 1 - i));
    return d;
  });
  const monthCount = new Map(months.map((d) => [monthKey(d), 0]));
  // --- Salesperson (actual sales) + customers (quoted, last 30 days) -------
  const salesMap = new Map<string, number>(); // amount SOLD per salesperson, 30d
  const custMap = new Map<string, number>(); // quoted value per customer, 30d
  // --- Per-month amount SOLD per salesperson (top salesperson of the month) -
  const monthSales = new Map(months.map((d) => [monthKey(d), new Map<string, number>()]));
  const currentMK = monthKey(startOfDay);
  let salesMTD = 0; // amount sold this calendar month

  for (const q of quotes) {
    const at = new Date(q.createdAt);
    const dk = dayKey(at);
    const total = Number(q.total);
    const name = q.preparedBy?.name ?? "—";
    // Quote-activity buckets (by creation date).
    if (countByDay.has(dk)) {
      countByDay.set(dk, (countByDay.get(dk) ?? 0) + 1);
      valueByDay.set(dk, (valueByDay.get(dk) ?? 0) + total);
    }
    if (value30.has(dk)) value30.set(dk, (value30.get(dk) ?? 0) + total);
    const mk = monthKey(at);
    if (monthCount.has(mk)) monthCount.set(mk, (monthCount.get(mk) ?? 0) + 1);
    if (at >= since30) {
      const company = q.inquiry.customer.company || "—";
      custMap.set(company, (custMap.get(company) ?? 0) + total);
    }
    // Sales buckets (by the date the quote was marked sold).
    const sale = (q.classification as Record<string, unknown> | null)?.sale as { soldAt?: string } | null | undefined;
    const soldAt = sale?.soldAt ? new Date(sale.soldAt) : null;
    if (soldAt) {
      const smk = monthKey(soldAt);
      const sms = monthSales.get(smk);
      if (sms) sms.set(name, (sms.get(name) ?? 0) + total);
      if (soldAt >= since30) salesMap.set(name, (salesMap.get(name) ?? 0) + total);
      if (smk === currentMK) salesMTD += total;
    }
  }

  // Top salesperson of the month: the current month's leader by amount SOLD.
  // If the current month has no sales yet, the previous month's winner is
  // retained until a new leader emerges (then it switches).
  const leaderOf = (mk: string): { name: string; amount: number } | null => {
    const ms = monthSales.get(mk);
    if (!ms || ms.size === 0) return null;
    let best: string | null = null;
    let bestV = -1;
    for (const [n, v] of ms) if (v > bestV) ((best = n), (bestV = v));
    return best ? { name: best, amount: bestV } : null;
  };
  let topSales: { name: string; amount: number; monthLabel: string } | null = null;
  for (let i = months.length - 1; i >= 0; i--) {
    const found = leaderOf(monthKey(months[i]));
    if (found) {
      topSales = { ...found, monthLabel: months[i].toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
      break;
    }
  }

  const daily = days.map((d) => ({
    key: dayKey(d),
    label: d.toLocaleDateString("en-US", { day: "numeric" }),
    full: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    count: countByDay.get(dayKey(d)) ?? 0,
    value: valueByDay.get(dayKey(d)) ?? 0,
  }));
  const maxCount = Math.max(1, ...daily.map((d) => d.count));

  const line = days30.map((d) => ({ key: dayKey(d), date: d, value: value30.get(dayKey(d)) ?? 0 }));
  const lineMax = Math.max(1, ...line.map((p) => p.value));

  const monthly = months.map((d) => ({
    label: d.toLocaleDateString("en-US", { month: "short" }),
    count: monthCount.get(monthKey(d)) ?? 0,
  }));
  const maxMonth = Math.max(1, ...monthly.map((m) => m.count));

  const bySales = [...salesMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const maxSales = Math.max(1, ...bySales.map((s) => s.value));

  const topCustomers = [...custMap.entries()]
    .map(([company, value]) => ({ company, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const maxCust = Math.max(1, ...topCustomers.map((c) => c.value));

  // --- KPIs ----------------------------------------------------------------
  const last14 = quotes.filter((q) => new Date(q.createdAt) >= since14);
  const total14 = last14.length;
  const value14 = last14.reduce((a, q) => a + Number(q.total), 0);
  const quotes7 = quotes.filter((q) => new Date(q.createdAt) >= weekAgo).length;
  const won = counts.WON ?? 0;
  const lost = counts.LOST ?? 0;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;
  const maxStatus = Math.max(1, ...STATUSES.map((s) => counts[s] ?? 0));

  const CHART_H = 150; // px
  // Value-over-time line/area geometry (stretched to fill width).
  const LW = 300;
  const LH = 80;
  const coords = line.map((p, i) => ({
    x: line.length > 1 ? (i / (line.length - 1)) * LW : 0,
    y: LH - 2 - (p.value / lineMax) * (LH - 6),
  }));
  const linePath = coords.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPath =
    coords.length > 0
      ? `M${coords[0].x.toFixed(1)},${LH} ` +
        coords.map((c) => `L${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ") +
        ` L${coords[coords.length - 1].x.toFixed(1)},${LH} Z`
      : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {user?.name}.</p>
        </div>
        <Button asChild>
          <Link href="/inquiries/new">+ New Inquiry</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Quotes drafted today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{quotesToday}</div>
          </CardContent>
        </Card>
        {STATUSES.map((s) => (
          <Card key={s}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">{s.replace("_", " ")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{counts[s] ?? 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Quotes this week", value: String(quotes7) },
          { label: "Quotes last 14 days", value: String(total14) },
          { label: "Sales this month", value: formatCurrency(salesMTD) },
          { label: "Win rate", value: winRate == null ? "—" : `${winRate}%` },
        ].map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs uppercase text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top salesperson of the month (retained across the month boundary). */}
      {topSales && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Award className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Top salesperson · {topSales.monthLabel}
              </div>
              <div className="text-xl font-bold">{topSales.name}</div>
              <div className="text-xs text-muted-foreground">
                {formatCurrency(topSales.amount)} sold
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Daily quotations bar chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-baseline justify-between space-y-0">
            <CardTitle>Quotations per day</CardTitle>
            <span className="text-xs text-muted-foreground">
              last {DAYS} days · {formatCurrency(value14)} quoted
            </span>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1" style={{ height: CHART_H + 18 }}>
              {daily.map((d) => (
                <div key={d.key} className="flex flex-1 flex-col items-center justify-end">
                  <span className="mb-0.5 text-[9px] font-medium text-muted-foreground">{d.count || ""}</span>
                  <div
                    className="w-full rounded-t bg-primary transition-all"
                    style={{ height: Math.max(d.count ? 3 : 0, Math.round((d.count / maxCount) * CHART_H)) }}
                    title={`${d.full}: ${d.count} quote(s)${d.value ? ` · ${formatCurrency(d.value)}` : ""}`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1">
              {daily.map((d) => (
                <span key={d.key} className="flex-1 text-center text-[9px] text-muted-foreground">
                  {d.label}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Pipeline by status */}
        <Card>
          <CardHeader>
            <CardTitle>Pipeline by status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-1">
            {STATUSES.map((s) => {
              const c = counts[s] ?? 0;
              return (
                <div key={s} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">{s}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((c / maxStatus) * 100)}%` }} />
                  </div>
                  <span className="w-7 shrink-0 text-right text-xs font-semibold">{c}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Value over time (line) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-baseline justify-between space-y-0">
            <CardTitle>Quoted value over time</CardTitle>
            <span className="text-xs text-muted-foreground">last {LINE_DAYS} days · peak {formatCurrency(lineMax)}/day</span>
          </CardHeader>
          <CardContent>
            <svg viewBox={`0 0 ${LW} ${LH}`} preserveAspectRatio="none" className="h-36 w-full">
              {areaPath && <path d={areaPath} className="fill-primary/10" />}
              <path d={linePath} className="fill-none stroke-primary" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{line[0]?.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              <span>{line[line.length - 1]?.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </div>
          </CardContent>
        </Card>

        {/* Monthly trend */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2" style={{ height: 130 }}>
              {monthly.map((m) => (
                <div key={m.label} className="flex flex-1 flex-col items-center justify-end">
                  <span className="mb-0.5 text-[10px] font-medium text-muted-foreground">{m.count || ""}</span>
                  <div
                    className="w-full rounded-t bg-primary"
                    style={{ height: Math.max(m.count ? 3 : 0, Math.round((m.count / maxMonth) * 105)) }}
                    title={`${m.label}: ${m.count} quote(s)`}
                  />
                  <span className="mt-1 text-[10px] text-muted-foreground">{m.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Quotes by salesperson */}
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0">
            <CardTitle>Sales by salesperson</CardTitle>
            <span className="text-xs text-muted-foreground">amount sold · last {LINE_DAYS} days</span>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-1">
            {bySales.length === 0 && <p className="text-sm text-muted-foreground">No sales recorded in this window.</p>}
            {bySales.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-xs text-muted-foreground" title={s.name}>{s.name}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((s.value / maxSales) * 100)}%` }} />
                </div>
                <span className="shrink-0 text-right text-xs font-semibold">{formatCurrency(s.value)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top customers by quoted value */}
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0">
            <CardTitle>Top customers</CardTitle>
            <span className="text-xs text-muted-foreground">by quoted value · last {LINE_DAYS} days</span>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-1">
            {topCustomers.length === 0 && <p className="text-sm text-muted-foreground">No quotes in this window.</p>}
            {topCustomers.map((c) => (
              <div key={c.company} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate text-xs text-muted-foreground" title={c.company}>{c.company}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((c.value / maxCust) * 100)}%` }} />
                </div>
                <span className="shrink-0 text-right text-xs font-semibold">{formatCurrency(c.value)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent inquiries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentInquiries.length === 0 && (
            <p className="text-sm text-muted-foreground">No inquiries yet. Create one to get started.</p>
          )}
          {recentInquiries.map((inq) => (
            <Link
              key={inq.id}
              href={`/inquiries/${inq.id}`}
              className="flex items-center justify-between rounded-md border p-3 hover:bg-accent"
            >
              <div>
                <div className="font-medium">{inq.customer.company}</div>
                <div className="text-xs text-muted-foreground">
                  {inq._count.items} item(s) · {inq.source} · {formatDate(inq.createdAt)}
                </div>
              </div>
              <InquiryStatusBadge status={inq.status} />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
