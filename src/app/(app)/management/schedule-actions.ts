"use server";

import { randomUUID } from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin, canApprove } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import { SCHEDULE_CATEGORIES, coerceAttendees, coerceAttachments, coerceComments, type RsvpStatus } from "@/lib/schedule";
import { getCalendars, normalizeCalendar, addCalendar, removeCalendar } from "@/lib/calendars";
import type { User } from "@prisma/client";

const J = (v: unknown) => v as unknown as Prisma.InputJsonValue;

const CAT_KEYS = new Set(SCHEDULE_CATEGORIES.map((c) => c.key));

async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

/** Who may approve/reject a schedule: an Engineer, Admin, or a Payment Approver. */
export async function isScheduleApprover(user: User): Promise<boolean> {
  if (canApprove(user) || isAdmin(user)) return true; // ENGINEER or ADMIN
  const roles = await getWorkflowRoles();
  return userHasWorkflowRole(roles, user.id, "payment_approver" as WorkflowRoleKey);
}

const scheduleSchema = z.object({
  title: z.string().trim().min(1, "Add a title for the schedule."),
  details: z.string().trim().optional(),
  category: z.string().trim().default("general"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  allDay: z.coerce.boolean().default(true),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  location: z.string().trim().optional(),
  recurrence: z.enum(["", "daily", "weekly", "monthly"]).optional().default(""),
  recurrenceUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  remindMinutes: z.number().int().min(0).max(20160).nullable().optional(),
  calendar: z.string().trim().optional().default(""),
  attendees: z.array(z.object({ userId: z.string().min(1), name: z.string().min(1) })).optional().default([]),
});
type ScheduleInput = z.infer<typeof scheduleSchema>;

// AeroVent runs on Manila time (fixed UTC+8, no DST). Entered wall-clock times
// are stored as the matching UTC instant, and the calendar renders them back in
// Manila — so what you type is what everyone sees.
function toInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+08:00`);
}
function timesOf(d: ScheduleInput): { startAt: Date; endAt: Date | null } {
  const startAt = toInstant(d.date, d.allDay ? "00:00" : (d.startTime || "09:00"));
  const endAt = !d.allDay && d.endTime ? toInstant(d.date, d.endTime) : null;
  return { startAt, endAt };
}
const catOf = (k: string) => (CAT_KEYS.has(k) ? k : "general");

/** Build the shared extra fields (recurrence / reminder / calendar / attendees). */
async function extrasOf(d: ScheduleInput, user: User, existingAttendees: { userId: string; rsvp: RsvpStatus }[] = []) {
  const calendars = await getCalendars();
  const rsvpByUser = new Map(existingAttendees.map((a) => [a.userId, a.rsvp]));
  const attendees = d.attendees.map((a) => ({
    userId: a.userId,
    name: a.name,
    // Preserve an existing RSVP; the creator defaults to "going", others "invited".
    rsvp: rsvpByUser.get(a.userId) ?? (a.userId === user.id ? "going" : "invited"),
  }));
  return {
    recurrence: d.recurrence || null,
    recurrenceUntil: d.recurrence && d.recurrenceUntil ? new Date(`${d.recurrenceUntil}T23:59:59+08:00`) : null,
    remindMinutes: d.remindMinutes ?? null,
    calendar: normalizeCalendar(d.calendar, calendars),
    attendees: J(attendees),
  };
}

/** Any signed-in user may add a schedule. It starts PENDING unless the creator
 *  can approve (Engineer / Admin / Approver), in which case it's auto-approved. */
export async function createSchedule(input: ScheduleInput): Promise<void> {
  const user = await requireUser();
  const d = scheduleSchema.parse(input);
  const approver = await isScheduleApprover(user);
  const { startAt, endAt } = timesOf(d);
  const now = new Date();
  const extras = await extrasOf(d, user);
  await prisma.schedule.create({
    data: {
      title: d.title,
      details: d.details || null,
      category: catOf(d.category),
      startAt,
      endAt,
      allDay: d.allDay,
      location: d.location || null,
      status: approver ? "APPROVED" : "PENDING",
      createdById: user.id,
      createdByName: user.name,
      ...extras,
      ...(approver ? { decidedById: user.id, decidedByName: user.name, decidedAt: now } : {}),
    },
  });
  await logActivity(user, {
    action: "schedule.create",
    category: "schedule",
    summary: `Added schedule “${d.title}”${approver ? "" : " (pending approval)"}`,
    entity: "schedule",
    href: "/calendar",
  });
  revalidatePath("/management");
  revalidatePath("/calendar");
}

/** Edit a schedule. The creator or an approver may edit; when a non-approver
 *  edits, the schedule returns to PENDING for (re-)approval. */
export async function updateSchedule(id: string, input: ScheduleInput): Promise<void> {
  const user = await requireUser();
  const d = scheduleSchema.parse(input);
  const s = await prisma.schedule.findUnique({ where: { id } });
  if (!s) throw new Error("Schedule not found.");
  const approver = await isScheduleApprover(user);
  if (!(approver || s.createdById === user.id)) throw new Error("You can only edit your own schedule.");
  const { startAt, endAt } = timesOf(d);
  const resetForApproval = !approver; // owner edits need re-approval
  const extras = await extrasOf(d, user, coerceAttendees(s.attendees).map((a) => ({ userId: a.userId, rsvp: a.rsvp })));
  await prisma.schedule.update({
    where: { id },
    data: {
      title: d.title,
      details: d.details || null,
      category: catOf(d.category),
      startAt,
      endAt,
      allDay: d.allDay,
      location: d.location || null,
      ...extras,
      ...(resetForApproval ? { status: "PENDING", decidedById: null, decidedByName: null, decidedAt: null, decisionNote: null } : {}),
    },
  });
  revalidatePath("/management");
  revalidatePath("/calendar");
}

/** Delete a schedule — the creator or an approver. */
export async function deleteSchedule(id: string): Promise<void> {
  const user = await requireUser();
  const s = await prisma.schedule.findUnique({ where: { id } });
  if (!s) return;
  const approver = await isScheduleApprover(user);
  if (!(approver || s.createdById === user.id)) throw new Error("You can only delete your own schedule.");
  await prisma.schedule.delete({ where: { id } });
  revalidatePath("/management");
  revalidatePath("/calendar");
}

/** Approve or reject a schedule — Engineer, Admin or Approver only. */
export async function decideSchedule(id: string, decision: "approve" | "reject", note?: string): Promise<void> {
  const user = await requireUser();
  if (!(await isScheduleApprover(user))) throw new Error("Only an Engineer, Admin or Approver can approve schedules.");
  const s = await prisma.schedule.update({
    where: { id },
    data: {
      status: decision === "approve" ? "APPROVED" : "REJECTED",
      decidedById: user.id,
      decidedByName: user.name,
      decidedAt: new Date(),
      decisionNote: note?.trim() || null,
    },
  });
  await logActivity(user, {
    action: `schedule.${decision}`,
    category: "schedule",
    summary: `${decision === "approve" ? "Approved" : "Rejected"} schedule “${s.title}”`,
    entity: "schedule",
    href: "/calendar",
  });
  revalidatePath("/management");
  revalidatePath("/calendar");
}

const revalidateCal = () => { revalidatePath("/management"); revalidatePath("/calendar"); };

/** Post a comment on an event (any signed-in user). */
export async function addScheduleComment(id: string, text: string): Promise<void> {
  const user = await requireUser();
  const body = (text ?? "").trim().slice(0, 2000);
  if (!body) throw new Error("Write a comment first.");
  const s = await prisma.schedule.findUnique({ where: { id } });
  if (!s) throw new Error("Schedule not found.");
  const comments = coerceComments(s.comments);
  comments.push({ id: randomUUID(), byId: user.id, byName: user.name, text: body, at: new Date().toISOString() });
  await prisma.schedule.update({ where: { id }, data: { comments: J(comments) } });
  revalidateCal();
}

/** Delete a comment — its author or an approver/admin. */
export async function deleteScheduleComment(id: string, commentId: string): Promise<void> {
  const user = await requireUser();
  const s = await prisma.schedule.findUnique({ where: { id } });
  if (!s) return;
  const approver = await isScheduleApprover(user);
  const comments = coerceComments(s.comments);
  const target = comments.find((c) => c.id === commentId);
  if (!target) return;
  if (!(approver || target.byId === user.id)) throw new Error("You can only delete your own comment.");
  await prisma.schedule.update({ where: { id }, data: { comments: J(comments.filter((c) => c.id !== commentId)) } });
  revalidateCal();
}

/** Set the current user's RSVP on an event (adds them as an attendee if new). */
export async function setScheduleRsvp(id: string, rsvp: "going" | "maybe" | "no"): Promise<void> {
  const user = await requireUser();
  if (!["going", "maybe", "no"].includes(rsvp)) throw new Error("Invalid RSVP.");
  const s = await prisma.schedule.findUnique({ where: { id } });
  if (!s) throw new Error("Schedule not found.");
  const attendees = coerceAttendees(s.attendees);
  const mine = attendees.find((a) => a.userId === user.id);
  if (mine) mine.rsvp = rsvp;
  else attendees.push({ userId: user.id, name: user.name, rsvp });
  await prisma.schedule.update({ where: { id }, data: { attendees: J(attendees) } });
  revalidateCal();
}

/** Attach a file to an event (uploaded to /api/schedule-uploads). Owner/approver. */
export async function attachScheduleFile(id: string, doc: { path: string; name: string; uploadedAt?: string }): Promise<void> {
  const user = await requireUser();
  if (!doc || typeof doc.path !== "string" || typeof doc.name !== "string") throw new Error("Invalid file.");
  const s = await prisma.schedule.findUnique({ where: { id } });
  if (!s) throw new Error("Schedule not found.");
  const approver = await isScheduleApprover(user);
  if (!(approver || s.createdById === user.id)) throw new Error("Only the owner or an approver can attach files.");
  const attachments = coerceAttachments(s.attachments);
  attachments.push({ path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt ?? new Date().toISOString() });
  await prisma.schedule.update({ where: { id }, data: { attachments: J(attachments) } });
  revalidateCal();
}

/** Remove an attached file — owner or approver. */
export async function removeScheduleFile(id: string, path: string): Promise<void> {
  const user = await requireUser();
  const s = await prisma.schedule.findUnique({ where: { id } });
  if (!s) return;
  const approver = await isScheduleApprover(user);
  if (!(approver || s.createdById === user.id)) throw new Error("Only the owner or an approver can remove files.");
  const attachments = coerceAttachments(s.attachments).filter((a) => a.path !== path);
  await prisma.schedule.update({ where: { id }, data: { attachments: J(attachments) } });
  revalidateCal();
}

/** Create a named calendar (approver/admin). */
export async function addCalendarAction(name: string): Promise<string[]> {
  const user = await requireUser();
  if (!(await isScheduleApprover(user))) throw new Error("Only an Engineer, Admin or Approver can manage calendars.");
  const list = await addCalendar(name);
  revalidateCal();
  return list;
}

/** Remove a named calendar (approver/admin). Events keep their label. */
export async function removeCalendarAction(name: string): Promise<string[]> {
  const user = await requireUser();
  if (!(await isScheduleApprover(user))) throw new Error("Only an Engineer, Admin or Approver can manage calendars.");
  const list = await removeCalendar(name);
  revalidateCal();
  return list;
}
