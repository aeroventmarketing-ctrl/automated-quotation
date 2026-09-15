import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { expandOccurrences, coerceAttendees } from "@/lib/schedule";
import { getAlertGoLive, alertsSuppressedNow } from "@/lib/alert-golive";

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
    // Alerts go-live gate: no reminders fire until the launch moment.
    if (alertsSuppressedNow(await getAlertGoLive())) return Response.json({ reminders: [] });
    const now = Date.now();
    const from = new Date(now - 36 * 3600 * 1000);
    const to = new Date(now + 3 * 24 * 3600 * 1000);
    // The eleven fields a reminder is made of. A schedule row also carries its
    // details, to-do list, attachments and comment thread — a whole conversation
    // about the event — and this route was fetching all of it, for every event
    // ever approved, to decide whether to show a card with a title and a time.
    const REMINDER_FIELDS = {
      id: true, title: true, startAt: true, endAt: true, remindMinutes: true,
      location: true, calendar: true, attendees: true, createdById: true,
      recurrence: true, recurrenceUntil: true,
    } as const;
    const [rows, recurring] = await Promise.all([
      prisma.schedule.findMany({
        // **Both ends of the window.** The upper bound was here from the start;
        // the lower one was not, so this read every approved event with a
        // reminder ever set — years of them — and the loop below then dropped
        // all but the couple of days it can fire in.
        //
        // A non-recurring event fires only while `now <= startAt + 30 min`, so
        // anything that started more than half an hour ago is already past
        // firing. `from` is 36 hours back — far wider than that, and the same
        // window `expandOccurrences` is given, so the two cannot disagree.
        where: { status: "APPROVED", remindMinutes: { not: null }, recurrence: null, startAt: { gte: from, lte: to } },
        select: REMINDER_FIELDS,
        orderBy: { startAt: "asc" },
      }),
      // Recurring rows can't be bounded by `startAt` — a weekly series that began
      // last year still fires this week — so they are fetched whole, and there are
      // only ever a handful of them. Fetched ALONGSIDE the query above rather
      // than after it; this route is polled by every open tab.
      prisma.schedule.findMany({
        where: { status: "APPROVED", remindMinutes: { not: null }, NOT: { recurrence: null } },
        select: REMINDER_FIELDS,
      }),
    ]);
    // Not `buildScheduleView`: that builds a schedule CARD — comments, to-dos,
    // attachments, permissions — and nothing here renders one. These are the
    // fields `expandOccurrences` reads plus the ones a reminder shows.
    const views = [...rows, ...recurring].map((s) => ({
      id: s.id,
      title: s.title,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt ? s.endAt.toISOString() : null,
      remindMinutes: s.remindMinutes,
      location: s.location,
      calendar: s.calendar,
      recurrence: s.recurrence,
      recurrenceUntil: s.recurrenceUntil ? s.recurrenceUntil.toISOString() : null,
      attendees: s.attendees,
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
