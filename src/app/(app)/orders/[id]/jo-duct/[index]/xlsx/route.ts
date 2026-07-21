import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { formatDuctJoNumber } from "@/lib/duct-job-order";
import { buildDuctJobOrderWorkbook } from "@/lib/excel/duct-job-order-xlsx";

export const dynamic = "force-dynamic";

/** GET a Duct Job Order as a filled .xlsx. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const quote = await prisma.quotation.findUnique({ where: { id }, select: { classification: true } });
  if (!quote) return new Response("Not found", { status: 404 });
  const wf = readOrderWorkflow(quote.classification);

  const i = Number(index);
  const jo = wf.ductJobOrders[i];
  if (!jo) return new Response("Job order not found", { status: 404 });

  // Compute the JO number (a/b/c suffix only when the order has more than one).
  const year = wf.ductJoBaseYear ?? new Date().getFullYear();
  const joNumber = wf.ductJoBaseNo != null ? formatDuctJoNumber(wf.ductJoBaseNo, year, i, wf.ductJobOrders.length) : "";

  const buffer = await buildDuctJobOrderWorkbook({ ...jo, joNumber });

  const filename = `${(joNumber || "Duct-Job-Order").replace(/[^A-Za-z0-9._-]/g, "_")}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
