/**
 * Access control for stored sale/inquiry documents. A viewer may open a document
 * if they are an admin, the document's owner (quote preparer / inquiry creator),
 * a user granted document-view permission, or — to match the documents list they
 * already see on the order page — anyone who is NOT client-restricted. Only the
 * client-restricted shop-floor roles (whose document lists are hidden) are blocked
 * unless explicitly granted. Paths are "sales/<quotationId>/..." or
 * "inquiries/<inquiryId>/...".
 */
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { getDocViewers } from "@/lib/doc-viewers";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { isClientRestricted } from "@/lib/client-visibility";

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
  if (isOwner) return true;
  if ((await getDocViewers()).includes(user.id)) return true;
  // Anyone who isn't client-restricted already sees the documents list, so let
  // them open the documents too. Client-restricted roles stay blocked (unless
  // explicitly granted above).
  const assignments = await getWorkflowRoles();
  return !(await isClientRestricted(user, assignments));
}
