import Link from "next/link";
import { X } from "lucide-react";
import { Prisma, InquiryStatus, InquirySource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getTestMode, testModeCreatedAtFilter } from "@/lib/test-mode";
import { TestModeBanner } from "@/components/test-mode-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InquiriesTable } from "./inquiries-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUS_VALUES: InquiryStatus[] = ["NEW", "DRAFTING", "QUOTED", "SENT", "WON", "LOST"];
const SORT_KEYS = ["created", "customer", "sales", "source", "items", "quotes", "status"] as const;
type SortKey = (typeof SORT_KEYS)[number];

function orderByFor(sort: SortKey, dir: "asc" | "desc"): Prisma.InquiryOrderByWithRelationInput[] {
  const tiebreak: Prisma.InquiryOrderByWithRelationInput = { id: "desc" };
  switch (sort) {
    case "customer": return [{ customer: { company: dir } }, tiebreak];
    case "sales": return [{ createdBy: { name: dir } }, tiebreak];
    case "source": return [{ source: dir }, tiebreak];
    case "items": return [{ items: { _count: dir } }, tiebreak];
    case "quotes": return [{ quotations: { _count: dir } }, tiebreak];
    case "status": return [{ status: dir }, tiebreak];
    case "created":
    default: return [{ createdAt: dir }, tiebreak];
  }
}

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const sp = await searchParams;
  // A dashboard status box links here with ?status=<stage>; filter to it.
  const status = STATUS_VALUES.includes(sp.status as InquiryStatus)
    ? (sp.status as InquiryStatus)
    : null;

  const q = (sp.q ?? "").trim();
  const sort: SortKey = (SORT_KEYS as readonly string[]).includes(sp.sort ?? "")
    ? (sp.sort as SortKey)
    : "created";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  // Search across customer company, sales (createdBy) name, source, and status
  // (enum values matched by substring). Combined with the status filter via AND.
  const ql = q.toLowerCase();
  const statusMatches = q ? Object.values(InquiryStatus).filter((s) => s.toLowerCase().includes(ql)) : [];
  const sourceMatches = q ? Object.values(InquirySource).filter((s) => s.toLowerCase().includes(ql)) : [];
  const searchOr: Prisma.InquiryWhereInput[] = [
    { customer: { company: { contains: q, mode: Prisma.QueryMode.insensitive } } },
    { createdBy: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } },
    ...(statusMatches.length ? [{ status: { in: statusMatches } }] : []),
    ...(sourceMatches.length ? [{ source: { in: sourceMatches } }] : []),
  ];
  // Test mode hides pre-cutoff inquiries (kept, not deleted).
  const cutoff = testModeCreatedAtFilter(await getTestMode());
  const where: Prisma.InquiryWhereInput = {
    AND: [status ? { status } : {}, q ? { OR: searchOr } : {}, cutoff ? { createdAt: cutoff } : {}],
  };

  const [inquiries, total, user] = await Promise.all([
    prisma.inquiry.findMany({
      where,
      orderBy: orderByFor(sort, dir),
      include: {
        customer: true,
        createdBy: true,
        _count: { select: { items: true, quotations: true } },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.inquiry.count({ where }),
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

      <TestModeBanner on={!!cutoff} />


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
          <InquiriesTable
            rows={rows}
            admin={admin}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            query={q}
            sort={sort}
            dir={dir}
          />
        </CardContent>
      </Card>
    </div>
  );
}
