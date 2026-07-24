import { CalendarDays } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, canApprove } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { ScheduleCalendar } from "../management/schedule-calendar";
import type { ScheduleView } from "@/lib/schedule";

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
  let scheduleMissing = false;
  try {
    const since = new Date(Date.now() - 180 * 86_400_000); // keep ~6 months of history
    const rows = await prisma.schedule.findMany({ where: { startAt: { gte: since } }, orderBy: { startAt: "asc" } });
    scheduleRows = rows.map((s) => ({
      id: s.id,
      title: s.title,
      details: s.details,
      category: s.category,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt?.toISOString() ?? null,
      allDay: s.allDay,
      location: s.location,
      status: s.status,
      createdByName: s.createdByName,
      decidedByName: s.decidedByName,
      decidedAt: s.decidedAt?.toISOString() ?? null,
      decisionNote: s.decisionNote,
      isOwner: viewer?.id === s.createdById,
      canEdit: canApproveSchedule || viewer?.id === s.createdById,
      canDecide: canApproveSchedule,
    }));
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
            <p className="py-6 text-center text-sm text-muted-foreground">The calendar isn&rsquo;t set up yet — apply the <code className="rounded bg-muted px-1">0025_schedules</code> migration to enable it.</p>
          ) : (
            <ScheduleCalendar schedules={scheduleRows} canApprove={canApproveSchedule} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
