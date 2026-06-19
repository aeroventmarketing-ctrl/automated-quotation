import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InquiryStatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/utils";
import type { InquiryStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUSES: InquiryStatus[] = ["NEW", "DRAFTING", "QUOTED", "SENT", "WON", "LOST"];

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [byStatus, quotesToday, recentInquiries] = await Promise.all([
    prisma.inquiry.groupBy({ by: ["status"], _count: true }),
    prisma.quotation.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.inquiry.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: true, _count: { select: { items: true } } },
    }),
  ]);

  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count])) as Record<
    InquiryStatus,
    number
  >;

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
