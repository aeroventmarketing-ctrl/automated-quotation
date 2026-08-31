import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import Link from "next/link";
import { History } from "lucide-react";
import { inventoryAccess, productsAccess } from "@/lib/catalogue-access";
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

export default async function ProductsPage() {
  const [viewer, assignments, suppliers] = await Promise.all([getCurrentUser(), getWorkflowRoles(), getSuppliers().catch(() => [])]);
  // Every rule below lives in `lib/catalogue-access.ts` and is asserted for every
  // role at once in `catalogue-access.test.ts` — see that file for the policy.
  const a = productsAccess(viewer, assignments);
  const { canView, canManage, showPrices, showSuppliers } = a;
  // Read from the Inventory rules on purpose: it is ONE record covering both
  // screens, so one flag decides who may open it.
  const { canViewApprovalHistory } = inventoryAccess(viewer, assignments);
  const admin = isAdmin(viewer);
  const editPrices = a.canEditPrices;
  const priceOwner = a.isPriceOwner;

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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* A decided product change leaves the queue below; this is where the
              record of it lives. The same page as Inventory's — one record for
              both screens (lib/approval-history). */}
          {canViewApprovalHistory && (
            <Link href="/inventory/approvals" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted">
              <History className="h-4 w-4" /> Approval history
            </Link>
          )}
          {/* Catalogue spreadsheets are the price owner's — a download carries the
              whole price list out, an upload writes it back (lib/price-authority). */}
          {priceOwner && (<>
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
          </>)}
        </div>
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
