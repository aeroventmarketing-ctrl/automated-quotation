/**
 * System activity feed. `logActivity` records a notable action (approvals, stage
 * changes, lifecycle events) into the ActivityLog table; it NEVER throws, so a
 * logging failure can't break the underlying action — and it's a silent no-op if
 * the 0029_activity_log migration hasn't been applied yet. `listActivity` reads
 * the most recent entries for the dashboard notification bell.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ActivityCategory =
  | "order"
  | "schedule"
  | "cash"
  | "purchase"
  | "inventory"
  | "quotation"
  | "commission"
  | "admin"
  | "general";

export interface ActivityActor {
  id?: string | null;
  name?: string | null;
}

export interface LogActivityInput {
  action: string;
  category?: ActivityCategory;
  summary: string;
  entity?: string | null;
  entityId?: string | null;
  href?: string | null;
  meta?: Record<string, unknown>;
}

/** Record a system activity. Best-effort: swallows every error. */
export async function logActivity(actor: ActivityActor | null | undefined, input: LogActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        action: input.action,
        category: input.category ?? "general",
        summary: input.summary,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        href: input.href ?? null,
        actorId: actor?.id ?? null,
        actorName: actor?.name?.trim() || "System",
        meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch {
    // Table not migrated yet, or a transient error — never block the caller.
  }
}

export interface ActivityView {
  id: string;
  action: string;
  category: string;
  summary: string;
  entity: string | null;
  entityId: string | null;
  href: string | null;
  actorName: string;
  createdAt: string;
}

/** The most recent activity entries, newest first. Returns [] if unavailable. */
export async function listActivity(limit = 50): Promise<ActivityView[]> {
  try {
    const rows = await prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      category: r.category,
      summary: r.summary,
      entity: r.entity,
      entityId: r.entityId,
      href: r.href,
      actorName: r.actorName,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}
