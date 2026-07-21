import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { getSuppliers } from "@/lib/suppliers";
import { getSignatory } from "@/lib/signatory";
import { getPurchaserSignatory } from "@/lib/purchaser-signatory";
import { buildPurchaseOrderWorkbook, restore2307Shapes, build2307Fields } from "@/lib/excel/purchase-order-xlsx";

export const dynamic = "force-dynamic";

/** GET the Purchase Order (+ 2307) as a filled .xlsx download. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; prId: string }> }) {
  const { id, prId } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: prId } });
  if (!pr || pr.quotationId !== id) return new Response("Not found", { status: 404 });
  const po = coercePurchaseOrder(pr.po);
  if (!po) return new Response("No purchase order issued yet", { status: 404 });

  // Payee TIN/ZIP from the matched supplier record (for the 2307).
  const suppliers = await getSuppliers().catch(() => []);
  const match = suppliers.find((s) => s.company.trim().toLowerCase() === po.supplier.company.trim().toLowerCase());

  // The payor signatory (name/designation/signature) printed on the 2307.
  const signatory = await getSignatory().catch(() => null);

  // The admin-configured purchaser signatory — name + signature on the PO's
  // "Account Purchaser" block.
  const purchaser = await getPurchaserSignatory().catch(() => null);

  const dir = path.join(process.cwd(), "public", "templates");
  const template = await fs.readFile(path.join(dir, "po-2307-template.xlsx"));
  let buffer = await buildPurchaseOrderWorkbook(template, po, {
    name: signatory?.name,
    designation: signatory?.designation,
  }, {
    name: purchaser?.name,
    designation: purchaser?.designation,
    signature: purchaser?.signature,
  });
  // Restore the 2307 form's shapes (white input boxes) that exceljs strips, and
  // paint the Part I/II values as overlay text boxes on top of those boxes.
  // Payee name/address come from the PO; payee TIN/ZIP from the Supplier's List.
  const fields = build2307Fields(po, {
    name: match?.company,
    address: match?.address,
    tin: match?.tin,
    zip: match?.zip,
  });
  const source = await fs.readFile(path.join(dir, "2307-source.xlsx")).catch(() => null);
  if (source) buffer = await restore2307Shapes(buffer, source, fields, signatory?.signature);

  const filename = `${(po.poNumber || "Purchase-Order").replace(/[^A-Za-z0-9._-]/g, "_")}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
