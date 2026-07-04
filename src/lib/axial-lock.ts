/**
 * Admin toggle for the Axial Type (Tubeaxial / Vaneaxial) static-pressure lock.
 * When ON (the default), the builder caps Tubeaxial at 1.5" w.g. and Vaneaxial at
 * 4" w.g. — it warns and disables Run selection above those. When OFF, the caps
 * are not enforced. Stored in the AppSetting key/value table (no migration).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const AXIAL_SP_LOCK_KEY = "axial_sp_lock";

/** Whether the Axial Type static-pressure lock is enabled (default true). */
export async function getAxialSpLock(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: AXIAL_SP_LOCK_KEY } });
  const v = (row?.value as { enabled?: unknown } | null) ?? null;
  return v?.enabled === false ? false : true;
}

/** Enable/disable the Axial Type static-pressure lock. */
export async function setAxialSpLock(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: AXIAL_SP_LOCK_KEY },
    create: { key: AXIAL_SP_LOCK_KEY, value: { enabled } as Prisma.InputJsonValue },
    update: { value: { enabled } as Prisma.InputJsonValue },
  });
}
