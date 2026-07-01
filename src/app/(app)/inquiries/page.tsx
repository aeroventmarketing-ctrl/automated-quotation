import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InquiriesTable } from "./inquiries-table";

export const dynamic = "force-dynamic";

export default async function InquiriesPage() {
  const [inquiries, user] = await Promise.all([
    prisma.inquiry.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        createdBy: true,
        _count: { select: { items: true, quotations: true } },
      },
      take: 100,
    }),
    getCurrentUser(),
  ]);
  const admin = isAdmin(user);
  const rows = inquiries.map((inq) => ({
    id: inq.id,
    company: inq.customer.company,
    createdByName: inq.createdBy.name,
    source: inq.source,
    items: inq._count.items,
    quotes: inq._count.quotations,
    createdISO: inq.createdAt.toISOString(),
    status: inq.status,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Inquiries</h1>
        <Button asChild>
          <Link href="/inquiries/new">+ New Inquiry</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <InquiriesTable rows={rows} admin={admin} />
        </CardContent>
      </Card>
    </div>
  );
}
