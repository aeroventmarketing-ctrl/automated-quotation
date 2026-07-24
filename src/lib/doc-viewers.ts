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

/**
 * Whether an admin has ever saved the document-access list. Lets the UI show
 * policy-based defaults (everyone who isn't a client-restricted shop-floor role)
 * pre-checked until the admin makes their own explicit choice.
 */
export async function isDocViewersConfigured(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: DOC_VIEWERS_KEY } });
  return row != null;
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
