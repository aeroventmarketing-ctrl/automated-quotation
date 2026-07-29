/**
 * Notification backlog reset — an admin switch that gives a clean slate to
 * practice on WITHOUT hiding any data or turning the alarm off. Turning it on
 * stamps a cutoff time; every pending action / notification that became pending
 * at or before that moment is hidden from the alarm and the dashboard feeds,
 * while anything that becomes pending afterwards (during the practice run) still
 * notifies normally. Nothing is approved or deleted — turning it off (or
 * re-stamping) restores the backlog.
 *
 * Stored in the AppSetting key/value table (no migration).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const NOTIFICATION_BASELINE_KEY = "notifications_cleared";

export interface NotificationBaseline {
  on: boolean;
  since: string | null; // ISO cutoff — items pending after this still notify
}

export async function getNotificationBaseline(): Promise<NotificationBaseline> {
  const row = await prisma.appSetting.findUnique({ where: { key: NOTIFICATION_BASELINE_KEY } }).catch(() => null);
  const v = (row?.value as { on?: unknown; since?: unknown } | null) ?? null;
  return { on: v?.on === true, since: typeof v?.since === "string" ? v.since : null };
}

/** Enable/disable the reset. Enabling (re)stamps the cutoff to "now". */
export async function setNotificationBaseline(on: boolean): Promise<NotificationBaseline> {
  const since = on ? new Date().toISOString() : null;
  await prisma.appSetting.upsert({
    where: { key: NOTIFICATION_BASELINE_KEY },
    create: { key: NOTIFICATION_BASELINE_KEY, value: { on, since } as Prisma.InputJsonValue },
    update: { value: { on, since } as Prisma.InputJsonValue },
  });
  return { on, since };
}

/**
 * True when a notification whose "became pending" time is `when` should still be
 * shown (i.e. it's newer than the reset cutoff, or the reset is off). Backlog
 * items (pending at/before the cutoff) return false and are hidden.
 */
export function passesNotificationBaseline(when: string | Date | null | undefined, baseline: NotificationBaseline): boolean {
  if (!baseline.on || !baseline.since) return true;
  if (!when) return true; // no timestamp to compare — don't hide it
  const t = typeof when === "string" ? when : when.toISOString();
  return t > baseline.since;
}
