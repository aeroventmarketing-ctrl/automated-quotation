/**
 * Alerts go-live gate — a launch switch that keeps EVERY user-facing alert and
 * notification silent until a chosen moment, then only lets NEW ones through.
 *
 * Nothing is hidden, muted or deleted: client details, orders and the workflow
 * are untouched, and the approver alarm stays enabled. This only decides *when*
 * an alert may fire. While the gate is on and the go-live moment is still in the
 * future, no alert surface triggers at all. From the go-live moment onward, an
 * alert fires only for items that became pending / were created after it — the
 * pre-launch backlog stays quiet forever.
 *
 * Default: 1 Aug 2026, 5:00 AM Manila (UTC+8) = 2026-07-31T21:00:00Z. Admin can
 * change the date/time or turn the gate off entirely from the Admin page.
 *
 * Stored in the AppSetting key/value table (no migration).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const ALERT_GOLIVE_KEY = "alerts_go_live";

/** 1 Aug 2026 05:00 Manila (UTC+8), as a UTC ISO instant. */
export const DEFAULT_GOLIVE_AT = "2026-07-31T21:00:00.000Z";

export interface AlertGoLive {
  on: boolean;
  at: string; // ISO UTC — the moment alerts start firing (for items newer than it)
}

function isValidIso(s: unknown): s is string {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

export async function getAlertGoLive(): Promise<AlertGoLive> {
  const row = await prisma.appSetting.findUnique({ where: { key: ALERT_GOLIVE_KEY } }).catch(() => null);
  const v = (row?.value as { on?: unknown; at?: unknown } | null) ?? null;
  // No stored row → the gate is on with the default launch moment.
  if (!v) return { on: true, at: DEFAULT_GOLIVE_AT };
  return { on: v.on === true, at: isValidIso(v.at) ? v.at : DEFAULT_GOLIVE_AT };
}

/** Save the gate's on/off and (optionally) a new go-live moment. */
export async function setAlertGoLive(on: boolean, at?: string): Promise<AlertGoLive> {
  const nextAt = isValidIso(at) ? new Date(at).toISOString() : (await getAlertGoLive()).at;
  const value = { on, at: nextAt };
  await prisma.appSetting.upsert({
    where: { key: ALERT_GOLIVE_KEY },
    create: { key: ALERT_GOLIVE_KEY, value: value as Prisma.InputJsonValue },
    update: { value: value as Prisma.InputJsonValue },
  });
  return value;
}

/**
 * True while alerts are globally suppressed *right now* — i.e. the gate is on and
 * the go-live moment hasn't arrived yet. Use this to blank surfaces that carry no
 * per-item timestamp (nav dots, calendar reminders, the inline "awaiting
 * approval" badges): hide them until launch, then let them behave normally.
 */
export function alertsSuppressedNow(g: AlertGoLive, now: Date = new Date()): boolean {
  return g.on && Date.parse(g.at) > now.getTime();
}

/**
 * True when an alert whose "became pending / created" time is `when` is allowed
 * to fire — for timestamped surfaces (approver alarm, dashboard feeds, activity
 * bell). With the gate off, everything passes. With it on, only items newer than
 * the go-live moment pass: this silences the whole backlog before launch AND the
 * pre-launch backlog after launch, in one comparison.
 */
export function alertPasses(when: string | Date | null | undefined, g: AlertGoLive): boolean {
  if (!g.on) return true;
  if (!when) return true; // no timestamp to compare — don't suppress it
  const t = typeof when === "string" ? Date.parse(when) : when.getTime();
  if (Number.isNaN(t)) return true;
  return t > Date.parse(g.at);
}

/** A Prisma `createdAt` filter that keeps only post-go-live rows (or undefined). */
export function alertGoLiveCreatedAtFilter(g: AlertGoLive): { gt: Date } | undefined {
  return g.on ? { gt: new Date(g.at) } : undefined;
}
