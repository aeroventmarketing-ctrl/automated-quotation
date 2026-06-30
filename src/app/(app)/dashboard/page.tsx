import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InquiryStatusBadge } from "@/components/status-badge";
import { formatDate, formatCurrency } from "@/lib/utils";
import type { InquiryStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUSES: InquiryStatus[] = ["NEW", "DRAFTING", "QUOTED", "SENT", "WON", "LOST"];
const DAYS = 14;

/** Local Y-M-D key so buckets line up with the server's "today". */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since = new Date(startOfDay);
  since.setDate(since.getDate() - (DAYS - 1));
  const weekAgo = new Date(startOfDay);
  weekAgo.setDate(weekAgo.getDate() - 6);

  const [byStatus, quotesToday, recentInquiries, recentQuotes] = await Promise.all([
    prisma.inquiry.groupBy({ by: ["status"], _count: true }),
    prisma.quotation.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.inquiry.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: true, _count: { select: { items: true } } },
    }),
    prisma.quotation.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, total: true },
    }),
  ]);

  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count])) as Record<
    InquiryStatus,
    number
  >;

  // Build the last-14-days buckets (count + value) for the daily chart.
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(startOfDay);
    d.setDate(d.getDate() - (DAYS - 1 - i));
    return d;
  });
  const countByDay = new Map(days.map((d) => [dayKey(d), 0]));
  const valueByDay = new Map(days.map((d) => [dayKey(d), 0]));
  for (const q of recentQuotes) {
    const k = dayKey(new Date(q.createdAt));
    if (countByDay.has(k)) {
      countByDay.set(k, (countByDay.get(k) ?? 0) + 1);
      valueByDay.set(k, (valueByDay.get(k) ?? 0) + Number(q.total));
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

  // KPIs.
  const total14 = recentQuotes.length;
  const value14 = recentQuotes.reduce((a, q) => a + Number(q.total), 0);
  const quotes7 = recentQuotes.filter((q) => new Date(q.createdAt) >= weekAgo).length;
  const avgPerDay = Math.round((total14 / DAYS) * 10) / 10;
  const won = counts.WON ?? 0;
  const lost = counts.LOST ?? 0;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;
  const maxStatus = Math.max(1, ...STATUSES.map((s) => counts[s] ?? 0));

  const CHART_H = 150; // px

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
          { label: "Avg quotes / day", value: String(avgPerDay) },
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
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round((c / maxStatus) * 100)}%` }}
                    />
                  </div>
                  <span className="w-7 shrink-0 text-right text-xs font-semibold">{c}</span>
                </div>
              );
            })}
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
