/**
 * Who may see and do what on the Inventory and Products screens.
 *
 * These rules used to live as ~30 inline booleans across the two page
 * components, which is how a run of individually-correct permission changes
 * produced a page that told the Payment Approver *"You don't have access to
 * inventory"* while the nav badge counted their work — and, separately, left
 * them allowed to upload a catalogue file with no button to do it. Nothing held
 * the whole picture, so the blast radius of a change was only ever visible to
 * whoever happened to click every screen afterwards.
 *
 * Pure functions, no I/O: the caller passes the user and the role map it already
 * has. That makes the whole policy assertable in one table — see
 * `catalogue-access.test.ts`, which is the point of this file. When a rule
 * changes, the failing cells in that table ARE the blast radius.
 *
 * The rules themselves are unchanged by the extraction; each carries the comment
 * that explains it, and the two "owner's instruction" notes record decisions
 * that would otherwise look arbitrary.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { canViewPrices, canEditPrices, canViewSupplier } from "@/lib/price-visibility";
import { isCataloguePriceOwner } from "@/lib/price-authority";
import { watchesCatalogueApprovals } from "@/lib/catalogue-approvals";

const PROD_HEADS: WorkflowRoleKey[] = ["prod_head_fans", "prod_head_duct", "prod_head_accessories", "prod_head_motor"];

export interface InventoryAccess {
  /** Open the page at all. */
  canView: boolean;
  /** Per-row Label / Reserve / Adjust, and Generate SKUs. */
  canManageItems: boolean;
  /** Upload / cancel on the Stock transfers card — wider: the Plant Manager too. */
  canManageTransfers: boolean;
  /** + Add stock item, Merge duplicates. */
  canCreateItems: boolean;
  /** Multi-select tick boxes + Delete selected (and Clear all, which is admin). */
  canDeleteItems: boolean;
  /** Per-row Edit — a *request*, so wider than `canManageItems`. */
  canProposeEdit: boolean;
  /** Per-row Set price (a price owner who is not a stock manager). */
  canEditPrices: boolean;
  /** Import from file + Download Excel / CSV. */
  canTransferFiles: boolean;
  /** The scan → jump / receive / issue box. */
  canScan: boolean;
  /** Unit cost, stock value. */
  showPrices: boolean;
  /** Sell price specifically — narrower than `showPrices`. */
  showSellPrice: boolean;
  /** The Labels / Reorder header links (both target pages deny everyone else). */
  showHeaderTools: boolean;
  /** Float items with a pending request to the top, and open the list. */
  pendingFirst: boolean;
  /** The approval history — the record of decided requests, at /inventory/approvals. */
  canViewApprovalHistory: boolean;
  /** Whose signature this viewer can give, and the sentence the panels show. */
  isPriceOwner: boolean;
  chainNote: string;
}

export const CHAIN_NOTE = {
  owner: "Applies immediately — you are the final approver.",
  warehouse: "Proposed, not saved — the Purchaser reviews it, then an Admin / the Payment Approver gives the final approval.",
  other: "Proposed, not saved — an Admin / the Payment Approver gives the final approval.",
} as const;

