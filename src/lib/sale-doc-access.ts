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
import { saleFromClassification } from "@/lib/sale";
import { readOrderWorkflow } from "@/lib/order-workflow";

/**
 * The proof-of-delivery file paths attached to an order (the order-level POD plus
 * every delivery batch's POD). Client-restricted roles — chiefly Logistics, who
 * attach these — are otherwise blocked from sale documents but must be able to
 * open the delivery proofs they handle. This does NOT expose financial documents.
 */
function orderPodPaths(classification: unknown): Set<string> {
  const paths = new Set<string>();
  const sale = saleFromClassification(classification);
  for (const d of sale?.docs?.pod ?? []) paths.add(d.path);
  const wf = readOrderWorkflow(classification);
  for (const b of wf.deliveryBatches) for (const d of b.pod ?? []) paths.add(d.path);
  return paths;
}

export async function canViewSaleDocPath(user: User | null | undefined, path: string): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const [scope, ownerId] = path.split("/");
  let quoteClassification: unknown = null;
  let isOwner = false;
  if (scope === "sales" && ownerId) {
    const quote = await prisma.quotation.findUnique({ where: { id: ownerId }, select: { preparedById: true, classification: true } });
    isOwner = quote?.preparedById === user.id;
    quoteClassification = quote?.classification ?? null;
  } else if (scope === "inquiries" && ownerId) {
    const inq = await prisma.inquiry.findUnique({ where: { id: ownerId }, select: { createdById: true } });
    isOwner = inq?.createdById === user.id;
  }
  if (isOwner) return true;
  if ((await getDocViewers()).includes(user.id)) return true;
  // Anyone who isn't client-restricted already sees the documents list, so let
  // them open the documents too.
  const assignments = await getWorkflowRoles();
  if (!(await isClientRestricted(user, assignments))) return true;
  // Client-restricted (shop-floor) viewers stay blocked from financial documents,
  // but may still open the proof-of-delivery files they attach/handle.
  if (quoteClassification && orderPodPaths(quoteClassification).has(path)) return true;
  return false;
}
