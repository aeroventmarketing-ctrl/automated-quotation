/**
 * Who may view sale/order documents. Admins and the quote's preparer can always
 * view; beyond that, an admin grants view access to specific users. Stored in the
 * AppSetting key/value table (no migration).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const DOC_VIEWERS_KEY = "doc_viewers";

/** User ids the admin has granted document-view access. */
export async function getDocViewers(): Promise<string[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: DOC_VIEWERS_KEY } });
  const v = (row?.value as { ids?: unknown } | null)?.ids;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** Replace the granted-viewer list. */
export async function setDocViewers(ids: string[]): Promise<string[]> {
  const clean = [...new Set(ids.filter((x) => typeof x === "string" && x !== ""))];
  await prisma.appSetting.upsert({
    where: { key: DOC_VIEWERS_KEY },
    create: { key: DOC_VIEWERS_KEY, value: { ids: clean } as Prisma.InputJsonValue },
    update: { value: { ids: clean } as Prisma.InputJsonValue },
  });
  return clean;
}
