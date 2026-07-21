import Link from "next/link";
import { ClipboardList, Wallet, PackageX, Percent, TrendingUp, Factory, AlertTriangle, ShoppingCart } from "lucide-react";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { payableTotal, round2 } from "@/lib/quote";
import { saleFromClassification, isSaleConfirmed, collectedTotal } from "@/lib/sale";
import { readOrderWorkflow, ORDER_STAGES, PRODUCTION_DEPTS, type OrderStage } from "@/lib/order-workflow";

export const dynamic = "force-dynamic";

const CURRENCY = "PHP";

// Ordinal blue ramp (light→dark) for the order pipeline phases — a progression,
// validated against the reference palette. Departments use categorical hues.
const PHASE_COLOR: Record<string, string> = {
  "Phase 1": "#9ec5f4",
  "Phase 2": "#6da7ec",
  "Phase 3": "#5598e7",
  "Phase 4": "#3987e5",
  "Phase 5": "#2a78d6",
  "Closed": "#1c5cab",
};
// The donut shows each order's linear phase (these sum to the order total).
const PHASE_ORDER = ["Phase 1", "Phase 2", "Phase 5", "Closed"];
// The legend lists every phase; 3 (materials) & 4 (purchasing) run concurrently
// within production, so they're shown as separate counts, not donut arcs.
const LEGEND_PHASES = ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5", "Closed"];
const DEPT_COLOR: Record<string, string> = {
  fans: "#2a78d6",
  duct: "#1baf7a",
  accessories: "#eda100",
  motor: "#e87ba4",
};

