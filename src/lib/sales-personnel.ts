/**
 * "Sales personnel" — users who may be credited on a sale even though their
 * app-access role isn't SALES (e.g. an Engineer who also sells). Stored as a set
 * of user IDs in the AppSetting key/value table (no schema change / migration),
 * mirroring how workflow roles and the alerts go-live gate are stored.
 *
 * Everyone with the SALES role is a salesperson implicitly; this set ADDS others.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SALES_PERSONNEL_KEY = "sales_personnel";

/** The extra (non-SALES-role) user IDs marked as sales personnel. */
export async function getSalesPersonnelIds(): Promise<string[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: SALES_PERSONNEL_KEY } }).catch(() => null);
  const v = (row?.value as { userIds?: unknown } | null) ?? null;
  return v && Array.isArray(v.userIds) ? v.userIds.filter((x): x is string => typeof x === "string") : [];
}

/** Add or remove one user from the sales-personnel set; returns the new set. */
export async function setUserSalesPersonnel(userId: string, on: boolean): Promise<string[]> {
  const current = new Set(await getSalesPersonnelIds());
  if (on) current.add(userId);
  else current.delete(userId);
  const userIds = [...current];
  await prisma.appSetting.upsert({
    where: { key: SALES_PERSONNEL_KEY },
    create: { key: SALES_PERSONNEL_KEY, value: { userIds } as Prisma.InputJsonValue },
    update: { value: { userIds } as Prisma.InputJsonValue },
  });
  return userIds;
}

/**
 * Everyone creditable on a sale: all SALES-role users PLUS anyone flagged as
 * sales personnel above. Sorted by name; shaped for the salesperson pickers.
 */
export async function getSalespeople(): Promise<{ id: string; name: string }[]> {
  const ids = await getSalesPersonnelIds();
  return prisma.user.findMany({
    where: { OR: [{ role: "SALES" }, ...(ids.length ? [{ id: { in: ids } }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
