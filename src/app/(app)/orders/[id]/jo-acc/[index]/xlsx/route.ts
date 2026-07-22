import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { formatAccessoriesJoNumber } from "@/lib/accessories-job-order";
import { buildAccessoriesJobOrderWorkbook } from "@/lib/excel/accessories-job-order-xlsx";
import { joXlsxResponse } from "@/lib/job-order-response";

export const dynamic = "force-dynamic";

/** GET an Accessories Job Order as a filled .xlsx (or an HTML preview with ?view=1). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const quote = await prisma.quotation.findUnique({ where: { id }, select: { classification: true } });
  if (!quote) return new Response("Not found", { status: 404 });
  const wf = readOrderWorkflow(quote.classification);

  const i = Number(index);
  const jo = wf.accessoriesJobOrders[i];
  if (!jo) return new Response("Job order not found", { status: 404 });

  const year = wf.accJoBaseYear ?? new Date().getFullYear();
  const joNumber = wf.accJoBaseNo != null ? formatAccessoriesJoNumber(wf.accJoBaseNo, year, i, wf.accessoriesJobOrders.length) : "";

  const buffer = await buildAccessoriesJobOrderWorkbook({ ...jo, joNumber });

  const filename = `${(joNumber || "Accessories-Job-Order").replace(/[^A-Za-z0-9._-]/g, "_")}.xlsx`;
  return joXlsxResponse(req, buffer, filename);
}
