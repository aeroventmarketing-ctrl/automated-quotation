import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { config, COMPANY } from "@/lib/config";
import { getUserSignature } from "@/lib/signature";
import { convertAirflow, normalizePowerUnit, convertPower, roundPower, type PowerUnit } from "@/lib/units";
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
function lineSpecs(specs: Record<string, unknown>, index: number, motorUnit: PowerUnit) {
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

  const isKdk = specs.brand === "KDK"; // "W" motor rating is for KDK products only
  const isMotorCtrl = specs.type === "Motor Controller"; // no airflow/SP/size
  const isIso = specs.type === "Spring Vibration Isolator"; // no airflow/SP/size/motor
  // Ventilation Accessories carry their size in the description — blank the
  // Capacity / S.P. / Size / Motor columns.
  const isAcc = specs.category === "Ventilation Accessories";
  return {
    itemLabel: typeof specs.itemLabel === "string" ? specs.itemLabel : String(index + 1),
    capacity_cfm: isMotorCtrl || isIso || isAcc ? null : cfm,
    // Air curtains / Motor Controllers / isolators / accessories — no S.P. ("--").
    staticPressure_pa:
      specs.type === "Air Curtain" || isMotorCtrl || isIso || isAcc
        ? null
        : n(specs.staticPressure_pa) ??
          (typeof sel.dutyStaticPressure_pa === "number" ? Math.round(sel.dutyStaticPressure_pa) : null),
    // KDK units / Motor Controllers / isolators / accessories aren't sized in inches.
    inches: isKdk || isMotorCtrl || isIso || isAcc ? null : n(specs.inches),
    // Motor rating shown in the header unit (HP / kW / W). KDK is catalogued in
    // watts and everything else in HP, so each value is converted to that unit.
    motorHp: (() => {
      if (isIso || isAcc) return null;
      if (isKdk) return n(specs.power_w) != null
        ? roundPower(convertPower(n(specs.power_w)!, "W", motorUnit), motorUnit)
        : null;
      const hp = n(specs.motorHp) ?? (typeof sel.motorHp === "number" ? sel.motorHp : null);
      if (hp != null) return roundPower(convertPower(hp, "HP", motorUnit), motorUnit);
      // Watt-rated units without an HP (Jet Fan, Inline Duct Fan) show watts.
      const pw = n(specs.power_w);
      return pw != null ? roundPower(convertPower(pw, "W", motorUnit), motorUnit) : null;
    })(),
    motorPh: isIso || isAcc ? null : n(specs.motorPh),
    motorVolts: isIso || isAcc ? null : n(specs.motorVolts),
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

  // Motor column unit comes from the header (HP / kW / W); values convert to it.
  const headerUnits = (quotation.headerUnits as Record<string, unknown>) ?? {};
  const motorUnit: PowerUnit =
    normalizePowerUnit(typeof headerUnits.motor === "string" ? headerUnits.motor : null) ?? "HP";

  const items: QuotationPdfLine[] = quotation.items.map((it, i) => {
    const specs = (it.specsSnapshot as Record<string, unknown>) ?? {};
    const s = lineSpecs(specs, i, motorUnit);
    return {
      ...s,
      descriptionSnapshot: it.descriptionSnapshot,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
    };
  });

  const data: QuotationPdfData = {
    quoteNumber: ((r) => (typeof r === "number" && r > 0 ? `${quotation.quoteNumber} rev. ${r}` : quotation.quoteNumber))(
      (quotation.classification as Record<string, unknown> | null)?.revision,
    ),
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
    // Their signature image (if uploaded in Admin → Users) above the name.
    signature: await getUserSignature(user.id),
    approvedBy: quotation.approvedBy?.name ?? null,
    status: quotation.status,
    specNote: (quotation.notes && quotation.notes.trim()) || (typeof tplConfig.specNote === "string" ? tplConfig.specNote : null),
    terms:
      (quotation.terms && quotation.terms.trim()) ||
      (typeof tplConfig.terms === "string" && tplConfig.terms.trim() ? tplConfig.terms : "") ||
      COMPANY.defaultTerms,
    items,
    // Motor column label follows the header unit (values are converted to it).
    motorUnit,
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
