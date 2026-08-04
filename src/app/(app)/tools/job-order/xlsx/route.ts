import { promises as fs } from "fs";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { coerceFansJobOrder, joTypeDef, joTypeLabel } from "@/lib/job-order";
import { buildFansJobOrderWorkbook } from "@/lib/excel/job-order-xlsx";
import { joXlsxResponse } from "@/lib/job-order-response";

export const dynamic = "force-dynamic";

/**
 * Standalone Fans & Blowers Job Order print for the HVAC Tools "Job Order" tab —
 * the same workbook the order panel prints, but built from JO data passed in the
 * `data` query (base64-encoded JSON) instead of read from an order's workflow.
 * No order/quotation is involved; the tool holds the JO client-side. `?view=1`
 * returns an HTML preview.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const data = new URL(req.url).searchParams.get("data") ?? "";
  if (!data) return new Response("Missing job order data", { status: 400 });

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(data, "base64").toString("utf-8"));
  } catch {
    return new Response("Invalid job order data", { status: 400 });
  }
  const jo = coerceFansJobOrder(raw);
  if (!jo) return new Response("Invalid job order data", { status: 400 });

  const def = joTypeDef(jo.type);
  if (!def?.template) {
    return new Response(`The "${joTypeLabel(jo.type)}" job order template is not set up yet.`, { status: 409 });
  }
  const dir = path.join(process.cwd(), "public", "templates");
  const template = await fs.readFile(path.join(dir, def.template));
  const buffer = await buildFansJobOrderWorkbook(template, jo);

  const filename = `${(jo.joNumber || "Job-Order").replace(/[^A-Za-z0-9._-]/g, "_")}.xlsx`;
  return joXlsxResponse(req, buffer, filename);
}
