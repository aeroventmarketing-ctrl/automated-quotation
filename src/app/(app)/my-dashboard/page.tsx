import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { buildMyDashboard, type MyTask } from "@/lib/my-dashboard";
import { getProductionStatus } from "@/lib/production-status";
import { ProductionStatusCard } from "@/components/production-status-card";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { SalesDashboardBody } from "../dashboard/sales-dashboard-body";
import { hidesProductionClient } from "@/lib/client-visibility";
import { prisma } from "@/lib/db";
import { STOCK_ACTION_LABEL, coerceStockDoc, type StockActionView } from "@/lib/stock-action";
import { PendingStockActions } from "../inventory/pending-stock-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFinanceMonitor } from "@/lib/finance-monitor";
import { UnreconciledPaymentsCard, CashVouchersCard, FinanceStatsRow } from "@/components/finance-monitor-cards";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { ClipboardList, ShoppingCart, Wallet, CalendarDays, Percent, FileText, ChevronRight, CheckCircle2, Boxes, RotateCcw, ReceiptText } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { TaskArea } from "@/lib/my-dashboard";
import { getExpensesReport } from "../management/pnl-actions";
import { ExpensesReport } from "./expenses-report";
import { getManualReconciliations, getUnreconciledCounts } from "@/lib/manual-reconciliations";
import { ManualReconcileCard } from "./manual-reconcile-card";
import { getLowStock } from "@/lib/low-stock";
import { StockAlertsCards } from "./stock-alerts-cards";

export const dynamic = "force-dynamic";