export function inventoryAccess(user: User | null | undefined, roles: WorkflowRoleAssignments): InventoryAccess {
  const admin = isAdmin(user ?? null);
  const has = (r: WorkflowRoleKey) => user != null && userHasWorkflowRole(roles, user.id, r);
  const priceOwner = isCataloguePriceOwner(user, roles);
  // Sales may VIEW inventory read-only — name / quantity / availability / selling
  // price — but never the unit cost, stock value, or any management action.
  const isSales = user?.role === "SALES";
  const prodHead = PROD_HEADS.some(has);

  // The Plant Manager monitors stock but does not edit items; a Warehouseman or
  // admin still manages.
  const canManageItems = !isSales && (admin || has("warehouse"));
  const canManage = !isSales && (admin || has("warehouse") || has("plant_manager"));

  return {
    // The Payment Approver was missing from this list, which is how they ended up
    // holding the final approval on every inventory request while the page
    // refused to open for them.
    canView:
      isSales || admin || canManage || priceOwner || has("purchaser") || has("accounting") ||
      has("logistics") || has("technical_head") || prodHead,
    canManageItems,
    canManageTransfers: canManage,
    // Owner's instruction: *"hide delete selected button, add stock item button,
    // merge duplicates button for purchaser role."* The Purchaser held these and
    // the Warehouseman never did, so dropping the Purchaser leaves the admin
    // alone with them — the intended effect, not an oversight. They change what
    // the item list *is*; the Warehouseman still proposes per-row changes.
    canCreateItems: admin,
    canDeleteItems: admin,
    // Wider than `canManageItems` on purpose: an edit is a *request*, not a
    // write, and it runs the approval chain. The quantity actions stay with the
    // people who hold the stock.
    canProposeEdit: !isSales && (canManageItems || has("purchaser") || priceOwner),
    canEditPrices: canEditPrices(user, roles),
    canTransferFiles: priceOwner,
    // The Purchaser keeps the scan box for goods receipt on deliveries. This does
    // NOT grant the per-row manage actions.
    canScan: canManageItems || has("purchaser"),
    showPrices: canViewPrices(user, roles),
    // The selling price is sales-side commercial data — hidden from the
    // Purchaser, Warehouse and Accounting, who still need unit cost for buying
    // and valuation.
    showSellPrice: admin || !(has("purchaser") || has("warehouse") || has("accounting")),
    // /inventory/labels and /inventory/reorder deny every role below, so linking
    // there would be a dead end.
    showHeaderTools:
      !isSales &&
      (admin ||
        !(has("payment_approver") || has("plant_manager") || has("accounting") || has("warehouse") ||
          has("logistics") || has("technical_head") || prodHead)),
    pendingFirst: watchesCatalogueApprovals(user, roles),
    // The same four parties who see a request while it waits may read it after
    // it is decided. Anyone who never had a signature to give has no record to
    // read — and the record names people and quotes prices.
    canViewApprovalHistory: watchesCatalogueApprovals(user, roles),
    isPriceOwner: priceOwner,
    // The order of these tests mirrors `proposedRole` in stock-action-actions —
    // price owner, then Warehouse, then Purchaser — so a panel never promises a
    // chain the server will not run.
    chainNote: priceOwner ? CHAIN_NOTE.owner : canManageItems ? CHAIN_NOTE.warehouse : CHAIN_NOTE.other,
  };
}

/** Roles that may open Products read-only, beyond those who can manage it. */
const PRODUCT_VIEW_ROLES: WorkflowRoleKey[] = [
  "purchaser", "warehouse", "plant_manager", "payment_approver", "accounting", "logistics",
  "technical_head", ...PROD_HEADS,
];

export interface ProductsAccess {
  canView: boolean;
  /** Per-row Edit / Save — parked for the price owner unless the viewer is one. */
  canManage: boolean;
  /** + Add product, Remove no-supplier items. */
  canAddOrRemoveProducts: boolean;
  canEditPrices: boolean;
  canTransferFiles: boolean;
  showPrices: boolean;
  showSuppliers: boolean;
  /** Approve / Reject on the parked-change queue. */
  canDecideChanges: boolean;
  isPriceOwner: boolean;
}

export function productsAccess(user: User | null | undefined, roles: WorkflowRoleAssignments): ProductsAccess {
  const admin = isAdmin(user ?? null);
  const has = (r: WorkflowRoleKey) => user != null && userHasWorkflowRole(roles, user.id, r);
  const priceOwner = isCataloguePriceOwner(user, roles);
  // Sales are blocked from Products entirely; they use the sales dashboard's
  // Check-availability tool for name / quantity / selling price.
  const isSales = user?.role === "SALES";
  // The Payment Approver was missing here too — `requireProductManager` names
  // them on the server, and they already had + Add product, so they could add a
  // product and then not edit it.
  const canManage = !isSales && (admin || has("purchaser") || has("payment_approver"));
  return {
    canView: !isSales && (canManage || PRODUCT_VIEW_ROLES.some(has) || admin),
    canManage,
    canAddOrRemoveProducts: priceOwner,
    canEditPrices: canEditPrices(user, roles),
    canTransferFiles: priceOwner,
    showPrices: canViewPrices(user, roles),
    // Supplier names are restricted like the purchasing money amounts.
    showSuppliers: canViewSupplier(user, roles),
    canDecideChanges: priceOwner,
    isPriceOwner: priceOwner,
  };
}
