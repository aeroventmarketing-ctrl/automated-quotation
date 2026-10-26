import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { inventoryAccess } from "@/lib/catalogue-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { loadStockHistory, loadPriceHistory, type HistoryFilter, type StockHistoryRow } from "@/lib/inventory-history-data";
import { MOVEMENT_CATEGORY_LABEL, type MovementCategory } from "@/lib/stock-history";
import { PRICE_SOURCE_LABEL, pctChange, type PriceHistoryEntry } from "@/lib/price-history";

export const dynamic = "force-dynamic";

/**
 * Inventory history — where stock went and how prices moved.
 *
 * The owner: *"Monitor the price movement of each items in inventory … show who
 * edited or changed the price and when"* and *"Add stock movement history,
 * where and when the item go, when it was added and deducted, who edited and
 * other important details for monitoring."*
 *
 * `?item=` narrows it to one item (the History button on each Inventory row);
 * without it this is the whole ledger, filterable and exportable.
 *
 * Who sees what follows the Inventory page exactly: the stock tab is for
 * everyone who can open Inventory (`canView`); the price tab only for those who
 * see prices there (`showPrices`), with the selling price only for those who
 * also see it (`showSellPrice`).
 */
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const CATEGORIES: (MovementCategory | "reserve")[] = ["in", "out", "transfer", "adjust", "reserve"];
const CATEGORY_LABEL: Record<MovementCategory | "reserve", string> = { ...MOVEMENT_CATEGORY_LABEL, reserve: "Reservation" };
const CATEGORY_BADGE: Record<MovementCategory | "reserve", "success" | "destructive" | "secondary" | "outline" | "warning"> = {
  in: "success",
  out: "destructive",
  transfer: "secondary",
  adjust: "warning",
  reserve: "outline",
};

