import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { QuotationPdf, type QuotationPdfData } from "@/lib/pdf/quotation-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const data: QuotationPdfData = {
    quoteNumber: quotation.quoteNumber,
    createdAt: quotation.createdAt.toISOString().slice(0, 10),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString().slice(0, 10) : null,
    currency: quotation.currency,
    customer: {
      company: quotation.inquiry.customer.company,
      contactName: quotation.inquiry.customer.contactName,
      email: quotation.inquiry.customer.email,
      phone: quotation.inquiry.customer.phone,
      address: quotation.inquiry.customer.address,
    },
    preparedBy: quotation.preparedBy.name,
    approvedBy: quotation.approvedBy?.name ?? null,
    status: quotation.status,
    notes: quotation.notes,
    terms: quotation.terms,
    items: quotation.items.map((it) => ({
      descriptionSnapshot: it.descriptionSnapshot,
      specsSnapshot: it.specsSnapshot as Record<string, unknown>,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
      selectionNote: it.selectionNote,
    })),
    subtotal: Number(quotation.subtotal),
    vat: Number(quotation.vat),
    vatRate: config.vatRate,
    total: Number(quotation.total),
    template: {
      name: quotation.template.name,
      layoutKey: quotation.template.layoutKey,
      config: (quotation.template.config as Record<string, unknown>) ?? {},
    },
  };

  const element = React.createElement(QuotationPdf, { data }) as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quotation.quoteNumber}.pdf"`,
    },
  });
}
