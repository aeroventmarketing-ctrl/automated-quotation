import Link from "next/link";
import { X } from "lucide-react";
import type { InquiryStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InquiriesTable } from "./inquiries-table";

export const dynamic = "force-dynamic";

const STATUS_VALUES: InquiryStatus[] = ["NEW", "DRAFTING", "QUOTED", "SENT", "WON", "LOST"];

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  // A dashboard status box links here with ?status=<stage>; filter to it.
  const status = STATUS_VALUES.includes(statusParam as InquiryStatus)
    ? (statusParam as InquiryStatus)
    : null;

  const [inquiries, user] = await Promise.all([
    prisma.inquiry.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        createdBy: true,
        _count: { select: { items: true, quotations: true } },
      },
      // Load every inquiry: the table searches/sorts client-side, so a cap here
      // would hide older inquiries from the list and the search entirely.
    }),
    getCurrentUser(),
  ]);
  const admin = isAdmin(user);
  const rows = inquiries.map((inq) => ({
    id: inq.id,
    company: inq.customer.company,
    customerId: inq.customerId,
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

      {status && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filtered by status:</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary">
            {status}
            <Link href="/inquiries" title="Clear filter" className="hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </Link>
          </span>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <InquiriesTable rows={rows} admin={admin} />
        </CardContent>
      </Card>
    </div>
  );
}
