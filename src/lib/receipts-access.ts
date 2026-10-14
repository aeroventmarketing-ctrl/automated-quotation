/**
 * Who may use Receipt Generation and print the BIR receipts.
 *
 * The owner: *"add a Receipt Generation tab … Show this tab to payment approver
 * and admin role"* — then, moving it: *"Instead of appearing below Cash Request,
 * make it appear to the Order workflow … below Phase 6 - Sales Commissions box."*
 * So it is a box on the order page (for the VAT orders `receiptsApplyTo` names),
 * and these are the seats that see it:
 *
 *                      the box · generate & download the receipts
 *   Admin                         ✓
 *   Accounting                    ✓
 *   Payment Approver              ✓
 *   Engineer                      ✓   (*"Add receipt generation in engineer role"*)
 *   everyone else                 —
 *
 * ONE definition, read by the order page and the download route. Asserted per
 * seat beside it.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments } from "@/lib/workflow-roles";

const RECEIPT_ROLES = ["accounting", "payment_approver"] as const;

export function canGenerateReceipts(user: User | null | undefined, roles: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  return isAdmin(user) || user.role === "ENGINEER" || RECEIPT_ROLES.some((r) => userHasWorkflowRole(roles, user.id, r));
}
