import { getCurrentUser } from "@/lib/auth";
import { buildProductListCsv } from "@/lib/product-list-export";

export const dynamic = "force-dynamic";

/**
 * Full product-list worksheet (CSV): every entry in the quotation product
 * taxonomy — the exact Category → Brand/Group → Type dropdowns — flattened to one
 * row per sellable item, with Induction Motors expanded to model level and their
 * known net selling prices. The `sku` / `supplier_price` columns are blank for
 * the owner to fill; use it as the master worksheet for assigning SKUs and to
 * seed the Catalogue. Non-sensitive (no cost); Sales are excluded like the other
 * admin exports.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role === "SALES") {
    return new Response("Unauthorized", { status: 401 });
  }
  const csv = buildProductListCsv();
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": 'attachment; filename="product-list.csv"',
    },
  });
}
