/**
 * Who may handle a client's BIR Form 2303.
 *
 * The owner, first: *"Add a link wherein the sales role or accounting role can
 * upload the BIR 2303, put an eyeview and use AI reading to autofill the
 * additional fields."* Then, narrowing Sales and adding the approver: *"Allow
 * sales account holder, accounting, admin and payment approver change the 2303
 * section."*
 *
 *                              open the file   upload · AI read · edit the fields
 *   Admin                            ✓                    ✓
 *   Accounting                       ✓                    ✓
 *   Payment Approver                 ✓                    ✓
 *   the client's account holder      ✓                    ✓   ← THIS client's sales in-charge
 *   any other Sales                  ✓                    —   ← reads it, doesn't change it
 *   Engineer                         ✓                    —
 *   everyone else                    —                    —
 *
 * "Account holder" is the sales in-charge shown on the client profile: the open
 * assignment in the account registry, or — for a client never assigned or
 * transferred — whoever created its first inquiry (`accountHolderId`). It is a
 * fact about the CLIENT, so the caller passes it in; this stays pure.
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

export function bir2303Access(
  user: User | null | undefined,
  roles: WorkflowRoleAssignments,
  /** This client's sales in-charge (`accountHolderId`), or null. */
  accountHolderId: string | null,
): Bir2303Access {
  if (!user) return { canView: false, canEdit: false };
  const admin = isAdmin(user);
  const accounting = userHasWorkflowRole(roles, user.id, "accounting");
  const approver = userHasWorkflowRole(roles, user.id, "payment_approver");
  const holder = accountHolderId != null && accountHolderId === user.id;
  const canEdit = admin || accounting || approver || holder;
  return { canView: canEdit || user.role === "SALES" || user.role === "ENGINEER", canEdit };
}
