import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { canGenerateReceipts } from "@/lib/receipts-access";
import { fillReceiptsWorkbook } from "@/lib/excel/bir-receipts-xlsx";

export const runtime = "nodejs";
export const maxDuration = 30;

const line = z.object({
  qty: z.number().finite().nullable(),
  unit: z.string().max(20),
  description: z.string().max(200),
  unitPrice: z.number().finite().nullable(),
});
const body = z.object({
  date: z.string().max(40),
  companyName: z.string().max(200),
  tin: z.string().max(40),
  address: z.string().max(300),
  businessStyle: z.string().max(200),
  paymentOf: z.string().max(120),
  amountWords1: z.string().max(200),
  amountWords2: z.string().max(200),
  vatRatePct: z.number().finite().min(0).max(100),
  ewtRatePct: z.number().finite().min(0).max(100),
  vatExemptSales: z.number().finite(),
  zeroRatedSales: z.number().finite(),
  lines: z.array(line).max(40),
});

/**
 * POST the receipt form → Accounting's BIR receipts workbook, filled: the Input
 * sheet and the SI / DR / CR print sheets, layout untouched. Accounting,
 * Payment Approver, Admin (`canGenerateReceipts`).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canGenerateReceipts(user, await getWorkflowRoles())) {
    return NextResponse.json({ error: "Only Accounting, the Payment Approver or an admin can generate receipts." }, { status: 403 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Some fields aren't valid — check the form." }, { status: 400 });
  try {
    const template = await readFile(path.join(process.cwd(), "templates/bir-receipts-template.xlsx"));
    const out = await fillReceiptsWorkbook(template, parsed.data);
    const who = parsed.data.companyName.replace(/[^\w .,&-]+/g, "").trim().slice(0, 60) || "Receipts";
    const name = `BIR Receipts - ${who} - ${parsed.data.date.replace(/,/g, "")}.xlsx`;
    return new NextResponse(new Uint8Array(out), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
