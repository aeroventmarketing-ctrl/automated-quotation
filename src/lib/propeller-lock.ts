/**
 * Admin toggle for the Propeller Type (Power Roof Ventilator / Wall Fan) static-
 * pressure lock. When ON (the default), Propeller Type lines are capped at 0.5"
 * w.g. — the builder warns and disables Run selection above that. When OFF, the
 * cap is not enforced. Stored in the AppSetting key/value table (no migration).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const PROPELLER_SP_LOCK_KEY = "propeller_sp_lock";

/** Whether the Propeller Type 0.5" w.g. lock is enabled (default true). */
export async function getPropellerSpLock(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: PROPELLER_SP_LOCK_KEY } });
  const v = (row?.value as { enabled?: unknown } | null) ?? null;
  // Default ON when unset; only an explicit false disables it.
  return v?.enabled === false ? false : true;
}

/** Enable/disable the Propeller Type static-pressure lock. */
export async function setPropellerSpLock(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: PROPELLER_SP_LOCK_KEY },
    create: { key: PROPELLER_SP_LOCK_KEY, value: { enabled } as Prisma.InputJsonValue },
    update: { value: { enabled } as Prisma.InputJsonValue },
  });
}
