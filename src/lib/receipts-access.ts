/**
 * Who may open Receipt Generation and print the BIR receipts.
 *
 * The owner: *"In accounting role below Cash Requests tab and above Commissions
 * tab, add a Receipt Generation tab … Show this tab to payment approver and admin
 * role."*
 *
 *                      the tab · generate & download the receipts
 *   Admin                         ✓
 *   Accounting                    ✓
 *   Payment Approver              ✓
 *   everyone else                 —
 *
 * ONE definition, read by the nav, the page, the prefill action and the
 * download route. Asserted per seat beside it.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments } from "@/lib/workflow-roles";

import { RECEIPT_ROLES } from "@/lib/receipts-roles";

export { RECEIPT_ROLES };

export function canGenerateReceipts(user: User | null | undefined, roles: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  return isAdmin(user) || RECEIPT_ROLES.some((r) => userHasWorkflowRole(roles, user.id, r));
}
