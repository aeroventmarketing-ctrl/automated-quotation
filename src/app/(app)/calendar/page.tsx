import Link from "next/link";
import { CalendarDays, Zap } from "lucide-react";
import { RushBadge } from "@/components/rush-badge";
import { rushDaysLeft } from "@/lib/rush-order";
import { readClientDue } from "@/lib/order-client-due";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { isClientRestricted, CLIENT_HIDDEN } from "@/lib/client-visibility";
import { AutoRefresh } from "@/components/auto-refresh";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, canApprove } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { ScheduleCalendar } from "../management/schedule-calendar";
import { scheduleApproverNames } from "@/lib/approver-directory";
import { buildScheduleView, expandOccurrences, type ScheduleView } from "@/lib/schedule";
import { getCalendars } from "@/lib/calendars";

export const dynamic = "force-dynamic";

/**
 * Team calendar — available to every signed-in user and role. Anyone may add a
 * schedule (it starts PENDING); an Engineer / Admin / Approver approves. This is
 * the same calendar shown on the Management Dashboard, surfaced on its own page
 * so all roles can see and use it.
 */
export default async function CalendarPage({ searchParams }: { searchParams?: Promise<{ event?: string }> }) {
  const openScheduleId = (await searchParams)?.event;
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const canApproveSchedule =
    viewer != null && (canApprove(viewer) || userHasWorkflowRole(assignments, viewer.id, "payment_approver" as WorkflowRoleKey));

  let scheduleRows: ScheduleView[] = [];
  let users: { id: string; name: string }[] = [];
  let calendars: string[] = ["General"];
  let scheduleMissing = false;
  try {
    const since = new Date(Date.now() - 180 * 86_400_000); // keep ~6 months of history
    const winStart = since.getTime();
    const winEnd = Date.now() + 365 * 86_400_000; // expand recurring events a year out
    const [rows, allUsers, cals] = await Promise.all([
      // Recurring rows may start before the window but still occur inside it, so
      // fetch them regardless of startAt; one-off rows are bounded to the window.
      prisma.schedule.findMany({ where: { OR: [{ startAt: { gte: since } }, { NOT: { recurrence: null } }] }, orderBy: { startAt: "asc" } }),
      prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      getCalendars().catch(() => ["General"]),
    ]);
    users = allUsers;
    calendars = cals;
    const base = rows.map((s) => buildScheduleView(s, { viewerId: viewer?.id, canDecide: canApproveSchedule }));
    scheduleRows = expandOccurrences(base, winStart, winEnd);
  } catch {
    scheduleMissing = true;
  }
  const scheduleApprovers = await scheduleApproverNames().catch(() => []);

  // RUSH orders' client due dates (lib/rush-order) — the calendar's schedules are
  // typed in by people, so the rush dates sit in their own red list above it.
  const restricted = await isClientRestricted(viewer, assignments).catch(() => true);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const rushDue = (
    await prisma.quotation
      .findMany({
        where: { classification: { path: ["rush", "state"], equals: "active" } },
        select: { id: true, quoteNumber: true, classification: true, inquiry: { select: { customer: { select: { company: true } } } } },
      })
      .catch(() => [])
  )
    .filter((q) => readOrderWorkflow(q.classification).stage !== "closed")
    .map((q) => {
      const due = readClientDue(q.classification)?.date ?? null;
      return { id: q.id, quoteNumber: q.quoteNumber, client: restricted ? CLIENT_HIDDEN : q.inquiry.customer.company, due, daysLeft: rushDaysLeft(due, today) };
    })
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} watch="calendar" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Shared schedule for the whole team. Anyone can add a schedule — it&rsquo;s pending until an
          Engineer, Admin or Approver approves it.
        </p>
      </div>

      {rushDue.length > 0 && (
        <Card className="border-red-300 shadow-sm dark:border-red-900">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400"><Zap className="h-4 w-4" /> Rush orders — client due dates</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {rushDue.map((r) => (
                <li key={r.id}>
                  <Link href={`/orders/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-2 hover:bg-accent">
                    <span className="w-28 shrink-0 font-semibold text-red-700 dark:text-red-400">
                      {r.due ? new Date(`${r.due}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "No date"}
                    </span>
                    <RushBadge daysLeft={r.daysLeft} size="xs" />
                    <span className="font-medium">{r.quoteNumber}</span>
                    <span className="truncate text-sm text-muted-foreground">{r.client}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-muted-foreground" /> Team calendar</CardTitle>
        </CardHeader>
        <CardContent>
          {scheduleMissing ? (
            <p className="py-6 text-center text-sm text-muted-foreground">The calendar isn&rsquo;t set up yet — apply the schedule migrations (<code className="rounded bg-muted px-1">0025_schedules</code> … <code className="rounded bg-muted px-1">0030_calendar_features</code>) in Supabase to enable it.</p>
          ) : (
            <ScheduleCalendar schedules={scheduleRows} canApprove={canApproveSchedule} viewerId={viewer?.id ?? ""} users={users} calendars={calendars} canManageCalendars={canApproveSchedule} scheduleApprovers={scheduleApprovers} openScheduleId={openScheduleId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
