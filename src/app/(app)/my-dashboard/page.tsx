import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { buildMyDashboard, type MyTask } from "@/lib/my-dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { ClipboardList, ShoppingCart, Wallet, CalendarDays, Percent, FileText, ChevronRight, CheckCircle2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { TaskArea } from "@/lib/my-dashboard";

export const dynamic = "force-dynamic";

const AREA_ICON: Record<TaskArea, typeof ClipboardList> = {
  order: ClipboardList,
  purchase: ShoppingCart,
  cash: Wallet,
  schedule: CalendarDays,
  commission: Percent,
  quotation: FileText,
};
const AREA_COLOR: Record<TaskArea, string> = {
  order: "text-blue-600",
  purchase: "text-amber-600",
  cash: "text-emerald-600",
  schedule: "text-violet-600",
  commission: "text-pink-600",
  quotation: "text-sky-600",
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
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{t.title}</span>
          <Badge variant="warning" className="font-normal">{t.action}</Badge>
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

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div>
        <h1 className="text-2xl font-bold">My Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {user.name}
          {data.roleLabels.length > 0 ? ` · ${data.roleLabels.join(" · ")}` : ""}
        </p>
      </div>

      {/* Counts by area — what's on your plate right now. */}
      {data.byArea.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {data.byArea.map((a) => {
            const Icon = AREA_ICON[a.area];
            return (
              <Card key={a.area}>
                <CardContent className="flex items-center gap-3 py-4">
                  <Icon className={`h-6 w-6 ${AREA_COLOR[a.area]}`} />
                  <div>
                    <div className="text-2xl font-bold tabular-nums leading-none">{a.count}</div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{a.label}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pending your action */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            Pending your action
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
            <div className="space-y-1.5">
              {data.pending.map((t) => <TaskRow key={t.key} t={t} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Your recent activity — progress / things you've done. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Your recent activity</CardTitle>
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
    </div>
  );
}
