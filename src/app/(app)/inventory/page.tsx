import Link from "next/link";
import { ShoppingCart } from "lucide-react";
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
  const stockValue = Math.round(items.reduce((a, i) => a + i.value, 0) * 100) / 100;
  const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const tiles = [
    { label: "Items", value: String(items.length) },
    { label: "Low stock", value: String(lowCount) },
    { label: "Out of stock", value: String(outCount) },
    { label: "Stock value", value: peso(stockValue) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-muted-foreground">Warehouse stock on hand, with receive / issue / adjust and a movement ledger.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory/labels" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
            Labels
          </Link>
          <Link href="/inventory/reorder" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
            <ShoppingCart className="h-4 w-4" />
            Reorder{lowCount + outCount > 0 ? ` (${lowCount + outCount})` : ""}
          </Link>
        </div>
      </div>

      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          The inventory tables aren&apos;t set up yet. Run migration 0008 in Supabase, then add stock items here.
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
  const [list, reservations] = await Promise.all([
    prisma.stockItem.findMany({ where: { active: true }, orderBy: [{ name: "asc" }] }),
    prisma.stockReservation.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const byItem = new Map<string, { id: string; qty: number; forRef: string; note: string | null; byName: string }[]>();
  for (const r of reservations) {
    const arr = byItem.get(r.stockItemId) ?? [];
    arr.push({ id: r.id, qty: Number(r.qty), forRef: r.forRef, note: r.note, byName: r.byName });
    byItem.set(r.stockItemId, arr);
  }
  return list.map((i) => {
    const quantity = Number(i.quantity);
    const reorderLevel = Number(i.reorderLevel);
    const unitCost = Number(i.unitCost);
    const resv = byItem.get(i.id) ?? [];
    const reserved = Math.round(resv.reduce((a, r) => a + r.qty, 0) * 1000) / 1000;
    const available = Math.round((quantity - reserved) * 1000) / 1000;
    const status: "ok" | "low" | "out" =
      quantity <= 0 ? "out" : reorderLevel > 0 && quantity <= reorderLevel ? "low" : "ok";
    return {
      id: i.id,
      sku: i.sku,
      name: i.name,
      unit: i.unit,
      category: i.category,
      location: i.location,
      quantity,
      reorderLevel,
      unitCost,
      value: Math.round(quantity * unitCost * 100) / 100,
      reserved,
      available,
      reservations: resv,
      status,
    };
  });
}
