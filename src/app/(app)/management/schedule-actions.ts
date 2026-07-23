"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin, canApprove } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { SCHEDULE_CATEGORIES } from "@/lib/schedule";
import type { User } from "@prisma/client";

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

/** Any signed-in user may add a schedule. It starts PENDING unless the creator
 *  can approve (Engineer / Admin / Approver), in which case it's auto-approved. */
export async function createSchedule(input: ScheduleInput): Promise<void> {
  const user = await requireUser();
  const d = scheduleSchema.parse(input);
  const approver = await isScheduleApprover(user);
  const { startAt, endAt } = timesOf(d);
  const now = new Date();
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
      ...(approver ? { decidedById: user.id, decidedByName: user.name, decidedAt: now } : {}),
    },
  });
  revalidatePath("/management");
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
      ...(resetForApproval ? { status: "PENDING", decidedById: null, decidedByName: null, decidedAt: null, decisionNote: null } : {}),
    },
  });
  revalidatePath("/management");
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
}

/** Approve or reject a schedule — Engineer, Admin or Approver only. */
export async function decideSchedule(id: string, decision: "approve" | "reject", note?: string): Promise<void> {
  const user = await requireUser();
  if (!(await isScheduleApprover(user))) throw new Error("Only an Engineer, Admin or Approver can approve schedules.");
  await prisma.schedule.update({
    where: { id },
    data: {
      status: decision === "approve" ? "APPROVED" : "REJECTED",
      decidedById: user.id,
      decidedByName: user.name,
      decidedAt: new Date(),
      decisionNote: note?.trim() || null,
    },
  });
  revalidatePath("/management");
}