/** A donut with an inner label. Segments carry a 2px surface gap between fills. */
function Donut({ data, total, size = 148, thickness = 20 }: { data: { label: string; value: number; color: string }[]; total: number; size?: number; thickness?: number }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 ? 2 : 0; // px surface gap between segments
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label="Orders by phase">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} className="stroke-muted" />
        {total > 0 && data.filter((d) => d.value > 0).map((d, i) => {
          const dash = (d.value / total) * c;
          const seg = Math.max(dash - gap, 0.5);
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${seg} ${c - seg}`} strokeDashoffset={-offset} />
          );
          offset += dash;
          return el;
        })}
      </g>
    </svg>
  );
}

/** A thin horizontal bar with a rounded data-end, direct-labelled. Rows with a
 *  value and an href become a clickable drill-down link. */
function Bar({ label, value, max, color, tag, href }: { label: string; value: number; max: number; color: string; tag?: string; href?: string }) {
  const pct = max > 0 ? (value > 0 ? Math.max((value / max) * 100, 5) : 0) : 0;
  const inner = (
    <div className="flex items-center gap-3 text-sm" title={`${label}: ${value}`}>
      <span className={`w-36 shrink-0 truncate sm:w-44 ${value > 0 ? "" : "text-muted-foreground"}`}>{label}</span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: value > 0 ? color : "transparent" }} />
      </div>
      <span className={`w-7 text-right tabular-nums ${value > 0 ? "font-semibold" : "text-muted-foreground"}`}>{value}</span>
      {tag !== undefined && <span className="hidden w-14 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">{tag}</span>}
    </div>
  );
  if (href && value > 0) {
    return <Link href={href} className="-mx-1.5 block rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent">{inner}</Link>;
  }
  return inner;
}

export default async function ManagementPage() {
  const [wonQuotes, stockItems, commissions, prPending] = await Promise.all([
    prisma.quotation.findMany({
      where: { inquiry: { status: "WON" } },
      select: { id: true, classification: true, total: true, discountPct: true, vatMode: true },
    }),
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" } }).catch(() => []),
    prisma.commission.findMany({ where: { paid: false } }).catch(() => []),
    prisma.purchaseRequest.findMany({ where: { status: { notIn: ["COMPLETED", "REJECTED"] } }, select: { id: true, quotationId: true } }).catch(() => []),
  ]);

  // Orders (by quotation id) that currently have an open purchase request → Phase 4.
  const openPrQuoteIds = new Set(prPending.map((p) => p.quotationId).filter((x): x is string => !!x));

  const stageCount = new Map<OrderStage, number>();
  const prodActive = new Map<string, number>();
  let orderCount = 0;
  let outstanding = 0;
  let openOrders = 0;
  let billed = 0;
  let collected = 0;
  let materialsCount = 0; // Phase 3: orders with an open material request
  let purchasingCount = 0; // Phase 4: orders with an open purchase request

  for (const q of wonQuotes) {
    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;
    orderCount++;
    const wf = readOrderWorkflow(q.classification);
    stageCount.set(wf.stage, (stageCount.get(wf.stage) ?? 0) + 1);
    if (wf.stage !== "closed") openOrders++;

    // Phase 3 & 4 run within production — count orders still awaiting materials
    // (an open MRF) or with a purchase request in progress.
    if (wf.materialRequests.some((m) => m.status === "requested" || m.status === "purchasing" || m.status === "partial")) materialsCount++;
    if (openPrQuoteIds.has(q.id)) purchasingCount++;

    const value = round2(payableTotal(q));
    const paid = round2(collectedTotal(sale));
    billed = round2(billed + value);
    collected = round2(collected + paid);
    const balance = round2(value - paid);
    if (balance > 0.005) outstanding = round2(outstanding + balance);

    if (wf.stage === "in_production" || wf.stage === "jo_received" || wf.stage === "producing") {
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

  // Phase distribution for the donut.
  const phaseCount = new Map<string, number>();
  for (const s of ORDER_STAGES) {
    const n = stageCount.get(s.key) ?? 0;
    if (n > 0) phaseCount.set(s.phase, (phaseCount.get(s.phase) ?? 0) + n);
  }
  const phaseData = PHASE_ORDER.filter((p) => (phaseCount.get(p) ?? 0) > 0).map((p) => ({ label: p, value: phaseCount.get(p) ?? 0, color: PHASE_COLOR[p] }));
  const maxStage = Math.max(1, ...ORDER_STAGES.map((s) => stageCount.get(s.key) ?? 0));

  const totalProd = [...prodActive.values()].reduce((a, b) => a + b, 0);
  const maxDept = Math.max(1, ...PRODUCTION_DEPTS.map((d) => prodActive.get(d.key) ?? 0));

  const collectedPct = billed > 0 ? Math.round((collected / billed) * 100) : 0;

  const tiles = [
    { label: "Open orders", value: String(openOrders), caption: `${orderCount} confirmed`, href: "/orders", icon: ClipboardList, color: "#2a78d6" },
    { label: "Receivables", value: formatCurrency(outstanding, CURRENCY), caption: `${collectedPct}% collected`, href: "/orders", icon: Wallet, color: "#1baf7a" },
    { label: "Low / out of stock", value: String(lowStock.length), caption: lowStock.length === 0 ? "all healthy" : "needs reorder", href: "/inventory/reorder", icon: PackageX, color: lowStock.length > 0 ? "#d03b3b" : "#0ca30c" },
    { label: "Unpaid commissions", value: formatCurrency(unpaidCommission, CURRENCY), caption: `${commissions.length} pending`, href: "/commissions", icon: Percent, color: "#4a3aa7" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Management Dashboard</h1>
          <p className="text-sm text-muted-foreground">Live snapshot across orders, production, inventory, receivables, purchasing, and commissions.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
          Live
        </span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.label} href={t.href} className="group">
              <Card className="relative overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: t.color }} />
                <CardContent className="flex items-start justify-between gap-2 pt-5">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t.label}</div>
                    <div className="mt-1 truncate text-2xl font-bold tabular-nums">{t.value}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{t.caption}</div>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${t.color}1a`, color: t.color }}>
                    <Icon className="h-5 w-5" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Order pipeline — donut by phase + stage bars */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4 text-muted-foreground" /> Order pipeline</CardTitle></CardHeader>
          <CardContent>
            {orderCount === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No confirmed orders yet.</p>
            ) : (
              <div className="flex flex-col gap-6 md:flex-row md:items-start">
                {/* Donut + phase legend */}
                <div className="flex items-center gap-4 md:flex-col md:items-center">
                  <div className="relative">
                    <Donut data={phaseData} total={orderCount} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold tabular-nums">{orderCount}</span>
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">orders</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {LEGEND_PHASES.map((p) => {
                      const concurrent = p === "Phase 3" || p === "Phase 4";
                      const n = p === "Phase 3" ? materialsCount : p === "Phase 4" ? purchasingCount : (phaseCount.get(p) ?? 0);
                      return (
                        <div key={p} className="flex items-center gap-2 text-xs">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PHASE_COLOR[p] }} />
                          <span className={n > 0 ? "font-medium" : "text-muted-foreground"}>
                            {p}{concurrent && <span className="ml-1 font-normal text-muted-foreground">· {p === "Phase 3" ? "materials" : "purchasing"}</span>}
                          </span>
                          <span className="ml-auto tabular-nums text-muted-foreground">{n}</span>
                        </div>
                      );
                    })}
                    <p className="pt-1 text-[10px] leading-tight text-muted-foreground">Phases 3 &amp; 4 run within production, so they overlap Phase 2.</p>
                  </div>
                </div>
                {/* Stage bars */}
                <div className="flex-1 space-y-1.5 md:border-l md:pl-6">
                  {ORDER_STAGES.map((s) => (
                    <Bar key={s.key} label={s.label} value={stageCount.get(s.key) ?? 0} max={maxStage} color={PHASE_COLOR[s.phase] ?? "#2a78d6"} tag={s.phase} href={`/orders?stage=${s.key}`} />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Production load */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Factory className="h-4 w-4 text-muted-foreground" /> Production load</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{totalProd}</span>
              <span className="text-xs text-muted-foreground">active job order{totalProd === 1 ? "" : "s"}</span>
            </div>
            {totalProd === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nothing in production right now.</p>
            ) : (
              <div className="space-y-2.5">
                {PRODUCTION_DEPTS.map((d) => (
                  <Bar key={d.key} label={d.label} value={prodActive.get(d.key) ?? 0} max={maxDept} color={DEPT_COLOR[d.key]} href={`/orders?dept=${d.key}`} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Receivables */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Wallet className="h-4 w-4 text-muted-foreground" /> Receivables</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-end justify-between">
                <span className="text-xs text-muted-foreground">Outstanding balance</span>
                <span className="text-xl font-bold tabular-nums">{formatCurrency(outstanding, CURRENCY)}</span>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Collected</span>
                <span className="font-medium tabular-nums">{collectedPct}%</span>
              </div>
              <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${collectedPct}%`, backgroundColor: "#1baf7a" }} />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{formatCurrency(collected, CURRENCY)} in</span>
                <span>{formatCurrency(billed, CURRENCY)} billed</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stock alerts */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-muted-foreground" /> Stock alerts</CardTitle></CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <div className="flex items-center gap-2 py-2 text-sm text-emerald-700">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/10">✓</span>
                All stock above reorder levels.
              </div>
            ) : (
              <div className="space-y-1.5">
                {lowStock.slice(0, 7).map((i) => {
                  const q = Number(i.quantity);
                  const out = q <= 0;
                  return (
                    <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{i.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-muted-foreground">{q} {i.unit}</span>
                        <Badge variant={out ? "destructive" : "warning"}>{out ? "Out" : "Low"}</Badge>
                      </span>
                    </div>
                  );
                })}
                {lowStock.length > 7 && <Link href="/inventory/reorder" className="mt-1 inline-block text-xs text-primary hover:underline">+ {lowStock.length - 7} more →</Link>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Purchasing & commissions */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ShoppingCart className="h-4 w-4 text-muted-foreground" /> Purchasing &amp; commissions</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <Link href="/purchasing" className="text-muted-foreground hover:underline">Purchase requests in progress</Link>
              <span className="text-lg font-bold tabular-nums">{prPending.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <Link href="/commissions" className="text-muted-foreground hover:underline">Commissions unpaid</Link>
              <span className="text-lg font-bold tabular-nums">{commissions.length}</span>
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="text-muted-foreground">Amount due</span>
              <span className="font-semibold tabular-nums">{formatCurrency(unpaidCommission, CURRENCY)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
