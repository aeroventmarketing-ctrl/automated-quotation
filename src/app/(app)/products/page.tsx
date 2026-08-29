import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { canViewPrices, canViewSupplier, canEditPrices } from "@/lib/price-visibility";
import { isCataloguePriceOwner } from "@/lib/price-authority";
import { Card, CardContent } from "@/components/ui/card";
import { getProducts, type ProductRow } from "@/lib/product-catalog";
import { getSuppliers } from "@/lib/suppliers";
import { getOfficeResaleProductIds } from "@/lib/office-resale";
import {
  PRODUCT_CHANGE_LABEL,
  productChangeDiff,
  productChangeTouchesPrice,
  type ProductChangePayload,
  type ProductChangeView,
} from "@/lib/product-change";
import { ProductManager } from "./product-manager";
import { PendingProductChanges } from "./pending-product-changes";

export const dynamic = "force-dynamic";

const VIEW_ROLES: WorkflowRoleKey[] = ["purchaser", "warehouse", "plant_manager", "payment_approver", "accounting", "logistics", "technical_head", "prod_head_fans", "prod_head_duct", "prod_head_accessories", "prod_head_motor"];

export default async function ProductsPage() {
  const [viewer, assignments, suppliers] = await Promise.all([getCurrentUser(), getWorkflowRoles(), getSuppliers().catch(() => [])]);
  const admin = isAdmin(viewer);
  const has = (r: WorkflowRoleKey) => viewer != null && userHasWorkflowRole(assignments, viewer.id, r);
  // The Purchaser, the Payment Approver or an admin may add/edit/remove products.
  // Other roles (Warehouse, Plant Manager, etc.) can view the list but not change
  // it. Sales are blocked from the Products page entirely (they use the sales
  // dashboard's Check-availability tool for name / quantity / selling price).
  //
  // The Payment Approver was missing here, the same omission that shut them out
  // of Inventory: `requireProductManager` names them on the server, and they
  // already had the + Add product button (it follows the price owner), so they
  // could add a product and then not edit it.
  const isSales = viewer?.role === "SALES";
  const canManage = !isSales && (admin || has("purchaser") || has("payment_approver"));
  const canView = !isSales && (canManage || VIEW_ROLES.some(has));
  // Supplier prices are commercial data — Purchaser, Engineers, Accounting and
  // admins only. Other viewers (Warehouse, Plant Manager, Logistics, …) see the
  // products and their suppliers but not the prices.
  const showPrices = canViewPrices(viewer, assignments);
  // Everyone who can open this page keeps seeing prices; only the Admin /
  // Payment Approver may change one (see lib/price-authority, which enforces the
  // same rule on the server).
  const editPrices = canEditPrices(viewer, assignments);
  // Supplier names are restricted the same way as on the purchasing surfaces —
  // Purchaser, Accounting, Payment Approver, Engineers and admins only. The Plant
  // Manager and other monitoring roles see the products but not their suppliers.
  const showSuppliers = canViewSupplier(viewer, assignments);

  if (!canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to the product list.</p>
      </div>
    );
  }

  let products: ProductRow[] = [];
  let tableMissing = false;
  try {
    products = await getProducts();
  } catch {
    tableMissing = true;
  }
  const resaleIds = await getOfficeResaleProductIds().catch(() => []);

  // Product adds / saves / removals parked for the price owner. Everyone who can
  // manage products sees the queue — the proposer has to know their save is
  // waiting, not lost — but only the Admin / Payment Approver may decide one.
  const priceOwner = isCataloguePriceOwner(viewer, assignments);
  let pendingChanges: ProductChangeView[] = [];
  if (canManage || priceOwner) {
    try {
      const rows = await prisma.productChange.findMany({ where: { status: "PENDING" }, orderBy: { proposedAt: "desc" }, take: 50 });
      pendingChanges = rows.map((c) => {
        const after = c.payload as unknown as ProductChangePayload;
        const before = (c.before as unknown as ProductChangePayload | null) ?? null;
        return {
          id: c.id,
          productId: c.productId,
          productName: c.productName,
          kind: c.kind,
          kindLabel: PRODUCT_CHANGE_LABEL[c.kind],
          status: c.status,
          summary: c.summary,
          diff: c.kind === "UPDATE" ? productChangeDiff(before, after) : [],
          touchesPrice: c.kind !== "DELETE" && productChangeTouchesPrice(before, after),
          proposedByName: c.proposedByName,
          proposedAt: c.proposedAt.toISOString(),
          canDecide: priceOwner,
          mine: viewer != null && c.proposedById === viewer.id,
        };
      });
    } catch {
      // ProductChange table not migrated yet — nothing parked.
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-muted-foreground">
            Purchasable items connected to their suppliers. Requests made against a product carry its supplier, so the purchaser can combine same-supplier orders. Each product has a SKU with barcode &amp; QR for easy encoding.
          </p>
        </div>
        {/* Catalogue spreadsheets are the price owner's — a download carries the
            whole price list out, an upload writes it back (lib/price-authority). */}
        {priceOwner && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <a
              href="/api/products/full-list"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
              title="Download the complete product list — every Category → Brand/Group → Type from the quotation dropdowns, with Induction Motors expanded to model level and their selling prices. Fill the sku &amp; supplier_price columns; use it as the master SKU worksheet."
            >
              Export full product list (CSV)
            </a>
            <a
              href="/api/catalogue/export"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
              title="Download the fan Catalogue's Item Codes + standard names (CSV) — the worksheet for aligning Products &amp; Inventory. Fill the sku column and re-import on the Inventory screen."
            >
              Export catalogue codes (CSV)
            </a>
          </div>
        )}
      </div>

      <PendingProductChanges changes={pendingChanges} />

      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          The product table isn&apos;t set up yet. Run migration 0014 in Supabase, then add products here.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {/* `canManage` still includes the Purchaser — they edit rows, and
                their save is parked for approval. `canAddOrRemoveProducts` is the
                narrower gate on the two list-shaping buttons the owner had hidden
                from them: + Add product and Remove no-supplier items. */}
            <ProductManager products={products} suppliers={suppliers} canManage={canManage} canEditPrices={editPrices} canTransferFiles={priceOwner} canAddOrRemoveProducts={priceOwner} admin={admin} showPrices={showPrices} showSuppliers={showSuppliers} resaleIds={resaleIds} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
