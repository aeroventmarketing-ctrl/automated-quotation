import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { config, COMPANY } from "@/lib/config";
import { convertAirflow } from "@/lib/units";
import {
  QuotationPdf,
  type QuotationPdfData,
  type QuotationPdfLine,
} from "@/lib/pdf/quotation-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const n = (v: unknown): number | null =>
  typeof v === "number" && !Number.isNaN(v) ? v : null;

/** Pull the per-line engineering specs from specsSnapshot (flat or nested). */
function lineSpecs(specs: Record<string, unknown>, index: number) {
  const sel = (specs.selection ?? {}) as Record<string, unknown>;
  const req = (specs.requirement ?? {}) as Record<string, unknown>;

  // Capacity in CFM: prefer explicit flat value, else derive from the selection
  // duty (m³/hr -> CFM) or a client CFM requirement.
  let cfm = n(specs.capacity_cfm);
  if (cfm == null && typeof sel.dutyAirflow_m3hr === "number") {
    cfm = Math.round(convertAirflow(sel.dutyAirflow_m3hr, "m3hr", "cfm"));
  } else if (cfm == null && req.airflowUnit === "CFM" && typeof req.airflow === "number") {
    cfm = req.airflow;
  }

  return {
    itemLabel: typeof specs.itemLabel === "string" ? specs.itemLabel : String(index + 1),
    capacity_cfm: cfm,
    // Air curtains have no static pressure rating — leave the column blank ("--").
    staticPressure_pa:
      specs.type === "Air Curtain"
        ? null
        : n(specs.staticPressure_pa) ??
          (typeof sel.dutyStaticPressure_pa === "number" ? Math.round(sel.dutyStaticPressure_pa) : null),
    // KDK units aren't sized in inches — leave the Size column blank.
    inches: specs.brand === "KDK" || typeof specs.power_w === "number" ? null : n(specs.inches),
    // KDK units are rated in watts: show the consumption in the motor column.
    motorHp:
      specs.brand === "KDK" || typeof specs.power_w === "number"
        ? n(specs.power_w)
        : n(specs.motorHp) ?? (typeof sel.motorHp === "number" ? sel.motorHp : null),
    motorPh: n(specs.motorPh),
    motorVolts: n(specs.motorVolts),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      template: true,
      inquiry: { include: { customer: true } },
      preparedBy: true,
      approvedBy: true,
    },
  });
  if (!quotation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tplConfig = (quotation.template.config as Record<string, unknown>) ?? {};

  const items: QuotationPdfLine[] = quotation.items.map((it, i) => {
    const specs = (it.specsSnapshot as Record<string, unknown>) ?? {};
    const s = lineSpecs(specs, i);
    return {
      ...s,
      descriptionSnapshot: it.descriptionSnapshot,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
    };
  });

  const data: QuotationPdfData = {
    quoteNumber: quotation.quoteNumber,
    createdAt: quotation.createdAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString().slice(0, 10) : null,
    vatMode:
      quotation.vatMode === "EXCLUSIVE"
        ? "EXCLUSIVE"
        : quotation.vatMode === "EXCLUSIVE_PLUS"
        ? "EXCLUSIVE_PLUS"
        : "INCLUSIVE",
    projectName: quotation.projectName,
    customer: {
      company: quotation.inquiry.customer.company,
      contactName: quotation.inquiry.customer.contactName,
      address: quotation.inquiry.customer.address,
    },
    // Signature reflects the currently logged-in sales user, not the original
    // preparer, so each sales person's downloads carry their own name.
    preparedBy: user.name,
    approvedBy: quotation.approvedBy?.name ?? null,
    status: quotation.status,
    specNote: (quotation.notes && quotation.notes.trim()) || (typeof tplConfig.specNote === "string" ? tplConfig.specNote : null),
    terms:
      (quotation.terms && quotation.terms.trim()) ||
      (typeof tplConfig.terms === "string" && tplConfig.terms.trim() ? tplConfig.terms : "") ||
      COMPANY.defaultTerms,
    items,
    // KDK units are watt-rated, so label the motor column "W" when present.
    motorUnit: quotation.items.some((it) => {
      const s = (it.specsSnapshot as Record<string, unknown>) ?? {};
      return s.brand === "KDK" || typeof s.power_w === "number";
    })
      ? "W"
      : "Hp",
    subtotal: Number(quotation.subtotal),
    vat: Number(quotation.vat),
    total: Number(quotation.total),
    vatRate: config.vatRate,
  };

  const element = React.createElement(QuotationPdf, { data }) as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quotation.quoteNumber.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf"`,
    },
  });
}
