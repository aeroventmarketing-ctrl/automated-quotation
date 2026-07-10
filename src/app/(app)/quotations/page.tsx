import Link from "next/link";
import { X } from "lucide-react";
import { Prisma, QuotationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { quoteSignature, type SigItem } from "@/lib/quote-signature";
import { QuotationsTable } from "./quotations-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SORT_KEYS = ["created", "quote", "customer", "prepared", "total", "status"] as const;
type SortKey = (typeof SORT_KEYS)[number];

function orderByFor(sort: SortKey, dir: "asc" | "desc"): Prisma.QuotationOrderByWithRelationInput[] {
  const tiebreak: Prisma.QuotationOrderByWithRelationInput = { id: "desc" };
  switch (sort) {
    case "quote": return [{ quoteNumber: dir }, tiebreak];
    case "customer": return [{ inquiry: { customer: { company: dir } } }, tiebreak];
    case "prepared": return [{ preparedBy: { name: dir } }, tiebreak];
    case "total": return [{ total: dir }, tiebreak];
    case "status": return [{ status: dir }, tiebreak];
    case "created":
    default: return [{ createdAt: dir }, tiebreak];
  }
}

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ today?: string; q?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const sp = await searchParams;
  // The dashboard "Quotes drafted today" box links here with ?today=1.
  const todayOnly = sp.today === "1";
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const q = (sp.q ?? "").trim();
  const sort: SortKey = (SORT_KEYS as readonly string[]).includes(sp.sort ?? "")
    ? (sp.sort as SortKey)
    : "created";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  // Search across quote #, customer company, prepared-by name, and status (enum
  // values matched by substring, e.g. "sent" → SENT). Combined with the today
  // filter via AND so both apply.
  const statusMatches = q
    ? Object.values(QuotationStatus).filter((s) => s.toLowerCase().includes(q.toLowerCase()))
    : [];
  const searchOr: Prisma.QuotationWhereInput[] = [
    { quoteNumber: { contains: q, mode: Prisma.QueryMode.insensitive } },
    { inquiry: { customer: { company: { contains: q, mode: Prisma.QueryMode.insensitive } } } },
    { preparedBy: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } },
    ...(statusMatches.length ? [{ status: { in: statusMatches } }] : []),
  ];
  const where: Prisma.QuotationWhereInput = {
    AND: [todayOnly ? { createdAt: { gte: startOfDay } } : {}, q ? { OR: searchOr } : {}],
  };

  const [quotations, total, user] = await Promise.all([
    prisma.quotation.findMany({
      where,
      orderBy: orderByFor(sort, dir),
      include: { inquiry: { include: { customer: true } }, preparedBy: true },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.quotation.count({ where }),
    getCurrentUser(),
  ]);
  const admin = isAdmin(user);

  // Duplicate flags: for the quotes on this page, count other quotations with an
  // identical line-item set (same subtotal is a cheap candidate filter; the exact
  // signature confirms). Only quotes sharing a subtotal are loaded.
  const dupCount = new Map<string, number>();
  // Only non-zero subtotals (a 0 subtotal is an empty/unpriced draft — skip so we
  // don't scan every draft, and they aren't flagged as look-alikes).
  const subtotals = Array.from(new Set(quotations.map((q) => q.subtotal))).filter((s) => Number(s) > 0);
  if (subtotals.length) {
    const candidates = await prisma.quotation.findMany({
      where: { subtotal: { in: subtotals } },
      select: { id: true, items: { select: { specsSnapshot: true, qty: true, catalogueItemId: true } } },
    });
    const idToSig = new Map<string, string>();
    const sigCount = new Map<string, number>();
    for (const c of candidates) {
      const sig = quoteSignature(c.items as SigItem[]);
      idToSig.set(c.id, sig);
      if (sig) sigCount.set(sig, (sigCount.get(sig) ?? 0) + 1);
    }
    for (const q of quotations) {
      const sig = idToSig.get(q.id);
      const n = sig ? (sigCount.get(sig) ?? 0) - 1 : 0;
      if (n > 0) dupCount.set(q.id, n);
    }
  }

  const rows = quotations.map((quote) => ({
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    company: quote.inquiry.customer.company,
    customerId: quote.inquiry.customerId,
    preparedByName: quote.preparedBy.name,
    total: Number(quote.total),
    currency: quote.currency,
    createdISO: quote.createdAt.toISOString(),
    status: quote.status,
    dupCount: dupCount.get(quote.id) ?? 0,
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
          <QuotationsTable
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
