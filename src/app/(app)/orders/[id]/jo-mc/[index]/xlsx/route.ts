import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { formatMotorControllerJoNumber } from "@/lib/motor-controller-job-order";
import { buildMotorControllerJobOrderWorkbook } from "@/lib/excel/motor-controller-job-order-xlsx";

export const dynamic = "force-dynamic";

/** GET a Motor Controller Job Order as a filled .xlsx. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const quote = await prisma.quotation.findUnique({ where: { id }, select: { classification: true } });
  if (!quote) return new Response("Not found", { status: 404 });
  const wf = readOrderWorkflow(quote.classification);

  const i = Number(index);
  const jo = wf.motorJobOrders[i];
  if (!jo) return new Response("Job order not found", { status: 404 });

  const year = wf.mcJoBaseYear ?? new Date().getFullYear();
  const joNumber = wf.mcJoBaseNo != null ? formatMotorControllerJoNumber(wf.mcJoBaseNo, year, i, wf.motorJobOrders.length) : "";

  const buffer = await buildMotorControllerJobOrderWorkbook({ ...jo, joNumber });

  const filename = `${(joNumber || "Motor-Controller-Job-Order").replace(/[^A-Za-z0-9._-]/g, "_")}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
