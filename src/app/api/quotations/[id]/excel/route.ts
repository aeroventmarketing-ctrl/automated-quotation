import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { config, COMPANY } from "@/lib/config";
import { buildQuotationXlsx, type XlsxLine, type XlsxData } from "@/lib/excel/quotation-xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

const n = (v: unknown): number | null =>
  typeof v === "number" && !Number.isNaN(v) ? v : null;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const q = await prisma.quotation.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      template: true,
      inquiry: { include: { customer: true } },
      preparedBy: true,
    },
  });
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tpl = (q.template.config as Record<string, unknown>) ?? {};
  const units = (q.headerUnits as Record<string, unknown>) ?? {};

  const items: XlsxLine[] = q.items.map((it) => {
    const s = (it.specsSnapshot as Record<string, unknown>) ?? {};
    const motorHp = typeof s.motorHp === "number" || typeof s.motorHp === "string" ? s.motorHp : null;
    return {
      itemLabel: typeof s.itemLabel === "string" && s.itemLabel ? s.itemLabel : "",
      descriptionSnapshot: it.descriptionSnapshot,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
      capacity_cfm: n(s.capacity_cfm),
      staticPressure_inwg: n(s.staticPressure_pa), // stored value, shown under in-w.g.
      inches: n(s.inches),
      motorHp,
      motorPh: n(s.motorPh),
      motorVolts: n(s.motorVolts),
    };
  });

  const data: XlsxData = {
    quoteNumber: q.quoteNumber,
    dateStr: q.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    projectName: q.projectName,
    customerName: q.inquiry.customer.contactName || q.inquiry.customer.company,
    vatMode:
      q.vatMode === "EXCLUSIVE" ? "EXCLUSIVE" : q.vatMode === "EXCLUSIVE_PLUS" ? "EXCLUSIVE_PLUS" : "INCLUSIVE",
    discountPct: Number(q.discountPct ?? 0),
    vatRate: config.vatRate,
    capacityUnit: (typeof units.capacity === "string" && units.capacity) || "cfm",
    pressureUnit: (typeof units.pressure === "string" && units.pressure) || "in-w.g.",
    motorUnit: (typeof units.motor === "string" && units.motor) || "HP",
    // Signature reflects the currently logged-in sales user, not the original
    // preparer, so each sales person's downloads carry their own name.
    preparedBy: user.name,
    specNote: q.notes ?? (typeof tpl.specNote === "string" ? tpl.specNote : null),
    // Quote terms → template terms → built-in standard terms (never blank).
    terms:
      (q.terms && q.terms.trim()) ||
      (typeof tpl.terms === "string" && tpl.terms.trim() ? tpl.terms : "") ||
      COMPANY.defaultTerms,
    items,
    total: Number(q.total),
  };

  const buf = await buildQuotationXlsx(data);
  const fname = q.quoteNumber.replace(/[^a-zA-Z0-9-]/g, "_") + ".xlsx";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
