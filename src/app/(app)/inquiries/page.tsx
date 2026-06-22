import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InquiryStatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/utils";
import { InquiryActions } from "./inquiry-actions";

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Quotes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                {admin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {inquiries.map((inq) => (
                <TableRow key={inq.id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/inquiries/${inq.id}`} className="font-medium hover:underline">
                      {inq.customer.company}
                    </Link>
                    <div className="text-xs text-muted-foreground">by {inq.createdBy.name}</div>
                  </TableCell>
                  <TableCell>{inq.source}</TableCell>
                  <TableCell>{inq._count.items}</TableCell>
                  <TableCell>{inq._count.quotations}</TableCell>
                  <TableCell>{formatDate(inq.createdAt)}</TableCell>
                  <TableCell>
                    <InquiryStatusBadge status={inq.status} />
                  </TableCell>
                  {admin && (
                    <TableCell>
                      <InquiryActions id={inq.id} label={inq.customer.company} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {inquiries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={admin ? 7 : 6} className="text-center text-muted-foreground">
                    No inquiries yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
