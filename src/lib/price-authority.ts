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
import type { User } from "@prisma/client";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleAssignments, type WorkflowRoleKey } from "@/lib/workflow-roles";

/**
 * The rule itself, on a user + role map the caller already has.
 *
 * Several places now need it while holding the assignments for other reasons
 * (the stock-action handshake, the Products approval queue), and re-deriving it
 * there is how two copies of a policy drift apart.
 */
export function isCataloguePriceOwner(user: User | null | undefined, assignments: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return userHasWorkflowRole(assignments, user.id, "payment_approver" as WorkflowRoleKey);
}

/** True when this user may write catalogue prices. */
export async function canSetCataloguePrice(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (isAdmin(user)) return true;
  return isCataloguePriceOwner(user, await getWorkflowRoles());
}

/**
 * What the screens say when a change is parked for the price owner. The Inventory
 * edit and the Products save are not refused — they are *held*, because the
 * proposer is doing legitimate work and only the price owner may release it.
 */
export const PRICE_OWNER_CONFIRMS =
  "Sent to the Admin / Payment Approver for approval. The change takes effect once they confirm it.";

export const PRICE_OWNER_MESSAGE =
  "Only an Admin or the Payment Approver can set prices. Ask them to update the price in Products / Inventory — or put the price on the purchase order line with a reason.";

/** Throw unless this user may write catalogue prices. */
export async function assertCataloguePriceOwner(): Promise<void> {
  if (!(await canSetCataloguePrice())) throw new Error(PRICE_OWNER_MESSAGE);
}

/**
 * Downloading and uploading the catalogue as a file is the same authority.
 *
 * Owner's decision: *"only the admin/payment approver can download or upload csv
 * or excel file."* A spreadsheet is the catalogue in bulk — an upload writes
 * every price at once, and a download carries the whole price list out of the
 * system — so the file is reserved for the people who own what is in it. Same
 * set of people as `canSetCataloguePrice`; a separate name and message because
 * they are a separate question, and one may be relaxed without the other.
 */
export const CATALOGUE_FILE_MESSAGE =
  "Only an Admin or the Payment Approver can download or upload the catalogue as a CSV / Excel file.";

export async function canTransferCatalogueFiles(): Promise<boolean> {
  return canSetCataloguePrice();
}

/** Throw unless this user may download / upload catalogue spreadsheets. */
export async function assertCatalogueFileOwner(): Promise<void> {
  if (!(await canTransferCatalogueFiles())) throw new Error(CATALOGUE_FILE_MESSAGE);
}