const fmtQty = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function InventoryHistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const a = inventoryAccess(viewer, assignments);
  if (!a.canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Inventory history</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to inventory. Ask an admin for the Warehouse role.</p>
      </div>
    );
  }
  const see = { cost: a.showPrices, sell: a.showPrices && a.showSellPrice };
  const canPrice = see.cost || see.sell;
  const tab = one(sp.tab) === "price" && canPrice ? "price" : "stock";
  const cat = one(sp.cat);
  const filter: HistoryFilter = {
    itemId: one(sp.item) || undefined,
    q: one(sp.q) || undefined,
    from: one(sp.from) || undefined,
    to: one(sp.to) || undefined,
    by: one(sp.by) || undefined,
    category: (CATEGORIES as string[]).includes(cat) ? (cat as MovementCategory | "reserve") : "",
  };

  const item = filter.itemId
    ? await prisma.stockItem.findUnique({
        where: { id: filter.itemId },
        select: { id: true, name: true, sku: true, unit: true, location: true, category: true, quantity: true, unitCost: true, sellPrice: true, active: true },
      }).catch(() => null)
    : null;

  // Links keep every filter but the ones they change.
  const params = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = { tab, item: filter.itemId, q: filter.q, from: filter.from, to: filter.to, by: filter.by, cat: filter.category || undefined, ...over };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const stock = tab === "stock" ? await loadStockHistory(filter) : null;
  const price = tab === "price" ? await loadPriceHistory(filter, see) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Inventory
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{item ? `History · ${item.name}` : "Inventory history"}</h1>
        <p className="text-sm text-muted-foreground">
          {item
            ? "Every stock movement and price change on this item — when, where it went, and who did it."
            : "Every stock movement and price change across the inventory — when, where it went, and who did it."}
        </p>
      </div>

      {item && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6 text-sm">
            <span><span className="text-muted-foreground">SKU</span> <b>{item.sku || "—"}</b></span>
            <span><span className="text-muted-foreground">Location</span> <b>{item.location || "—"}</b></span>
            {item.category && <span><span className="text-muted-foreground">Category</span> <b>{item.category}</b></span>}
            <span><span className="text-muted-foreground">On hand</span> <b className="tabular-nums">{fmtQty(Number(item.quantity))} {item.unit}</b></span>
            {see.cost && <span><span className="text-muted-foreground">Unit cost</span> <b className="tabular-nums">{peso(Number(item.unitCost))}</b></span>}
            {see.sell && <span><span className="text-muted-foreground">Sell price</span> <b className="tabular-nums">{peso(Number(item.sellPrice))}</b></span>}
            {!item.active && <Badge variant="outline">Removed from the list</Badge>}
            <Link href={`/inventory/history${params({ item: undefined })}`} className="ml-auto text-primary hover:underline">All items →</Link>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 border-b">
        <TabLink href={`/inventory/history${params({ tab: "stock", cat: undefined })}`} active={tab === "stock"}>Stock movements</TabLink>
        {canPrice && <TabLink href={`/inventory/history${params({ tab: "price", cat: undefined })}`} active={tab === "price"}>Price movements</TabLink>}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="tab" value={tab} />
        {filter.itemId && <input type="hidden" name="item" value={filter.itemId} />}
        {!filter.itemId && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Item or SKU</span>
            <input name="q" defaultValue={filter.q ?? ""} placeholder="e.g. Nihonbond" className="h-9 w-48 rounded-md border bg-background px-2" />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <input type="date" name="from" defaultValue={filter.from ?? ""} className="h-9 rounded-md border bg-background px-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <input type="date" name="to" defaultValue={filter.to ?? ""} className="h-9 rounded-md border bg-background px-2" />
        </label>
        {tab === "stock" && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Type</span>
            <select name="cat" defaultValue={filter.category ?? ""} className="h-9 rounded-md border bg-background px-2">
              <option value="">All</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">By</span>
          <input name="by" defaultValue={filter.by ?? ""} placeholder="Name" className="h-9 w-36 rounded-md border bg-background px-2" />
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90">Apply</button>
        <Link href={`/inventory/history${filter.itemId ? `?item=${filter.itemId}&tab=${tab}` : `?tab=${tab}`}`} className="h-9 rounded-md border px-3 leading-9 hover:bg-accent">Reset</Link>
        <a href={`/api/inventory-history/export${params({})}`} className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border px-3 hover:bg-accent">
          <Download className="h-4 w-4" /> Export Excel
        </a>
      </form>

      {stock && <StockTable rows={stock.rows} truncated={stock.truncated} perItem={!!item} unit={item?.unit} />}
      {price && <PriceTable rows={price.rows} truncated={price.truncated} logMissing={price.logMissing} see={see} perItem={!!item} />}
    </div>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
      {children}
    </Link>
  );
}

function StockTable({ rows, truncated, perItem, unit }: { rows: StockHistoryRow[]; truncated: boolean; perItem: boolean; unit?: string }) {
  const moves = rows.filter((r) => r.category !== "reserve");
  const added = moves.filter((r) => r.qty > 0).reduce((s, r) => s + r.qty, 0);
  const deducted = moves.filter((r) => r.qty < 0).reduce((s, r) => s - r.qty, 0);
  return (
    <div className="space-y-3">
      {perItem && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Added (shown)" value={`+${fmtQty(added)} ${unit ?? ""}`} />
          <Tile label="Deducted (shown)" value={`−${fmtQty(deducted)} ${unit ?? ""}`} />
          <Tile label="Movements" value={String(moves.length)} />
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No stock movements match.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Date &amp; time</TableHead>
                    {!perItem && <TableHead>Item</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Where it went / came from</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">On hand after</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">{when(r.at)}</TableCell>
                      {!perItem && (
                        <TableCell>
                          <Link href={`/inventory/history?item=${r.stockItemId}`} className="font-medium hover:underline">{r.itemName}</Link>
                          <div className="text-xs text-muted-foreground">{[r.sku ? `SKU ${r.sku}` : null, r.location].filter(Boolean).join(" · ")}</div>
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant={CATEGORY_BADGE[r.category]} className="whitespace-nowrap font-normal">{r.label}</Badge>
                      </TableCell>
                      <TableCell className="min-w-[10rem] text-sm">
                        {r.where ?? (r.note ? null : <span className="text-muted-foreground">—</span>)}
                        {r.note && <div className="text-xs italic text-muted-foreground">&ldquo;{r.note}&rdquo;</div>}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-medium whitespace-nowrap ${r.category === "reserve" ? "text-muted-foreground" : r.qty > 0 ? "text-emerald-700" : r.qty < 0 ? "text-destructive" : ""}`}>
                        {r.category === "reserve" ? fmtQty(r.qty) : `${r.qty > 0 ? "+" : r.qty < 0 ? "−" : ""}${fmtQty(Math.abs(r.qty))}`} {r.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.balanceAfter == null ? <span className="text-muted-foreground">—</span> : fmtQty(r.balanceAfter)}</TableCell>
                      <TableCell className="text-sm">
                        {r.ref ? (r.ref.href ? <Link href={r.ref.href} className="text-primary hover:underline">{r.ref.label}</Link> : r.ref.label) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{r.byName || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {truncated && <p className="mt-3 text-xs text-muted-foreground">Showing the latest {rows.length}. Narrow the dates or the item to see older entries — the Excel export carries up to 5,000.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function PriceCell({ oldV, newV }: { oldV: number | null; newV: number }) {
  const pct = pctChange(oldV, newV);
  const same = oldV != null && Math.round(oldV * 100) === Math.round(newV * 100);
  if (same) return <span className="tabular-nums text-muted-foreground">{peso(newV)}</span>;
  return (
    <div className="whitespace-nowrap tabular-nums">
      {oldV != null && <span className="text-muted-foreground line-through">{peso(oldV)}</span>}
      {oldV != null && " → "}
      <b>{peso(newV)}</b>
      {pct != null && <span className="ml-1 text-xs text-muted-foreground">{pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%</span>}
      {oldV == null && <span className="ml-1 text-xs text-muted-foreground">(first on record)</span>}
    </div>
  );
}

function PriceTable({ rows, truncated, logMissing, see, perItem }: { rows: PriceHistoryEntry[]; truncated: boolean; logMissing: boolean; see: { cost: boolean; sell: boolean }; perItem: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        {logMissing && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Price changes aren&apos;t being logged yet — apply migration <b>0062_stock_price_history</b> in Supabase. Until then this shows only the changes rebuilt from approved Edit requests.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Changes before the price log started are rebuilt from approved Edit requests (marked &ldquo;from approvals&rdquo;); a price set outside that chain before then wasn&apos;t recorded.
        </p>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No price changes match.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Date &amp; time</TableHead>
                  {!perItem && <TableHead>Item</TableHead>}
                  {see.cost && <TableHead>Unit cost</TableHead>}
                  {see.sell && <TableHead>Sell price</TableHead>}
                  <TableHead>How</TableHead>
                  <TableHead>Changed by</TableHead>
                  <TableHead>Approved by</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">{when(r.at)}</TableCell>
                    {!perItem && (
                      <TableCell>
                        <Link href={`/inventory/history?item=${r.stockItemId}&tab=price`} className="font-medium hover:underline">{r.itemName}</Link>
                        {r.sku && <div className="text-xs text-muted-foreground">SKU {r.sku}</div>}
                      </TableCell>
                    )}
                    {see.cost && <TableCell><PriceCell oldV={r.oldUnitCost} newV={r.newUnitCost} /></TableCell>}
                    {see.sell && <TableCell><PriceCell oldV={r.oldSellPrice} newV={r.newSellPrice} /></TableCell>}
                    <TableCell className="whitespace-nowrap text-sm">
                      {PRICE_SOURCE_LABEL[r.source]}
                      {r.fromApprovals && <div className="text-xs text-muted-foreground">from approvals</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{r.byName}</TableCell>
                    <TableCell className="text-sm">{r.approvedByName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="max-w-[16rem] text-xs text-muted-foreground">{r.note ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {truncated && <p className="text-xs text-muted-foreground">Showing the latest {rows.length}. Narrow the dates or the item to see older changes.</p>}
      </CardContent>
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent><div className="text-xl font-bold tabular-nums">{value}</div></CardContent>
    </Card>
  );
}
