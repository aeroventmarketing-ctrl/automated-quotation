import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { getCounterSaleViewer } from "@/lib/counter-sale-access";
import { COUNTER_STATUS_LABEL, paymentMethodLabel, type CounterSaleStatusKey } from "@/lib/counter-sale";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<CounterSaleStatusKey, "secondary" | "success" | "destructive"> = {
  DRAFT: "secondary",
  COMPLETED: "success",
  VOID: "destructive",
};

function fmtWhen(d: Date | null): string {
  return d ? d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

export default async function CounterSalesPage() {
  const { allowed } = await getCounterSaleViewer();
  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">You don&apos;t have access to Counter Sales.</div>;
  }

  const sales = await prisma.counterSale.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: { customer: { select: { company: true } }, _count: { select: { items: true } } },
    take: 200,
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Counter Sales</h1>
          <p className="text-sm text-muted-foreground">Walk-in / over-the-counter cash sales of stock items.</p>
        </div>
        <Button asChild size="sm">
          <Link href="/counter-sales/new">New Sale</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Sales</CardTitle></CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No counter sales yet. Start one with &ldquo;New sale&rdquo;.</p>
          ) : (
            <ul className="divide-y">
              {sales.map((s) => {
                const status = s.status as CounterSaleStatusKey;
                const uncleared = s.status === "COMPLETED" && !s.paymentCleared;
                return (
                  <li key={s.id}>
                    <Link href={`/counter-sales/${s.id}`} className="-mx-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-2.5 hover:bg-accent">
                      <span className="w-32 shrink-0 font-mono text-xs text-muted-foreground">{s.saleNumber ?? "Draft"}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{s.customer.company}</span>
                      <Badge variant={s.vatMode === "INCLUSIVE" ? "secondary" : "default"} className="font-normal">{s.vatMode === "INCLUSIVE" ? "VAT incl." : "VAT excl."}</Badge>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{s._count.items} item{s._count.items === 1 ? "" : "s"}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{paymentMethodLabel(s.paymentMethod)}</span>
                      {uncleared && <Badge variant="warning" className="font-normal">Uncleared</Badge>}
                      <Badge variant={STATUS_VARIANT[status]} className="font-normal">{COUNTER_STATUS_LABEL[status]}</Badge>
                      <span className="w-40 shrink-0 text-right font-semibold tabular-nums">{formatCurrency(Number(s.total))}</span>
                      <span className="hidden w-40 shrink-0 text-right text-xs text-muted-foreground md:inline">{fmtWhen(s.completedAt ?? s.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
