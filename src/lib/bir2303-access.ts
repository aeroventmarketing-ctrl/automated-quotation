/**
 * Who may handle a client's BIR Form 2303.
 *
 * The owner: *"Add a link wherein the sales role or accounting role can upload
 * the BIR 2303, put an eyeview and use AI reading to autofill the additional
 * fields."*
 *
 *                      open the file   upload · AI read · edit the fields
 *   Admin                    ✓                    ✓
 *   Sales                    ✓                    ✓
 *   Accounting               ✓                    ✓
 *   Payment Approver         ✓                    —      ← signs off VAT money; reads it
 *   Engineer                 ✓                    —      ← quotes the client; reads it
 *   everyone else            —                    —
 *
 * The five fields themselves show on the client profile to whoever can open it,
 * as the TIN always has; only the certificate file and the editing are gated.
 *
 * ONE definition, read by the page, the upload/view route, the AI route and the
 * actions — the lesson of `catalogue-access.ts`. Asserted per seat beside it.
 *
 * Accounting and Payment Approver are WORKFLOW roles; Sales and Engineer are
 * ACCOUNT roles.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments } from "@/lib/workflow-roles";

export interface Bir2303Access {
  /** The eye — open the uploaded certificate. */
  canView: boolean;
  /** Upload / replace it, run the AI read, and save the five fields. */
  canEdit: boolean;
}

export function bir2303Access(user: User | null | undefined, roles: WorkflowRoleAssignments): Bir2303Access {
  if (!user) return { canView: false, canEdit: false };
  const admin = isAdmin(user);
  const sales = user.role === "SALES";
  const accounting = userHasWorkflowRole(roles, user.id, "accounting");
  const approver = userHasWorkflowRole(roles, user.id, "payment_approver");
  const engineer = user.role === "ENGINEER";
  const canEdit = admin || sales || accounting;
  return { canView: canEdit || approver || engineer, canEdit };
}
