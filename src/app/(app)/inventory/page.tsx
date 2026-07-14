import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InventoryManager } from "./inventory-manager";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const admin = isAdmin(viewer);
  const has = (role: "warehouse" | "plant_manager" | "purchaser") =>
    viewer != null && userHasWorkflowRole(assignments, viewer.id, role);
  const canManage = admin || has("warehouse") || has("plant_manager");
  const canView = canManage || has("purchaser");

  if (!canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to inventory. Ask an admin for the Warehouse role.</p>
      </div>
    );
  }

  let items: Awaited<ReturnType<typeof loadItems>> = [];
  let tableMissing = false;
  try {
    items = await loadItems();
  } catch {
    tableMissing = true;
  }

  const lowCount = items.filter((i) => i.status === "low").length;
  const outCount = items.filter((i) => i.status === "out").length;

  const tiles = [
    { label: "Items", value: String(items.length) },
    { label: "Low stock", value: String(lowCount) },
    { label: "Out of stock", value: String(outCount) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inventory</h1>
        <p className="text-sm text-muted-foreground">Warehouse stock on hand, with receive / issue / adjust and a movement ledger.</p>
      </div>

      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          The inventory tables aren&apos;t set up yet. Run migration 0008 in Supabase, then add stock items here.
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {tiles.map((t) => (
              <Card key={t.label}>
                <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">{t.label}</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold tabular-nums">{t.value}</div></CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="pt-6">
              <InventoryManager items={items} canManage={canManage} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

async function loadItems() {
  const list = await prisma.stockItem.findMany({
    where: { active: true },
    orderBy: [{ name: "asc" }],
  });
  return list.map((i) => {
    const quantity = Number(i.quantity);
    const reorderLevel = Number(i.reorderLevel);
    const status: "ok" | "low" | "out" =
      quantity <= 0 ? "out" : reorderLevel > 0 && quantity <= reorderLevel ? "low" : "ok";
    return { id: i.id, name: i.name, unit: i.unit, category: i.category, quantity, reorderLevel, status };
  });
}
