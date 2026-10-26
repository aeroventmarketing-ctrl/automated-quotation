/**
 * Inventory history → Excel, with the same filters and the same access as the
 * page (/inventory/history): stock movements for anyone who can open Inventory,
 * price movements only for those who see prices there.
 */
import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { inventoryAccess } from "@/lib/catalogue-access";
import { loadPriceHistory, loadStockHistory, type HistoryFilter } from "@/lib/inventory-history-data";
import { PRICE_SOURCE_LABEL } from "@/lib/price-history";
import type { MovementCategory } from "@/lib/stock-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CATS = ["in", "out", "transfer", "adjust", "reserve"];
const manila = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const a = inventoryAccess(user, await getWorkflowRoles());
  if (!a.canView) return NextResponse.json({ error: "No access to inventory" }, { status: 403 });
  const see = { cost: a.showPrices, sell: a.showPrices && a.showSellPrice };

  const sp = req.nextUrl.searchParams;
  const cat = sp.get("cat") ?? "";
  const filter: HistoryFilter = {
    itemId: sp.get("item") || undefined,
    q: sp.get("q") || undefined,
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    by: sp.get("by") || undefined,
    category: CATS.includes(cat) ? (cat as MovementCategory | "reserve") : "",
  };
  const tab = sp.get("tab") === "price" ? "price" : "stock";
  if (tab === "price" && !see.cost && !see.sell) return NextResponse.json({ error: "No access to prices" }, { status: 403 });

  const wb = new ExcelJS.Workbook();
  if (tab === "stock") {
    const { rows } = await loadStockHistory(filter, 5000);
    const ws = wb.addWorksheet("Stock movements");
    ws.addRow(["Date & time", "Item", "SKU", "Location", "Type", "Where it went / came from", "Qty", "Unit", "On hand after", "Reference", "By", "Note", "Ledger entry"]).font = { bold: true };
    for (const r of rows) {
      ws.addRow([
        manila(r.at), r.itemName, r.sku ?? "", r.location ?? "", r.label, r.where ?? "",
        r.qty, r.unit, r.balanceAfter ?? "", r.ref?.label ?? "", r.byName, r.note ?? "", r.reason ?? "",
      ]);
    }
    ws.columns.forEach((c, i) => (c.width = [18, 36, 12, 18, 26, 32, 10, 8, 12, 26, 18, 30, 36][i] ?? 16));
  } else {
    const { rows } = await loadPriceHistory(filter, see, 5000);
    const ws = wb.addWorksheet("Price movements");
    ws.addRow([
      "Date & time", "Item", "SKU",
      ...(see.cost ? ["Old unit cost", "New unit cost"] : []),
      ...(see.sell ? ["Old sell price", "New sell price"] : []),
      "How", "Changed by", "Approved by", "Note",
    ]).font = { bold: true };
    for (const r of rows) {
      ws.addRow([
        manila(r.at), r.itemName, r.sku ?? "",
        ...(see.cost ? [r.oldUnitCost ?? "", r.newUnitCost] : []),
        ...(see.sell ? [r.oldSellPrice ?? "", r.newSellPrice] : []),
        `${PRICE_SOURCE_LABEL[r.source]}${r.fromApprovals ? " (from approvals)" : ""}`, r.byName, r.approvedByName ?? "", r.note ?? "",
      ]);
    }
    ws.columns.forEach((c) => (c.width = 18));
  }
  for (const ws of wb.worksheets) ws.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  const d = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="inventory-${tab === "price" ? "price" : "stock"}-history-${d}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
