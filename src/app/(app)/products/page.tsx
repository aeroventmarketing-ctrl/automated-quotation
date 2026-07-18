import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { getProducts, type ProductRow } from "@/lib/product-catalog";
import { getSuppliers } from "@/lib/suppliers";
import { ProductManager } from "./product-manager";

export const dynamic = "force-dynamic";

const VIEW_ROLES: WorkflowRoleKey[] = ["purchaser", "warehouse", "plant_manager", "payment_approver", "accounting", "logistics"];

export default async function ProductsPage() {
  const [viewer, assignments, suppliers] = await Promise.all([getCurrentUser(), getWorkflowRoles(), getSuppliers().catch(() => [])]);
  const admin = isAdmin(viewer);
  const has = (r: WorkflowRoleKey) => viewer != null && userHasWorkflowRole(assignments, viewer.id, r);
  const canManage = admin || has("purchaser") || has("warehouse");
  const canView = canManage || VIEW_ROLES.some(has);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-sm text-muted-foreground">
          Purchasable items connected to their suppliers. Requests made against a product carry its supplier, so the purchaser can combine same-supplier orders. Each product has a SKU with barcode &amp; QR for easy encoding.
        </p>
      </div>

      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          The product table isn&apos;t set up yet. Run migration 0014 in Supabase, then add products here.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <ProductManager products={products} suppliers={suppliers} canManage={canManage} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
