/**
 * Stock cards for the Purchaser's My Dashboard: a "Low / out of stock" count tile
 * and a "Stock alerts" list of the items needing reorder. Both link to the
 * reorder list. Presentational (server component) — data comes from getLowStock().
 */
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, PackageX } from "lucide-react";
import type { LowStockRow } from "@/lib/finance-monitor";

export function StockAlertsCards({ lowStock }: { lowStock: LowStockRow[] }) {
  const n = lowStock.length;
  const healthy = n === 0;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* Count tile */}
      <Link
        href="/inventory/reorder"
        className="rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card className="h-full shadow-sm transition-colors hover:border-primary/40 hover:bg-accent">
          <CardContent className="flex items-start justify-between gap-3 py-5">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Low / out of stock</div>
              <div className="mt-1 text-3xl font-bold tabular-nums leading-none">{n}</div>
              <div className={`mt-1 text-xs ${healthy ? "text-emerald-600" : "text-muted-foreground"}`}>{healthy ? "all healthy" : "needs reorder"}</div>
            </div>
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${healthy ? "bg-emerald-600/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
              <PackageX className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
      </Link>

      {/* Stock alerts list */}
      <Card className="shadow-sm sm:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-muted-foreground" /> Stock alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {healthy ? (
            <div className="flex items-center gap-2 py-2 text-sm text-emerald-700">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/10">✓</span>
              All stock above reorder levels.
            </div>
          ) : (
            <div className="space-y-1.5">
              {lowStock.slice(0, 7).map((i) => {
                const out = i.quantity <= 0;
                return (
                  <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{i.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">{i.quantity} {i.unit}</span>
                      <Badge variant={out ? "destructive" : "warning"}>{out ? "Out" : "Low"}</Badge>
                    </span>
                  </div>
                );
              })}
              {n > 7 && <Link href="/inventory/reorder" className="mt-1 inline-block text-xs text-primary hover:underline">+ {n - 7} more →</Link>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
