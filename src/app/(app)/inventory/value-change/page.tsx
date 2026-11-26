import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { inventoryAccess } from "@/lib/catalogue-access";
import { manilaDay } from "@/lib/purchaser-plan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { stockValueChange } from "@/lib/stock-value-change";

export const dynamic = "force-dynamic";

/**
 * Stock value — what changed since a day.
 *
 * The owner: *"from 5 million plus yesterday it become 9 million plus in
 * inventory today. Please check"*. The tile on Inventory is quantity × unit cost;
 * this rebuilds it at the start of the chosen day from the recorded stock and
 * price movements and lists what made the difference — biggest first.
 * (lib/stock-value-change). Same audience as the tile: those who see unit costs.
 */
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const peso = (n: number) => `${n < 0 ? "−" : ""}₱${new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))}`;
const signed = (n: number) => (n > 0 ? `+${peso(n)}` : peso(n));
const num = (n: number) => new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(n);

/** The start of a Philippine calendar day (UTC+8, no DST). */
const manilaStart = (ymd: string) => new Date(`${ymd}T00:00:00+08:00`);

export default async function StockValueChangePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const a = inventoryAccess(viewer, assignments);
  if (!a.canView || !a.showPrices) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Stock value — what changed</h1>
        <p className="text-sm text-muted-foreground">Only those who see unit costs on Inventory can open this.</p>
      </div>
    );
  }
  const today = manilaDay(new Date())!;
  const yesterday = manilaDay(new Date(manilaStart(today).getTime() - 86_400_000))!;
  const sinceYmd = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.since)) ? one(sp.since) : yesterday;
  const since = manilaStart(sinceYmd);

  const [items, movements, prices] = await Promise.all([
    prisma.stockItem.findMany({
      where: { active: true },
      select: { id: true, name: true, sku: true, unit: true, location: true, quantity: true, unitCost: true, createdAt: true },
    }),
    prisma.stockMovement.findMany({ where: { createdAt: { gte: since } }, select: { stockItemId: true, kind: true, delta: true, reason: true, createdAt: true } }),
    prisma.stockPriceChange.findMany({ where: { createdAt: { gte: since } }, select: { stockItemId: true, oldUnitCost: true, newUnitCost: true, source: true, createdAt: true } }),
  ]);
  const report = stockValueChange(
    items.map((i) => ({ ...i, quantity: Number(i.quantity), unitCost: Number(i.unitCost) })),
    movements.map((m) => ({ ...m, kind: String(m.kind), delta: Number(m.delta) })),
    prices.map((p) => ({ ...p, oldUnitCost: p.oldUnitCost == null ? null : Number(p.oldUnitCost), newUnitCost: Number(p.newUnitCost) })),
    since,
  );
  const top = report.items.slice(0, 60);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/inventory" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ChevronLeft className="h-4 w-4" /> Inventory</Link>
        <h1 className="text-2xl font-bold">Stock value — what changed</h1>
        <p className="text-sm text-muted-foreground">
          The value at the start of the day you pick, rebuilt from the recorded stock and price movements, against today — and what made the difference.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Since the start of</span>
          <input type="date" name="since" defaultValue={sinceYmd} max={today} className="h-9 rounded-md border bg-background px-2" />
        </label>
        <button type="submit" className="h-9 rounded-md border px-3 font-medium hover:bg-muted">Show</button>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-5"><div className="text-xs uppercase text-muted-foreground">Value at the start of {sinceYmd}</div><div className="text-2xl font-bold tabular-nums">{peso(report.valueThen)}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-xs uppercase text-muted-foreground">Value now</div><div className="text-2xl font-bold tabular-nums">{peso(report.valueNow)}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-xs uppercase text-muted-foreground">Change</div><div className={`text-2xl font-bold tabular-nums ${report.change > 0 ? "text-emerald-700" : report.change < 0 ? "text-destructive" : ""}`}>{signed(report.change)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">By cause</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Cause</TableHead><TableHead className="text-right">Entries</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
            <TableBody>
              {report.byCause.map((c) => (
                <TableRow key={c.cause}><TableCell>{c.cause}</TableCell><TableCell className="text-right tabular-nums">{c.count}</TableCell><TableCell className="text-right font-medium tabular-nums">{signed(c.value)}</TableCell></TableRow>
              ))}
              <TableRow>
                <TableCell>Unit cost changed (re-priced stock already on hand)</TableCell><TableCell />
                <TableCell className="text-right font-medium tabular-nums">{signed(report.costEffect)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">Quantity moves are valued at today&apos;s unit cost; re-pricing is the earlier quantity × the cost difference. The two add up to the change.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Items that changed most ({report.items.length}{report.items.length > top.length ? `, top ${top.length} shown` : ""})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[900px] text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty then → now</TableHead>
                <TableHead className="text-right">Unit cost then → now</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/inventory/history?item=${i.id}`} className="font-medium hover:underline">{i.name}</Link>
                    <div className="text-muted-foreground">{i.sku ? `SKU ${i.sku}` : "no SKU"}{i.location ? ` · ${i.location}` : ""}{i.isNew ? " · new item" : ""}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{num(i.qtyThen)} → {num(i.qtyNow)} {i.unit}</TableCell>
                  <TableCell className={`whitespace-nowrap text-right tabular-nums ${i.costThen !== i.costNow ? "font-semibold text-amber-700" : ""}`}>{peso(i.costThen)} → {peso(i.costNow)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{signed(i.change)}</TableCell>
                  <TableCell>
                    {i.causes.map((c) => (
                      <div key={c.cause}>{c.cause}: {c.qty > 0 ? "+" : ""}{num(c.qty)} {i.unit} ({signed(c.value)})</div>
                    ))}
                    {i.costEffect !== 0 && <div className="text-amber-700">Unit cost changed{i.priceSources.length ? ` (${i.priceSources.join(", ")})` : ""}: {signed(i.costEffect)}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
