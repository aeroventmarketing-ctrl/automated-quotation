import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { getProducts } from "@/lib/product-catalog";
import { LabelSheet, type LabelItem } from "../../inventory/labels/label-sheet";

export const dynamic = "force-dynamic";

export default async function ProductLabelsPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const [viewer, assignments, sp] = await Promise.all([getCurrentUser(), getWorkflowRoles(), searchParams]);
  const admin = isAdmin(viewer);
  const canView =
    admin ||
    (viewer != null && (["warehouse", "plant_manager", "purchaser"] as const).some((r) => userHasWorkflowRole(assignments, viewer.id, r)));
  if (!canView) {
    return <div className="space-y-2"><h1 className="text-2xl font-bold">Product labels</h1><p className="text-sm text-muted-foreground">No access.</p></div>;
  }

  let products: Awaited<ReturnType<typeof getProducts>> = [];
  try { products = await getProducts(); } catch { products = []; }

  const items: LabelItem[] = products.map((p) => ({
    id: p.id,
    code: p.sku ?? p.id,
    sku: p.sku,
    name: p.name,
    location: null,
    unit: p.unit,
  }));
  const initialSelected = (sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Product labels</h1>
        <p className="text-sm text-muted-foreground">No products yet.</p>
      </div>
    );
  }
  return <LabelSheet items={items} initialSelected={initialSelected} />;
}
