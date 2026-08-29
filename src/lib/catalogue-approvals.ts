/**
 * How many catalogue changes are sitting unconfirmed, for the flashing counts on
 * the Inventory and Products nav tabs.
 *
 * Owner's instruction: *"make a flashing notification at the word inventory and
 * products when warehouse or purchaser initiate edit in inventory tab or
 * products tab. Show this notification for purchaser, warehouse, payment
 * approver and admin role."*
 *
 * Both queues are already visible INSIDE their pages — the pending card on
 * Products, the amber chip on an Inventory row — which is exactly the problem:
 * you have to be on the page to know. The nav badge is the part that reaches
 * someone who is somewhere else.
 *
 * Counted, and why:
 *   - **Inventory** — **every** pending stock action: Edit, Adjust, Reserve and
 *     Transfer alike. It first counted Edits only, on the reading that "initiate
 *     edit" meant the edit panel; the owner asked for the rest to be included,
 *     and they were right — an adjustment sitting unapproved needs someone to
 *     look at it just as much, and a badge that ignored it made the Inventory
 *     row's amber "Pending" chip look like it was flashing about nothing.
 *   - **Products** — pending `ProductChange` rows. Every one of them is a
 *     Purchaser's add / save / delete, since a price owner's own save writes
 *     straight through and never parks.
 *
 * A proposer keeps seeing their own change in the count. It is still waiting,
 * and a badge that vanished for the person who raised it would read as "done".
 */
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments, type WorkflowRoleKey } from "@/lib/workflow-roles";

/** The parties to a catalogue change: those who propose and those who confirm. */
const WATCHER_ROLES: WorkflowRoleKey[] = ["purchaser", "warehouse", "payment_approver"];

export function watchesCatalogueApprovals(user: User | null | undefined, assignments: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return WATCHER_ROLES.some((r) => userHasWorkflowRole(assignments, user.id, r));
}

export interface CatalogueApprovalCounts {
  inventory: number;
  products: number;
}

/**
 * Zero for anyone outside those four roles, and zero rather than a throw when a
 * table is missing — a nav badge must never be able to take the whole layout,
 * and hence every page, down with it.
 */
export async function getCatalogueApprovalCounts(
  user: User | null | undefined,
  assignments: WorkflowRoleAssignments,
): Promise<CatalogueApprovalCounts> {
  if (!watchesCatalogueApprovals(user, assignments)) return { inventory: 0, products: 0 };

  // The Products badge is the one exception to "all four roles". The pending
  // card it points at shows a field-by-field diff INCLUDING supplier prices, and
  // the Warehouse is not a price viewer (`PRICE_ROLES` in lib/price-visibility)
  // — so the Products page does not render that card for them. Badging a tab
  // that will show them nothing is a dead end, and rendering the card instead
  // would leak exactly the figures that list exists to withhold. They keep the
  // Inventory badge, where they are a party to the handshake.
  const products =
    user && (isAdmin(user) || userHasWorkflowRole(assignments, user.id, "purchaser" as WorkflowRoleKey) || userHasWorkflowRole(assignments, user.id, "payment_approver" as WorkflowRoleKey))
      ? await prisma.productChange.count({ where: { status: "PENDING" } }).catch(() => 0)
      : 0;
  const inventory = await prisma.stockAction.count({ where: { status: "PENDING" } }).catch(() => 0);
  return { inventory, products };
}
