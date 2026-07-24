import { CalendarDays } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, canApprove } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { ScheduleCalendar } from "../management/schedule-calendar";
import { buildScheduleView, expandOccurrences, type ScheduleView } from "@/lib/schedule";
import { getCalendars } from "@/lib/calendars";

export const dynamic = "force-dynamic";

/**
 * Team calendar — available to every signed-in user and role. Anyone may add a
 * schedule (it starts PENDING); an Engineer / Admin / Approver approves. This is
 * the same calendar shown on the Management Dashboard, surfaced on its own page
 * so all roles can see and use it.
 */
export default async function CalendarPage() {
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

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Shared schedule for the whole team. Anyone can add a schedule — it&rsquo;s pending until an
          Engineer, Admin or Approver approves it.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-muted-foreground" /> Team calendar</CardTitle>
        </CardHeader>
        <CardContent>
          {scheduleMissing ? (
            <p className="py-6 text-center text-sm text-muted-foreground">The calendar isn&rsquo;t set up yet — apply the schedule migrations (<code className="rounded bg-muted px-1">0025_schedules</code> … <code className="rounded bg-muted px-1">0030_calendar_features</code>) in Supabase to enable it.</p>
          ) : (
            <ScheduleCalendar schedules={scheduleRows} canApprove={canApproveSchedule} viewerId={viewer?.id ?? ""} users={users} calendars={calendars} canManageCalendars={canApproveSchedule} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
