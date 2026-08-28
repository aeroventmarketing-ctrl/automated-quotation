import { canTransferCatalogueFiles, CATALOGUE_FILE_MESSAGE } from "@/lib/price-authority";
import { buildProductListCsv } from "@/lib/product-list-export";

export const dynamic = "force-dynamic";

/**
 * Full product-list worksheet (CSV): every entry in the quotation product
 * taxonomy — the exact Category → Brand/Group → Type dropdowns — flattened to one
 * row per sellable item, with Induction Motors expanded to model level and their
 * known net selling prices. The `sku` / `supplier_price` columns are blank for
 * the owner to fill; use it as the master worksheet for assigning SKUs and to
 * seed the Catalogue.
 *
 * Admin / Payment Approver only. It carries selling prices and is the worksheet
 * the catalogue is seeded from, so it goes the way of every other catalogue
 * spreadsheet (see lib/price-authority). Checked here and not only on the page:
 * the button can be bypassed, the URL cannot.
 */
export async function GET() {
  if (!(await canTransferCatalogueFiles())) {
    return new Response(CATALOGUE_FILE_MESSAGE, { status: 403 });
  }
  const csv = buildProductListCsv();
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": 'attachment; filename="product-list.csv"',
    },
  });
}
