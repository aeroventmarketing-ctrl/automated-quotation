import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { getSuppliers } from "@/lib/suppliers";
import { buildPurchaseOrderWorkbook, bankLinesFromText } from "@/lib/excel/purchase-order-xlsx";

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

  // Supplier bank details for the footer (matched by company name).
  const suppliers = await getSuppliers().catch(() => []);
  const match = suppliers.find((s) => s.company.trim().toLowerCase() === po.supplier.company.trim().toLowerCase());
  const bank = bankLinesFromText(match?.paymentDetails ?? "");

  const templatePath = path.join(process.cwd(), "public", "templates", "po-2307-template.xlsx");
  const template = await fs.readFile(templatePath);
  const buffer = await buildPurchaseOrderWorkbook(template, po, bank);

  const filename = `${(po.poNumber || "Purchase-Order").replace(/[^A-Za-z0-9._-]/g, "_")}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
