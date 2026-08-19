import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Catalogue-code reference export (CSV). One row per active catalogue item with
 * its Item Code (model code) and a standard name — the worksheet for aligning
 * the Products and Inventory tabs to the fan Catalogue (see the Item Listing
 * Standard). Non-sensitive: codes + names only, never prices or suppliers.
 *
 * The columns mirror the Inventory import headers (`sku`, `name`, …) so this
 * file can be filled in and re-imported on the Inventory screen directly.
 */
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const user = await getCurrentUser();
  // Sales don't manage product codes (they use the availability lookup).
  if (!user || user.role === "SALES") {
    return new Response("Unauthorized", { status: 401 });
  }

  let items: {
    modelCode: string;
    name: string;
    family: string;
    sizeLabel: string | null;
    uom: string;
    storeListed: boolean;
  }[] = [];
  try {
    items = await prisma.catalogueItem.findMany({
      where: { active: true },
      orderBy: [{ family: "asc" }, { modelCode: "asc" }],
      select: { modelCode: true, name: true, family: true, sizeLabel: true, uom: true, storeListed: true },
    });
  } catch {
    return new Response("Catalogue is not available.", { status: 503 });
  }

  const header = ["sku", "name", "family", "size", "unit", "store_listed"];
  const lines = [header.join(",")];
  for (const it of items) {
    lines.push(
      [it.modelCode, it.name, it.family, it.sizeLabel ?? "", it.uom, it.storeListed ? "yes" : "no"]
        .map(csvCell)
        .join(","),
    );
  }
  // UTF-8 BOM so Excel opens accented names correctly.
  const csv = "﻿" + lines.join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": 'attachment; filename="catalogue-codes.csv"',
    },
  });
}
