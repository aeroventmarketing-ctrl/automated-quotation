/**
 * Who may set a catalogue price.
 *
 * The catalogue price — a supplier's price in Products, and an item's unit cost
 * / selling price in Inventory — is what a purchase order defaults to. Owner's
 * decision: it belongs to the **Admin and the Payment Approver**, not to the
 * Purchaser who spends against it. A default set by the same person who spends
 * against it is not a control.
 *
 * This deliberately does NOT lock the Products or Inventory screens. The
 * Warehouse still adjusts quantities and the Purchaser still adds items, sets
 * suppliers, codes and units — otherwise nobody could do their job. Only the
 * PRICE FIELDS are reserved.
 *
 * The Purchaser is not stuck when a supplier quotes something new: the PO line
 * carries a recorded override (see the purchase-order panel), so purchasing
 * keeps moving and every deviation is stamped with who, when and why.
 */
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";

/** True when this user may write catalogue prices. */
export async function canSetCataloguePrice(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (isAdmin(user)) return true;
  const roles = await getWorkflowRoles();
  return userHasWorkflowRole(roles, user.id, "payment_approver" as WorkflowRoleKey);
}

export const PRICE_OWNER_MESSAGE =
  "Only an Admin or the Payment Approver can set prices. Ask them to update the price in Products / Inventory — or put the price on the purchase order line with a reason.";

/** Throw unless this user may write catalogue prices. */
export async function assertCataloguePriceOwner(): Promise<void> {
  if (!(await canSetCataloguePrice())) throw new Error(PRICE_OWNER_MESSAGE);
}
