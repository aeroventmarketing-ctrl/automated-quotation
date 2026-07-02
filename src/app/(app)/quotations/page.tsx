import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { QuotationsTable } from "./quotations-table";

export const dynamic = "force-dynamic";

export default async function QuotationsPage() {
  const [quotations, user] = await Promise.all([
    prisma.quotation.findMany({
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
      <Card>
        <CardContent className="pt-6">
          <QuotationsTable rows={rows} admin={admin} />
        </CardContent>
      </Card>
    </div>
  );
}
