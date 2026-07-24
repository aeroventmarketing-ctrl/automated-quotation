import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildScheduleView, expandOccurrences, coerceAttendees } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/**
 * In-app calendar reminders due right now for the signed-in user: approved events
 * with a reminder set, whose reminder time has arrived and that haven't started
 * long ago. When an event has named attendees, only they (and the creator) are
 * reminded; otherwise everyone on the team calendar is. Recurring events are
 * expanded so the next occurrence reminds too. The client shows these and tracks
 * which it has dismissed (per browser).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ reminders: [] });
  try {
    const now = Date.now();
    const from = new Date(now - 36 * 3600 * 1000);
    const to = new Date(now + 3 * 24 * 3600 * 1000);
    const rows = await prisma.schedule.findMany({
      where: { status: "APPROVED", remindMinutes: { not: null }, startAt: { lte: to }, recurrence: null },
      orderBy: { startAt: "asc" },
    });
    // Recurring rows aren't bounded by startAt<=to, fetch them separately.
    const recurring = await prisma.schedule.findMany({
      where: { status: "APPROVED", remindMinutes: { not: null }, NOT: { recurrence: null } },
    });
    const views = [...rows, ...recurring].map((s) => ({
      ...buildScheduleView(s, { viewerId: user.id, canDecide: false }),
      _createdById: s.createdById,
    }));
    const occ = expandOccurrences(views as never, from.getTime(), to.getTime());
    const out: { key: string; id: string; title: string; startAt: string; remindMinutes: number; location: string | null; calendar: string | null }[] = [];
    for (const o of occ as (typeof occ[number] & { _createdById?: string })[]) {
      if (o.remindMinutes == null) continue;
      const startMs = Date.parse(o.startAt);
      const remindAt = startMs - o.remindMinutes * 60_000;
      // Fire from the reminder time until 30 min after the event starts.
      if (!(now >= remindAt && now <= startMs + 30 * 60_000)) continue;
      // Relevance: attendees-only when the event has any; otherwise everyone.
      const attendees = coerceAttendees(o.attendees);
      const relevant = attendees.length === 0 || o._createdById === user.id || attendees.some((a) => a.userId === user.id);
      if (!relevant) continue;
      out.push({ key: o.instanceKey ?? o.id, id: o.id, title: o.title, startAt: o.startAt, remindMinutes: o.remindMinutes, location: o.location, calendar: o.calendar });
    }
    return Response.json({ reminders: out.slice(0, 20) });
  } catch {
    return Response.json({ reminders: [] });
  }
}
