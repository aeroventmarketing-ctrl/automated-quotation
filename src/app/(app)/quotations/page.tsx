import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QuotationStatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function QuotationsPage() {
  const quotations = await prisma.quotation.findMany({
    orderBy: { createdAt: "desc" },
    include: { inquiry: { include: { customer: true } }, preparedBy: true },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Quotations</h1>
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Prepared by</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotations.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <Link href={`/quotations/${q.id}`} className="font-medium hover:underline">
                      {q.quoteNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{q.inquiry.customer.company}</TableCell>
                  <TableCell>{q.preparedBy.name}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(q.total), q.currency)}</TableCell>
                  <TableCell>{formatDate(q.createdAt)}</TableCell>
                  <TableCell><QuotationStatusBadge status={q.status} /></TableCell>
                </TableRow>
              ))}
              {quotations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No quotations yet. Build one from an inquiry.
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
