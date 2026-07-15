import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSuppliers } from "@/lib/suppliers";
import { SuppliersManager } from "./suppliers-manager";
import { saveSupplierAction, deleteSupplierAction } from "./actions";

export const dynamic = "force-dynamic";

/** Admin page to maintain the supplier directory used by supplier Purchase Orders. */
export default async function SuppliersPage() {
  const viewer = await getCurrentUser();
  if (!isAdmin(viewer)) redirect("/dashboard");

  const suppliers = await getSuppliers();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Suppliers</h1>
        <p className="text-sm text-muted-foreground">
          The supplier directory used when issuing a supplier Purchase Order. Suppliers are also
          remembered automatically each time a PO is issued.
        </p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Supplier list ({suppliers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <SuppliersManager suppliers={suppliers} onSave={saveSupplierAction} onDelete={deleteSupplierAction} />
        </CardContent>
      </Card>
    </div>
  );
}
