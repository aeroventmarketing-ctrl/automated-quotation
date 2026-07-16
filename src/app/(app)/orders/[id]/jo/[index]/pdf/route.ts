import { promises as fs } from "fs";
import path from "path";
import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { formatJoNumber } from "@/lib/job-order";
import { computeJobOrder } from "@/lib/job-order-compute";
import { JobOrderPdf } from "@/lib/pdf/job-order-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET a Fans & Blowers Job Order as a PDF (Centrifugal Blower production copy). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const quote = await prisma.quotation.findUnique({ where: { id }, select: { classification: true } });
  if (!quote) return new Response("Not found", { status: 404 });
  const wf = readOrderWorkflow(quote.classification);

  const i = Number(index);
  const jo = wf.fansJobOrders[i];
  if (!jo) return new Response("Job order not found", { status: 404 });

  const year = wf.joBaseYear ?? new Date().getFullYear();
  const joNumber = wf.joBaseNo != null ? formatJoNumber(wf.joBaseNo, year, i, wf.fansJobOrders.length) : "";
  const computed = computeJobOrder(jo);

  // Discharge/rotation reference chart (from the template) as a data URL.
  let referenceImage: string | null = null;
  try {
    const buf = await fs.readFile(path.join(process.cwd(), "public", "jo-discharge-reference.jpg"));
    referenceImage = `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch { /* optional */ }

  const element = React.createElement(JobOrderPdf, { data: { joNumber, jo, computed, referenceImage } }) as React.ReactElement<DocumentProps>;
  const pdf = await renderToBuffer(element);

  const filename = `${(joNumber || "Job-Order").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
