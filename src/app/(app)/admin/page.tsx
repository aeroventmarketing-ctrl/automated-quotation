import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPropellerSpLock } from "@/lib/propeller-lock";
import { QuoteNumberSetting } from "./quote-number-setting";
import { PropellerLockSetting } from "./propeller-lock-setting";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [users, catalogue, prices, ratings, templates, inquiries, quotations, counter, propellerSpLock] = await Promise.all([
    prisma.user.count(),
    prisma.catalogueItem.count(),
    prisma.priceListEntry.count(),
    prisma.fanRatingPoint.count(),
    prisma.quotationTemplate.count(),
    prisma.inquiry.count(),
    prisma.quotation.count(),
    prisma.quoteCounter.findUnique({ where: { year: 0 } }),
    getPropellerSpLock(),
  ]);
  const nextQuoteSeq = (counter?.lastValue ?? 0) + 1;

  const stats = [
    { label: "Users", value: users, href: "/admin/users" },
    { label: "Catalogue items", value: catalogue, href: "/admin/catalogue" },
    { label: "Pricelist entries", value: prices, href: "/admin/catalogue" },
    { label: "Rating points", value: ratings, href: "/admin/ratings" },
    { label: "Templates", value: templates, href: "/admin/templates" },
    { label: "Inquiries", value: inquiries, href: "/inquiries" },
    { label: "Quotations", value: quotations, href: "/quotations" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="transition-colors hover:bg-accent">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground">{s.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{s.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <QuoteNumberSetting current={nextQuoteSeq} />
      <PropellerLockSetting enabled={propellerSpLock} />
    </div>
  );
}
