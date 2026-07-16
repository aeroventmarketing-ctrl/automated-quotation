/**
 * Admin toggle for the approver notification alarm (loud sound + flashing popup
 * when an order is waiting on the viewer's approval). Stored in the AppSetting
 * key/value table (no migration). Default ON.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const NOTIFICATIONS_ENABLED_KEY = "notifications_enabled";

/** Whether the approver alarm is enabled (default true). */
export async function getNotificationsEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: NOTIFICATIONS_ENABLED_KEY } });
  const v = (row?.value as { enabled?: unknown } | null) ?? null;
  // Default ON: only disabled when explicitly set to false.
  return v?.enabled !== false;
}

/** Enable/disable the approver alarm. */
export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: NOTIFICATIONS_ENABLED_KEY },
    create: { key: NOTIFICATIONS_ENABLED_KEY, value: { enabled } as Prisma.InputJsonValue },
    update: { value: { enabled } as Prisma.InputJsonValue },
  });
}
