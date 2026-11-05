import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { renderPurchaseOrderHtml } from "@/lib/po-html";
import { rushStampForPurchase } from "@/lib/rush-order-data";
import { getPurchaserSignatory } from "@/lib/purchaser-signatory";

export const dynamic = "force-dynamic";

/** GET the Purchase Order as an inline HTML preview (view without downloading). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; prId: string }> }) {
  const { id, prId } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: prId } });
  if (!pr || pr.quotationId !== id) return new Response("Not found", { status: 404 });
  const po = coercePurchaseOrder(pr.po);
  if (!po) return new Response("No purchase order issued yet", { status: 404 });

  const purchaser = await getPurchaserSignatory().catch(() => null);
  // A RUSH order's PO says so (lib/rush-order).
  const rushStamp = await rushStampForPurchase(pr);
  return new Response(renderPurchaseOrderHtml(po, { name: purchaser?.name, designation: purchaser?.designation, signature: purchaser?.signature }, { rushStamp }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
