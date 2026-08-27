import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { formatJoNumber, joTypeDef, joTypeLabel } from "@/lib/job-order";
import { buildFansJobOrderWorkbook } from "@/lib/excel/job-order-xlsx";
import { joXlsxResponse } from "@/lib/job-order-response";

export const dynamic = "force-dynamic";

/** GET a Fans & Blowers Job Order as a filled .xlsx (or an HTML preview with ?view=1). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const quote = await prisma.quotation.findUnique({ where: { id }, select: { classification: true, quoteNumber: true } });
  if (!quote) return new Response("Not found", { status: 404 });
  const wf = readOrderWorkflow(quote.classification);

  const i = Number(index);
  const jo = wf.fansJobOrders[i];
  if (!jo) return new Response("Job order not found", { status: 404 });

  // Compute the JO number (a/b/c suffix only when the order has more than one).
  const year = wf.joBaseYear ?? new Date().getFullYear();
  const joNumber = wf.joBaseNo != null ? formatJoNumber(wf.joBaseNo, year, i, wf.fansJobOrders.length) : "";

  // Resolve the template for this JO's type. All six Fans & Blowers types share
  // one number series but each has its own template.
  const def = joTypeDef(jo.type);
  if (!def?.template) {
    return new Response(`The "${joTypeLabel(jo.type)}" job order template is not set up yet.`, { status: 409 });
  }
  // The Panel Fan and Power Roof templates ship password-protected, so their
  // downloads can't be corrected in Excel by anyone. Admins and the payment
  // approver get an unprotected copy; production still receives the locked form,
  // which is what keeps the printed sheet from being edited on the floor.
  const unlock =
    isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "payment_approver");

  const dir = path.join(process.cwd(), "public", "templates");
  const template = await fs.readFile(path.join(dir, def.template));
  const buffer = await buildFansJobOrderWorkbook(
    template,
    { ...jo, joNumber },
    { quotationNumber: quote.quoteNumber, unlock },
  );

  const filename = `${(joNumber || "Job-Order").replace(/[^A-Za-z0-9._-]/g, "_")}.xlsx`;
  return joXlsxResponse(req, buffer, filename);
}