const AREA_ICON: Record<TaskArea, typeof ClipboardList> = {
  order: ClipboardList,
  purchase: ShoppingCart,
  cash: Wallet,
  schedule: CalendarDays,
  commission: Percent,
  quotation: FileText,
  inventory: Boxes,
};
const AREA_COLOR: Record<TaskArea, string> = {
  order: "text-blue-600",
  purchase: "text-amber-600",
  cash: "text-emerald-600",
  schedule: "text-violet-600",
  commission: "text-pink-600",
  quotation: "text-sky-600",
  inventory: "text-teal-600",
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function TaskRow({ t }: { t: MyTask }) {
  const Icon = AREA_ICON[t.area];
  return (
    <Link
      href={t.href}
      className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent"
    >
      <Icon className={`h-5 w-5 shrink-0 ${AREA_COLOR[t.area]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{t.title}</span>
          {t.ref && <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">{t.ref}</span>}
          <Badge variant="warning" className="font-normal">{t.action}</Badge>
          {t.deliveryMode && (
            <Badge variant={t.deliveryMode === "multi" ? "success" : "secondary"} className="font-normal">
              {t.deliveryMode === "multi" ? "Batch delivery" : "Single delivery"}
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {t.areaLabel}
          {t.client ? ` · ${t.client}` : ""}
          {t.amount != null ? ` · ${formatCurrency(t.amount, t.currency)}` : ""}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default async function MyDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signout");

  const data = await buildMyDashboard(user);
  // Sales / Engineer / Other with no workflow role use their existing dashboard.
  if (!data.hasRole) redirect("/dashboard");
  const production = await getProductionStatus();
  // Consolidated-dashboard roles get the Sales Dashboard embedded below, so this
  // is their single dashboard to monitor.
  const assignments = await getWorkflowRoles();
  // Admins keep the standalone Sales Dashboard, so nothing is embedded for them.
  // The Purchaser and Logistics don't get the sales analytics embedded either
  // (they don't need the client sales figures).
  // The Sales Dashboard is embedded ABOVE the production sections only for
  // Sales / Engineer base-role users (those entitled to it). Changing a user to
  // "Other" removes it; switching back to Sales returns it. Admins keep it on
  // their separate Sales Dashboard, so it isn't embedded here for them.
  // Embed the Sales Dashboard only for consolidated workflow-role holders (they
  // reach My Dashboard via a role). A pure Sales base-role user already has the
  // standalone Sales Dashboard tab, so their My Dashboard stays focused on the
  // production-status card and their approvals — no duplicate analytics.
  const showSalesAbove = !isAdmin(user) && (user.role === "SALES" || user.role === "ENGINEER") && data.roleLabels.length > 0;
  const maskProdClient = hidesProductionClient(user, assignments);
  const admin = isAdmin(user);
  // Inventory double-handshake actions awaiting the Warehouseman / Purchaser /
  // admin — surfaced here so both parties (and admins) are notified.
  const invWarehouse = admin || userHasWorkflowRole(assignments, user.id, "warehouse" as WorkflowRoleKey);
  const invPurchaser = admin || userHasWorkflowRole(assignments, user.id, "purchaser" as WorkflowRoleKey);
  // Accounting gets the finance-monitor cards (Receivables, Unreconciled
  // payments, Cash vouchers, Stock alerts, Purchasing & commissions) here too.
  const isAccounting = userHasWorkflowRole(assignments, user.id, "accounting" as WorkflowRoleKey);
  const finance = isAccounting ? await getFinanceMonitor().catch(() => null) : null;
  // Purchaser (and admin) get the stock cards — "Low / out of stock" count + the
  // Stock alerts list — on their dashboard so reorder needs are front-and-centre.
  // Accounting already sees stock alerts via the finance-monitor row below.
  const isPurchaser = admin || userHasWorkflowRole(assignments, user.id, "purchaser" as WorkflowRoleKey);
  const stockAlertsCard = isPurchaser && !finance ? <StockAlertsCards lowStock={await getLowStock().catch(() => [])} /> : null;
  // "Reconciled by hand" oversight — for the Admin, the Payment Approver and
  // Accounting: count + inline list of vouchers whose figures were typed in
  // manually (not AI-verified against the receipt).
  const canSeeManualRecon = admin || isAccounting || userHasWorkflowRole(assignments, user.id, "payment_approver" as WorkflowRoleKey);
  const manualRecon = canSeeManualRecon ? await getManualReconciliations().catch(() => []) : null;
  const manualReconCard = manualRecon ? <ManualReconcileCard rows={manualRecon} /> : null;
  // Outstanding reconciliation backlog — POs / vouchers that can be reconciled
  // but haven't been. Shown as its own tiles beside "Reconciled by hand".
  const unrecon = canSeeManualRecon ? await getUnreconciledCounts().catch(() => ({ pos: 0, vouchers: 0, firstPoId: null, firstVoucherId: null })) : null;
  const stockPending: StockActionView[] = (invWarehouse || invPurchaser)
    ? (await prisma.stockAction.findMany({ where: { status: "PENDING" }, orderBy: { proposedAt: "desc" }, take: 50 }).catch(() => [])).map((a) => ({
        id: a.id, stockItemId: a.stockItemId, itemName: a.itemName, kind: a.kind,
        kindLabel: STOCK_ACTION_LABEL[a.kind], summary: a.summary, status: a.status,
        proof: a.kind === "TRANSFER" ? coerceStockDoc((a.payload as { proof?: unknown } | null)?.proof) : null,
        proposedByName: a.proposedByName, proposedAt: a.proposedAt.toISOString(),
        warehouseByName: a.warehouseByName, purchaserByName: a.purchaserByName,
        canApproveWarehouse: a.warehouseAt == null && invWarehouse,
        canApprovePurchaser: a.purchaserAt == null && invPurchaser,
      }))
    : [];

  const header = (
    <div>
      <h1 className="text-2xl font-bold">{admin ? "Production Dashboard" : "My Dashboard"}</h1>
      <p className="text-sm text-muted-foreground">
        {user.name}
        {data.roleLabels.length > 0 ? ` · ${data.roleLabels.join(" · ")}` : ""}
      </p>
    </div>
  );

  // Counts by area — click a box to jump to that area's items below. The
  // "Reconciled by hand" tile (when shown) joins the same row; its list expands
  // full-width beneath the row (col-span-full).
  const ordersGrid = (data.byArea.length > 0 || manualReconCard) && (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {data.byArea.map((a) => {
        const Icon = AREA_ICON[a.area];
        return (
          <Link key={a.area} href={`#area-${a.area}`} className="rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent">
              <CardContent className="flex items-center gap-3 py-4">
                <Icon className={`h-6 w-6 ${AREA_COLOR[a.area]}`} />
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none">{a.count}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{a.label}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
      {manualReconCard}
      {unrecon && (
        <>
          <Link href={unrecon.firstPoId ? `/purchasing?req=${unrecon.firstPoId}` : "/purchasing"} className="rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent">
              <CardContent className="flex items-center gap-3 py-4">
                <ShoppingCart className="h-6 w-6 text-amber-600" />
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none">{unrecon.pos}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Unreconciled PO</div>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href={unrecon.firstVoucherId ? `/cash-requests?id=${unrecon.firstVoucherId}` : "/cash-requests"} className="rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent">
              <CardContent className="flex items-center gap-3 py-4">
                <Wallet className="h-6 w-6 text-amber-600" />
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none">{unrecon.vouchers}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Unreconciled Vouchers</div>
                </div>
              </CardContent>
            </Card>
          </Link>
          <a href="/reports/sales-summary" target="_blank" rel="noopener noreferrer" className="rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent">
              <CardContent className="flex items-center gap-3 py-4">
                <ReceiptText className="h-6 w-6 text-emerald-600" />
                <div>
                  <div className="text-sm font-bold leading-tight">Sales Summary</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Vatable</div>
                </div>
              </CardContent>
            </Card>
          </a>
        </>
      )}
    </div>
  );

  const pendingCard = (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          Pending Your Action
          {data.pending.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {data.pending.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.pending.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="text-sm text-muted-foreground">Nothing waiting on you. You&apos;re all caught up. 🎉</p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.byArea.map((a) => {
              const Icon = AREA_ICON[a.area];
              return (
                <div key={a.area} id={`area-${a.area}`} className="scroll-mt-16 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Icon className={`h-3.5 w-3.5 ${AREA_COLOR[a.area]}`} /> {a.label} <span className="text-muted-foreground/70">({a.count})</span>
                  </div>
                  {data.pending.filter((t) => t.area === a.area).map((t) => <TaskRow key={t.key} t={t} />)}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Inventory approvals — double-handshake stock actions awaiting the
  // Warehouseman / Purchaser (and visible to admins).
  const inventoryCard = (invWarehouse || invPurchaser) ? (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          Inventory Approvals
          {stockPending.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{stockPending.length}</span>
          )}
          <Link href="/inventory#inv-items" className="ml-auto text-xs font-medium text-primary hover:underline">Open Inventory →</Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {stockPending.length === 0 ? (
          <div className="flex items-center gap-2 py-1 text-sm text-emerald-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/10">✓</span>
            No stock actions awaiting a double-handshake approval.
          </div>
        ) : (
          <PendingStockActions pending={stockPending} />
        )}
      </CardContent>
    </Card>
  ) : null;

  // Materials notifications — MRF completed / partially released.
  const materialsCard = data.materialsFeed.length > 0 ? (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Materials — MRF Status</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data.materialsFeed.map((m) => (
            <li key={m.key}>
              <Link href={m.href} className="flex items-center gap-3 rounded-md px-1 py-2.5 hover:bg-accent">
                <Boxes className="h-4 w-4 shrink-0 text-teal-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">MRF #{m.formNo} · {m.dept}</span>
                    <Badge variant={m.variant} className="font-normal">{m.label}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.orderRef}{m.client ? ` · ${m.client}` : ""}{m.when ? ` · ${fmtWhen(m.when)}` : ""}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  ) : null;

  // Supplier returns — the return-to-supplier lifecycle.
  const returnsCard = data.returnsFeed.length > 0 ? (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Returns To Supplier — Status</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data.returnsFeed.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="flex items-center gap-3 rounded-md px-1 py-2.5 hover:bg-accent">
                <RotateCcw className={`h-4 w-4 shrink-0 ${r.variant === "warning" ? "text-amber-600" : r.variant === "success" ? "text-emerald-600" : "text-muted-foreground"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{r.items}</span>
                    <Badge variant={r.variant} className="font-normal">{r.stageLabel}</Badge>
                    {r.yourStep && <Badge variant="destructive" className="font-normal">Your step</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.orderRef}{r.awaiting ? ` · Awaiting: ${r.awaiting}` : " · Complete"}{r.when ? ` · ${fmtWhen(r.when)}` : ""}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  ) : null;

  // Purchase Order summary — every PO by number, clickable. Admin / Payment
  // Approver / Accounting / Purchaser only (server populates it for them).
  const poSummaryCard = data.poSummary.length > 0 ? (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShoppingCart className="h-4 w-4 text-muted-foreground" /> Purchase Orders — Summary
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{data.poSummary.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="max-h-96 divide-y overflow-y-auto">
          {data.poSummary.map((po) => (
            <li key={po.key}>
              <Link href={po.href} className="flex items-center gap-3 rounded-md px-1 py-2.5 hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">{po.poNumber}</span>
                    <Badge variant={po.variant} className="font-normal">{po.statusLabel}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {po.supplier ?? "—"} · {po.orderRef} · {formatCurrency(po.net, po.currency)}
                  </div>
                  {po.receivedAt && (
                    <div className="truncate text-xs text-emerald-700 dark:text-emerald-500">
                      Received {fmtWhen(po.receivedAt)}{po.receivedByName ? ` · ${po.receivedByName}` : ""}
                    </div>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  ) : null;

  // Expenses records report — Accounting only here. (Admins see it on the
  // Management Dashboard instead.) Defaults to the current month (Manila); the
  // component re-fetches when the range changes.
  const expensesReportCard = isAccounting
    ? await (async () => {
        const phToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        const monthStart = `${phToday.slice(0, 7)}-01`;
        const initial = await getExpensesReport(monthStart, phToday).catch(() => null);
        return initial ? <ExpensesReport initial={initial} /> : null;
      })()
    : null;

  const productionCard = <ProductionStatusCard status={production} maskClient={maskProdClient} />;

  // Your recent activity — progress / things you've done.
  const activityCard = (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Your Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {data.activity.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No recorded activity yet.</p>
        ) : (
          <ul className="divide-y">
            {data.activity.map((a) => {
              const inner = (
                <div className="flex items-start gap-3 py-2.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{a.summary}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtWhen(a.createdAt)}</div>
                  </div>
                  {a.href && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />}
                </div>
              );
              return a.href ? (
                <li key={a.id}>
                  <Link href={a.href} className="block rounded-md px-1 hover:bg-accent">{inner}</Link>
                </li>
              ) : (
                <li key={a.id} className="px-1">{inner}</li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  // Accounting's My Dashboard uses a bespoke card order:
  //   Orders → Pending your action → Unreconciled payments → Cash vouchers →
  //   Receivables / Stock alerts / Purchasing & commissions → Production status →
  //   Your recent activity. (Any inventory / materials / returns cards — normally
  //   empty for Accounting — trail just before recent activity.)
  if (finance) {
    return (
      <div className="space-y-6">
        <AutoRefresh />
        {header}
        {ordersGrid}
        {pendingCard}
        <UnreconciledPaymentsCard data={finance} />
        <CashVouchersCard data={finance} />
        <FinanceStatsRow data={finance} />
        {poSummaryCard}
        {expensesReportCard}
        {productionCard}
        {inventoryCard}
        {materialsCard}
        {returnsCard}
        {activityCard}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AutoRefresh />
      {header}

      {/* Admins / Sales see the Sales Dashboard first, above the production sections. */}
      {showSalesAbove && <SalesDashboardBody embedded />}

      {productionCard}
      {inventoryCard}
      {ordersGrid}
      {stockAlertsCard}
      {pendingCard}
      {poSummaryCard}
      {materialsCard}
      {returnsCard}
      {activityCard}
    </div>
  );
}
