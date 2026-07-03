import Link from "next/link";
import { X } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { QuotationsTable } from "./quotations-table";

export const dynamic = "force-dynamic";

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ today?: string }>;
}) {
  const { today } = await searchParams;
  // The dashboard "Quotes drafted today" box links here with ?today=1.
  const todayOnly = today === "1";
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [quotations, user] = await Promise.all([
    prisma.quotation.findMany({
      where: todayOnly ? { createdAt: { gte: startOfDay } } : undefined,
      orderBy: { createdAt: "desc" },
      include: { inquiry: { include: { customer: true } }, preparedBy: true },
      take: 100,
    }),
    getCurrentUser(),
  ]);
  const admin = isAdmin(user);

  const rows = quotations.map((q) => ({
    id: q.id,
    quoteNumber: q.quoteNumber,
    company: q.inquiry.customer.company,
    customerId: q.inquiry.customerId,
    preparedByName: q.preparedBy.name,
    total: Number(q.total),
    currency: q.currency,
    createdISO: q.createdAt.toISOString(),
    status: q.status,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Quotations</h1>

      {todayOnly && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Showing:</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary">
            Drafted today
            <Link href="/quotations" title="Clear filter" className="hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </Link>
          </span>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <QuotationsTable rows={rows} admin={admin} />
        </CardContent>
      </Card>
    </div>
  );
}
