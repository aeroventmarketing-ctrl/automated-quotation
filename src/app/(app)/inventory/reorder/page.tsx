import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { coerceReorderMap, suggestReorderQty } from "@/lib/reorder";
import { ReorderList, type NeedsRow, type OnOrderRow } from "./reorder-list";

export const dynamic = "force-dynamic";

export default async function ReorderPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const admin = isAdmin(viewer);
  const has = (role: "purchaser" | "warehouse" | "plant_manager") =>
    viewer != null && userHasWorkflowRole(assignments, viewer.id, role);
  const canView = admin || has("purchaser") || has("warehouse") || has("plant_manager");
  const canAct = canView;

  if (!canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Reorder</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to reordering. Ask an admin for the Purchaser role.</p>
      </div>
    );
  }

  let items: { id: string; name: string; unit: string; category: string | null; quantity: number; reorderLevel: number }[] = [];
  let map: ReturnType<typeof coerceReorderMap> = {};
  let tableMissing = false;
  try {
    const [rows, setting] = await Promise.all([
      prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.appSetting.findUnique({ where: { key: "reorder_orders" } }),
    ]);
    items = rows.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      category: i.category,
      quantity: Number(i.quantity),
      reorderLevel: Number(i.reorderLevel),
    }));
    map = coerceReorderMap(setting?.value);
  } catch {
    tableMissing = true;
  }

  const onOrder: OnOrderRow[] = [];
  const needs: NeedsRow[] = [];
  for (const i of items) {
    const entry = map[i.id];
    const status: "out" | "low" | "ok" =
      i.quantity <= 0 ? "out" : i.reorderLevel > 0 && i.quantity <= i.reorderLevel ? "low" : "ok";
    if (entry) {
      onOrder.push({
        id: i.id,
        name: i.name,
        unit: i.unit,
        onHand: i.quantity,
        orderedQty: entry.qty,
        byName: entry.byName,
        at: entry.at ? new Date(entry.at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "",
        note: entry.note ?? "",
      });
    } else if (status !== "ok") {
      needs.push({
        id: i.id,
        name: i.name,
        unit: i.unit,
        category: i.category,
        onHand: i.quantity,
        reorderLevel: i.reorderLevel,
        status,
        suggestQty: suggestReorderQty(i.quantity, i.reorderLevel),
      });
    }
  }
  // Out-of-stock first, then low; alphabetical within each.
  needs.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "out" ? -1 : 1));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Reorder</h1>
          <Link href="/inventory" className="text-sm text-primary hover:underline">← Inventory</Link>
        </div>
        <p className="text-sm text-muted-foreground">Items at or below their reorder level. Place a reorder, then receive the goods when they arrive.</p>
      </div>

      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          The inventory tables aren&apos;t set up yet. Run migration 0008 in Supabase, then add stock items under Inventory.
        </CardContent></Card>
      ) : (
        <ReorderList needs={needs} onOrder={onOrder} canAct={canAct} />
      )}
    </div>
  );
}
