/**
 * Access control for stored sale/inquiry documents. A viewer may open a document
 * if they are an admin, the document's owner (quote preparer / inquiry creator),
 * or were granted document-view permission. Paths are "sales/<quotationId>/..."
 * or "inquiries/<inquiryId>/...".
 */
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { getDocViewers } from "@/lib/doc-viewers";

export async function canViewSaleDocPath(user: User | null | undefined, path: string): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const [scope, ownerId] = path.split("/");
  let isOwner = false;
  if (scope === "sales" && ownerId) {
    const quote = await prisma.quotation.findUnique({ where: { id: ownerId }, select: { preparedById: true } });
    isOwner = quote?.preparedById === user.id;
  } else if (scope === "inquiries" && ownerId) {
    const inq = await prisma.inquiry.findUnique({ where: { id: ownerId }, select: { createdById: true } });
    isOwner = inq?.createdById === user.id;
  }
  return isOwner || (await getDocViewers()).includes(user.id);
}
