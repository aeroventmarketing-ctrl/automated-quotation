import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { canViewPrices, canEditPrices } from "@/lib/price-visibility";
import { isCataloguePriceOwner } from "@/lib/price-authority";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStockLocations } from "@/lib/stock-locations";
import { InventoryManager } from "./inventory-manager";
import { DuplicateItemsPanel } from "./duplicate-items-panel";
import { STOCK_ACTION_LABEL, needsPriceOwner, nextStockActionSlot, type StockActionView } from "@/lib/stock-action";
import { StockTransfers } from "./stock-transfers";
import { isProductionHead, isPurchaserRole, coerceStockDoc, isOfficeTransfer, nextOfficeTransferApprover, type StockTransferView } from "@/lib/stock-transfer";
import { getApproverDirectory } from "@/lib/approver-directory";
import { ArrowLeftRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const [viewer, assignments, locations] = await Promise.all([getCurrentUser(), getWorkflowRoles(), getStockLocations()]);
  const admin = isAdmin(viewer);
  const has = (role: "warehouse" | "plant_manager" | "purchaser" | "accounting" | "logistics" | "technical_head") =>
    viewer != null && userHasWorkflowRole(assignments, viewer.id, role);
  // Sales may VIEW inventory read-only — name / quantity / availability / selling
  // price — but never the unit cost, stock value, or any management action
  // (add / import / edit / adjust / transfer / labels / reorder). `canViewPrices`
  // already returns false for Sales, so the cost columns + value tile stay hidden.
  const isSales = viewer?.role === "SALES";
  const canManage = !isSales && (admin || has("warehouse") || has("plant_manager"));
  // Production heads (Duct / Accessories / Motor) and the Plant Manager may view
  // inventory (read-only) so they can check stock while running production.
  const isProdHeadViewer =
    viewer != null &&
    (["prod_head_fans", "prod_head_duct", "prod_head_accessories", "prod_head_motor"] as WorkflowRoleKey[]).some((r) =>
      userHasWorkflowRole(assignments, viewer.id, r),
    );
  // Accounting monitors inventory read-only, with the same characteristics as
  // the Plant Manager (no add/edit, no Labels/Reorder, no Out-of-stock tile).
  const canView = isSales || admin || canManage || has("purchaser") || has("accounting") || has("logistics") || has("technical_head") || isProdHeadViewer;
  // The Plant Manager monitors stock but does not edit items — hide the
  // add / import / per-row action buttons for them (a Warehouseman or admin
  // still manages). They keep read-only view + their stock-transfer rights.
  const canManageItems = !isSales && (admin || has("warehouse"));
  // Adding a stock item and merging duplicates — **admin only**.
  //
  // Owner's instruction: *"hide delete selected button, add stock item button,
  // merge duplicates button for purchaser role."* The Purchaser held both of
  // these; the Warehouseman never did, so dropping the Purchaser leaves the
  // admin alone with them. That is the intended effect, not an oversight: these
  // three change what the item list *is*, and the Warehouseman still proposes
  // per-row edits / adjustments through the handshake.
  const canCreateItems = admin;
  // Deleting stock items (multi-select bulk delete) — admin only, as is the full
  // "Clear all" wipe.
  const canDeleteItems = admin;
  // …and hide the Labels / Reorder header tools from the read-only monitors —
  // the Warehouseman, Plant Manager, Accounting, Logistics and the production
  // heads (their Labels / Reorder target pages deny them anyway). The Purchaser
  // still sees them; admins always do.
  const hidePlantMgrTools = isSales || (!admin && (has("plant_manager") || has("accounting") || has("warehouse") || has("logistics") || has("technical_head") || isProdHeadViewer));
  // Prices (unit cost, sell price, stock value) are commercial data — only the
  // Purchaser, Engineers, Accounting and admins see them. A warehouseman can
  // manage stock but the money columns stay hidden.
  const showPrices = canViewPrices(viewer, assignments);
  // The selling price is sales-only commercial data — hidden from the
  // Purchaser, Accounting and Warehouse. The Purchaser and Accounting still see
  // unit cost + stock value (needed for buying / valuation); the Warehouse sees
  // no money columns at all. Admins and Engineers always see everything.
  const showSellPrice = admin || !(has("purchaser") || has("warehouse") || has("accounting"));
  // The scan → jump / receive / issue tool is available to stock movers (the
  // Warehouse / Plant Manager / admin) and to the Purchaser (goods receipt on
  // deliveries). This does NOT grant the per-row manage actions.
  const canScan = canManageItems || has("purchaser");
  // The Purchaser/admin can fill in missing prices even without warehouse rights.
  const editPrices = canEditPrices(viewer, assignments);

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

  // Pending double-handshake stock actions (edit / adjust / reserve / transfer),
  // grouped per item, with per-viewer approval flags.
  const viewerWarehouse = admin || has("warehouse");
  const viewerPurchaser = admin || has("purchaser");
  // An Edit carries the unit cost / selling price, so it also waits on the
  // catalogue price owner (see lib/price-authority) — who is likewise the only
  // person who may take the stock list out as a file or put one back in.
  const viewerPriceOwner = isCataloguePriceOwner(viewer, assignments);
  const pendingByItem: Record<string, StockActionView[]> = {};
  try {
    const actions = await prisma.stockAction.findMany({ where: { status: "PENDING" }, orderBy: { proposedAt: "desc" } });
    for (const a of actions) {
      const proof = a.kind === "TRANSFER" ? coerceStockDoc((a.payload as { proof?: unknown } | null)?.proof) : null;
      // Whose signature is next — one function decides it for every surface.
      const nextSlot = nextStockActionSlot(a.kind, a.proposedRole, a.warehouseAt, a.purchaserAt, a.approverAt);
      (pendingByItem[a.stockItemId] ??= []).push({
        id: a.id, stockItemId: a.stockItemId, itemName: a.itemName, kind: a.kind,
        kindLabel: STOCK_ACTION_LABEL[a.kind], summary: a.summary, status: a.status, proof,
        proposedByName: a.proposedByName, proposedAt: a.proposedAt.toISOString(),
        warehouseByName: a.warehouseByName, purchaserByName: a.purchaserByName,
        approverByName: needsPriceOwner(a.kind) ? a.approverByName : null,
        nextSlot,
        canApproveNext:
          nextSlot === "warehouse" ? viewerWarehouse : nextSlot === "purchaser" ? viewerPurchaser : nextSlot === "approver" ? viewerPriceOwner : false,
        canReject: viewerWarehouse || viewerPurchaser || viewerPriceOwner,
      });
    }
  } catch {
    // StockAction table not migrated yet — no pending actions.
  }

  // Stock transfers — viewer capabilities per row.
  const viewerIsProdHead = admin || (viewer != null && isProductionHead(assignments, viewer.id));
  const viewerIsPurchaser = admin || has("purchaser");
  // Office-chain roles.
  const viewerIsPlant = admin || has("plant_manager");
  const viewerIsWarehouse = admin || has("warehouse");
  const viewerIsLogistics = admin || has("logistics");
  const viewerIsSales = admin || viewer?.role === "SALES";
  // Who must act next on each office transfer — designation + assigned names —
  // for the flashing "awaiting approval" badge (the office-receipt step is Sales
  // OR the Purchaser, so pull both sets of names).
  const [approverDir, salesUsers] = await Promise.all([
    getApproverDirectory().catch(() => null),
    prisma.user.findMany({ where: { role: "SALES" }, select: { name: true }, orderBy: { name: "asc" } }).catch(() => [] as { name: string }[]),
  ]);
  const salesNames = salesUsers.map((u) => u.name).filter(Boolean);

  let transfers: StockTransferView[] = [];
  let transfersMissing = false;
  try {
    const rows = await prisma.stockTransfer.findMany({ orderBy: { initiatedAt: "desc" }, take: 100 });
    transfers = rows.map((t) => ({
      id: t.id,
      itemName: t.itemName,
      unit: t.unit,
      qty: Number(t.qty),
      fromLocation: t.fromLocation,
      toLocation: t.toLocation,
      status: t.status,
      note: t.note,
      proof: coerceStockDoc(t.proof),
      initiatedByName: t.initiatedByName,
      initiatedAt: t.initiatedAt.toISOString(),
      prodHeadByName: t.prodHeadByName,
      prodHeadAt: t.prodHeadAt?.toISOString() ?? null,
      purchaserByName: t.purchaserByName,
      purchaserAt: t.purchaserAt?.toISOString() ?? null,
      receivedAt: t.receivedAt?.toISOString() ?? null,
      cancelledByName: t.cancelledByName,
      cancelledAt: t.cancelledAt?.toISOString() ?? null,
      isOffice: isOfficeTransfer(t.toLocation),
      approvedByName: t.approvedByName,
      approvedAt: t.approvedAt?.toISOString() ?? null,
      releasedByName: t.releasedByName,
      releasedAt: t.releasedAt?.toISOString() ?? null,
      deliveredByName: t.deliveredByName,
      deliveredAt: t.deliveredAt?.toISOString() ?? null,
      receivedByName: t.receivedByName,
      canConfirmProdHead: viewerIsProdHead,
      canConfirmPurchaser: viewerIsPurchaser,
      canApprove: viewerIsPlant,
      canRelease: viewerIsWarehouse,
      canDeliver: viewerIsLogistics,
      canReceive: viewerIsSales || viewerIsPurchaser,
      canUpload: canManage || viewerIsProdHead || viewerIsPurchaser || viewerIsLogistics,
      canCancel: canManage,
      nextApprover:
        approverDir && isOfficeTransfer(t.toLocation)
          ? nextOfficeTransferApprover(t.status, approverDir, salesNames)
          : null,
    }));
  } catch {
    transfersMissing = true;
  }

  const lowCount = items.filter((i) => i.status === "low").length;
  const outCount = items.filter((i) => i.status === "out").length;
  // Admin duplicate-items tool: group active items whose names match once
  // punctuation/spacing is ignored (e.g. "G.I BOLT 5/16 X 1" ≡ "GI BOLT 5/16 X 1").
  const dupeGroups = admin
    ? (() => {
        const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const by = new Map<string, typeof items>();
        for (const it of items) {
          // Key on name AND location: the same item stocked in two locations
          // (multi-location) is not a duplicate — only same-name, same-location
          // rows are flagged for merging.
          const k = canon(it.name);
          if (!k) continue;
          const key = `${k}||${canon(it.location ?? "")}`;
          const arr = by.get(key) ?? [];
          arr.push(it);
          by.set(key, arr);
        }
        return [...by.values()]
          .filter((g) => g.length > 1)
          .map((g) => g.map((it) => ({ id: it.id, name: it.name, sku: it.sku, qty: it.quantity, unit: it.unit, sellPrice: it.sellPrice, unitCost: it.unitCost })));
      })()
    : [];
  const stockValue = Math.round(items.reduce((a, i) => a + i.value, 0) * 100) / 100;
  const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const tiles: { label: string; value: string; href?: string }[] = [
    { label: "Items", value: String(items.length) },
    // Low / out tiles drill into the item list, filtered to that status.
    { label: "Low stock", value: String(lowCount), href: lowCount > 0 ? "/inventory?status=low#inv-items" : undefined },
    { label: "Out of stock", value: String(outCount), href: outCount > 0 ? "/inventory?status=out#inv-items" : undefined },
    // Stock value is a money figure — only shown to price-authorized viewers.
    ...(showPrices ? [{ label: "Stock value", value: peso(stockValue) }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-muted-foreground">{isSales ? "Stock on hand, availability and selling price — read-only." : "Warehouse stock on hand, with receive / issue / adjust and a movement ledger."}</p>
        </div>
        {!hidePlantMgrTools && (
          <div className="flex gap-2">
            <Link href="/inventory/labels" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
              Labels
            </Link>
            <Link href="/inventory/reorder" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
              <ShoppingCart className="h-4 w-4" />
              Reorder{lowCount + outCount > 0 ? ` (${lowCount + outCount})` : ""}
            </Link>
          </div>
        )}
      </div>

      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          The inventory tables aren&apos;t set up yet. Run migration 0008 in Supabase, then add stock items here.
        </CardContent></Card>
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-3 ${showPrices ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            {tiles.map((t) => {
              const card = (
                <Card className={t.href ? "h-full transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md" : ""}>
                  <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">{t.label}</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold tabular-nums">{t.value}</div></CardContent>
                </Card>
              );
              return t.href ? <Link key={t.label} href={t.href} className="block">{card}</Link> : <div key={t.label}>{card}</div>;
            })}
          </div>
          {admin && dupeGroups.length > 0 && <DuplicateItemsPanel groups={dupeGroups} />}

          <Card id="inv-items" className="scroll-mt-20">
            <CardContent className="pt-6">
              <InventoryManager items={items} canManage={canManageItems} admin={admin} canDelete={canDeleteItems} canScan={canScan} canCreate={canCreateItems} canTransferFiles={viewerPriceOwner} locations={locations} showPrices={showPrices} showSellPrice={showSellPrice} canEditPrices={editPrices} pendingByItem={pendingByItem} />
            </CardContent>
          </Card>

          {!isSales && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><ArrowLeftRight className="h-4 w-4 text-muted-foreground" /> Stock transfers</CardTitle>
            </CardHeader>
            <CardContent>
              <StockTransfers
                transfers={transfers}
                missing={transfersMissing}
                admin={admin}
                canRequest={viewerIsPurchaser}
                stockOptions={items
                  .filter((i) => (i.location ?? "").trim().toLowerCase() !== "office")
                  .map((i) => ({ id: i.id, name: i.name, location: i.location ?? "", unit: i.unit, available: i.available }))}
              />
            </CardContent>
          </Card>
          )}
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
  const byItem = new Map<string, { id: string; qty: number; forRef: string; note: string | null; byName: string; createdAt: string; validUntil: string | null }[]>();
  for (const r of reservations) {
    const arr = byItem.get(r.stockItemId) ?? [];
    arr.push({ id: r.id, qty: Number(r.qty), forRef: r.forRef, note: r.note, byName: r.byName, createdAt: r.createdAt.toISOString(), validUntil: r.validUntil ? r.validUntil.toISOString() : null });
    byItem.set(r.stockItemId, arr);
  }
  return list.map((i) => {
    const quantity = Number(i.quantity);
    const reorderLevel = Number(i.reorderLevel);
    const unitCost = Number(i.unitCost);
    const sellPrice = Number(i.sellPrice);
    const resv = byItem.get(i.id) ?? [];
    const reserved = Math.round(resv.reduce((a, r) => a + r.qty, 0) * 1000) / 1000;
    const available = Math.round((quantity - reserved) * 1000) / 1000;
    const status: "ok" | "low" | "out" =
      quantity <= 0 ? "out" : reorderLevel > 0 && quantity <= reorderLevel ? "low" : "ok";
    return {
      id: i.id,
      sku: i.sku,
      barcode: i.barcode,
      name: i.name,
      unit: i.unit,
      category: i.category,
      location: i.location,
      quantity,
      reorderLevel,
      unitCost,
      sellPrice,
      value: Math.round(quantity * unitCost * 100) / 100,
      reserved,
      available,
      reservations: resv,
      status,
    };
  });
}
