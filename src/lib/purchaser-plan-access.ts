/**
 * Who may open the Purchaser Plan, and who may fill in each of its two columns.
 *
 * The owner, first: *"In purchaser role, engineer role, admin role, payment
 * approver role. Add a tile named 'Purchaser Plan'."* Then, splitting the two
 * columns: *"Add sales role who can see the Purchaser Plan tile, sales role can
 * add and edit client due date. Purchaser role cannot add and edit the client
 * due date. Engineer role, admin role and payment approver can edit and add
 * client due date."*
 *
 *                      see   Type   Client due date
 *   Admin               ✓     ✓          ✓
 *   Payment Approver    ✓     ✓          ✓
 *   Engineer            ✓     ✓          ✓
 *   Purchaser           ✓     ✓          —      ← the client's date is Sales' to give
 *   Sales               ✓     —          ✓      ← granted only the client due date
 *
 * Sales was given the Client due date and nothing else, so Type stays with the
 * four who had it. A person holding two of these seats gets the union — a
 * Purchaser who is also an Engineer edits the Client due date as an Engineer.
 *
 * ONE definition, read by the dashboard tile, the page and the server actions —
 * the lesson of `catalogue-access.ts`. Asserted per seat in the test beside it.
 *
 * Purchaser and Payment Approver are WORKFLOW roles; Engineer and Sales are
 * ACCOUNT roles, so they need no workflow role to qualify.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments, type WorkflowRoleKey } from "@/lib/workflow-roles";

export interface PurchaserPlanAccess {
  /** The dashboard tile, and the page. */
  canView: boolean;
  /** Set Type — "Purchase to supplier" / "For fabrication". */
  canEditType: boolean;
  /** Set the Client due date. */
  canEditClientDue: boolean;
}

const NONE: PurchaserPlanAccess = { canView: false, canEditType: false, canEditClientDue: false };

export function purchaserPlanAccess(user: User | null | undefined, roles: WorkflowRoleAssignments): PurchaserPlanAccess {
  if (!user) return NONE;
  const has = (r: WorkflowRoleKey) => userHasWorkflowRole(roles, user.id, r);
  const admin = isAdmin(user);
  const engineer = user.role === "ENGINEER";
  const sales = user.role === "SALES";
  const purchaser = has("purchaser");
  const approver = has("payment_approver");

  const core = admin || engineer || approver; // edit both columns
  return {
    canView: core || purchaser || sales,
    canEditType: core || purchaser,
    canEditClientDue: core || sales,
  };
}
