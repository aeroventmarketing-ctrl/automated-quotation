import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { payableTotal, round2 } from "@/lib/quote";
import { saleFromClassification, isSaleConfirmed, collectedTotal } from "@/lib/sale";
import { readOrderWorkflow, ORDER_STAGES, PRODUCTION_DEPTS, type OrderStage } from "@/lib/order-workflow";

export const dynamic = "force-dynamic";

const CURRENCY = "PHP";

export default async function ManagementPage() {
  const [wonQuotes, stockItems, commissions, prPending] = await Promise.all([
    prisma.quotation.findMany({
      where: { inquiry: { status: "WON" } },
      select: { id: true, classification: true, total: true, discountPct: true, vatMode: true },
    }),
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" } }).catch(() => []),
    prisma.commission.findMany({ where: { paid: false } }).catch(() => []),
    prisma.purchaseRequest.findMany({ where: { status: { notIn: ["COMPLETED", "REJECTED"] } }, select: { id: true } }).catch(() => []),
  ]);

  // Orders (confirmed sales) → stage counts, receivables, production load.
  const stageCount = new Map<OrderStage, number>();
  const prodActive = new Map<string, number>();
  let orderCount = 0;
  let outstanding = 0;
  let openOrders = 0;

  for (const q of wonQuotes) {
    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;
    orderCount++;
    const wf = readOrderWorkflow(q.classification);
    stageCount.set(wf.stage, (stageCount.get(wf.stage) ?? 0) + 1);
    if (wf.stage !== "closed") openOrders++;

    const balance = round2(payableTotal(q) - collectedTotal(sale));
    if (balance > 0.005) outstanding = round2(outstanding + balance);

    if (wf.stage === "in_production" || wf.stage === "jo_received") {
      for (const d of PRODUCTION_DEPTS) {
        const jo = wf.jobOrders[d.key];
        if (jo && jo.status !== "finished") prodActive.set(d.key, (prodActive.get(d.key) ?? 0) + 1);
      }
    }
  }

  const lowStock = stockItems.filter((i) => {
    const q = Number(i.quantity);
    const r = Number(i.reorderLevel);
    return q <= 0 || (r > 0 && q <= r);
  });
  const unpaidCommission = round2(commissions.reduce((a, c) => a + Number(c.amount), 0));

  const tiles = [
    { label: "Open orders", value: String(openOrders), href: "/orders" },
    { label: "Receivables", value: formatCurrency(outstanding, CURRENCY), href: "/orders" },
    { label: "Low / out of stock", value: String(lowStock.length), href: "/inventory/reorder" },
    { label: "Unpaid commissions", value: formatCurrency(unpaidCommission, CURRENCY), href: "/commissions" },
  ];

  const totalProd = [...prodActive.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Management</h1>
        <p className="text-sm text-muted-foreground">Live snapshot across orders, production, inventory, receivables, purchasing, and commissions.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="transition-colors hover:bg-accent">
              <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">{t.label}</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold tabular-nums">{t.value}</div></CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Orders by stage */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Orders by stage</CardTitle></CardHeader>
          <CardContent>
            {orderCount === 0 ? (
              <p className="text-sm text-muted-foreground">No confirmed orders yet.</p>
            ) : (
              <div className="space-y-1.5">
                {ORDER_STAGES.map((s) => {
                  const n = stageCount.get(s.key) ?? 0;
                  return (
                    <div key={s.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className={n > 0 ? "" : "text-muted-foreground"}>{s.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums font-medium">{n}</span>
                        <span className="text-[10px] uppercase text-muted-foreground">{s.phase}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Production load */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Production load (active job orders)</CardTitle></CardHeader>
          <CardContent>
            {totalProd === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in production right now.</p>
            ) : (
              <div className="space-y-1.5">
                {PRODUCTION_DEPTS.map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-sm">
                    <span>{d.label}</span>
                    <span className="tabular-nums font-medium">{prodActive.get(d.key) ?? 0}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stock alerts */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Stock alerts</CardTitle></CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">All stock above reorder levels.</p>
            ) : (
              <div className="space-y-1.5">
                {lowStock.slice(0, 8).map((i) => {
                  const q = Number(i.quantity);
                  const out = q <= 0;
                  return (
                    <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{i.name}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-muted-foreground">{q} {i.unit}</span>
                        <Badge variant={out ? "destructive" : "warning"}>{out ? "Out" : "Low"}</Badge>
                      </span>
                    </div>
                  );
                })}
                {lowStock.length > 8 && <Link href="/inventory" className="text-xs text-primary hover:underline">+ {lowStock.length - 8} more</Link>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Purchasing + commissions */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Purchasing &amp; commissions</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <Link href="/orders" className="hover:underline">Purchase requests in progress</Link>
              <span className="tabular-nums font-medium">{prPending.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <Link href="/commissions" className="hover:underline">Commissions unpaid</Link>
              <span className="tabular-nums font-medium">{commissions.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Commission amount due</span>
              <span className="tabular-nums font-medium">{formatCurrency(unpaidCommission, CURRENCY)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
