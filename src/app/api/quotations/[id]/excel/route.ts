import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { config, COMPANY } from "@/lib/config";
import { buildQuotationXlsx, type XlsxLine, type XlsxData } from "@/lib/excel/quotation-xlsx";
import { getUserSignature } from "@/lib/signature";
import { normalizePowerUnit, convertPower, roundPower } from "@/lib/units";

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

  // The motor column shows whichever unit the header selects (HP / kW / W).
  // KDK units are catalogued in watts and everything else in HP, so each value
  // is converted to the header unit for display (e.g. a 750 W KDK fan shows as
  // ~1 HP when the header unit is HP). Falls back to HP for an unknown label.
  const isKdkSpecs = (s: Record<string, unknown>) => s.brand === "KDK";
  const motorUnit = normalizePowerUnit(typeof units.motor === "string" ? units.motor : null) ?? "HP";
  // Motor Controllers / vibration isolators have no airflow / static pressure /
  // physical size, and isolators have no motor either. Ventilation Accessories
  // (Air Terminals / Dampers) carry their size in the description, so their
  // Capacity / S.P. / Size / Motor columns are blanked too.
  const isMotorCtrl = (s: Record<string, unknown>) => s.type === "Motor Controller";
  const isIso = (s: Record<string, unknown>) => s.type === "Spring Vibration Isolator";
  const isAcc = (s: Record<string, unknown>) => s.category === "Ventilation Accessories";

  const items: XlsxLine[] = q.items.map((it) => {
    const s = (it.specsSnapshot as Record<string, unknown>) ?? {};
    // Native rating → header unit. KDK is watts (power_w); everything else HP.
    let motorHp: number | string | null;
    if (isIso(s) || isAcc(s)) {
      motorHp = null;
    } else if (isKdkSpecs(s) && typeof s.power_w === "number") {
      motorHp = roundPower(convertPower(s.power_w, "W", motorUnit), motorUnit);
    } else if (typeof s.motorHp === "number") {
      motorHp = roundPower(convertPower(s.motorHp, "HP", motorUnit), motorUnit);
    } else if (typeof s.motorHp === "string") {
      motorHp = s.motorHp;
    } else if (typeof s.power_w === "number") {
      // Watt-rated units without an HP (Jet Fan, Inline Duct Fan) show watts.
      motorHp = roundPower(convertPower(s.power_w, "W", motorUnit), motorUnit);
    } else {
      motorHp = null;
    }
    return {
      itemLabel: typeof s.itemLabel === "string" && s.itemLabel ? s.itemLabel : "",
      descriptionSnapshot: it.descriptionSnapshot,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
      capacity_cfm: isMotorCtrl(s) || isIso(s) || isAcc(s) ? null : n(s.capacity_cfm),
      // Air curtains / Motor Controllers / isolators / accessories — no S.P. ("--").
      staticPressure_inwg: s.type === "Air Curtain" || isMotorCtrl(s) || isIso(s) || isAcc(s) ? null : n(s.staticPressure_pa),
      // KDK units / Motor Controllers / isolators / accessories aren't sized in inches.
      inches: isKdkSpecs(s) || isMotorCtrl(s) || isIso(s) || isAcc(s) ? null : n(s.inches),
      motorHp,
      motorPh: isIso(s) || isAcc(s) ? null : n(s.motorPh),
      motorVolts: isIso(s) || isAcc(s) ? null : n(s.motorVolts),
    };
  });

  const data: XlsxData = {
    quoteNumber: ((r) => (typeof r === "number" && r > 0 ? `${q.quoteNumber} rev. ${r}` : q.quoteNumber))(
      (q.classification as Record<string, unknown> | null)?.revision,
    ),
    dateStr: q.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    projectName: q.projectName,
    customerName: q.inquiry.customer.contactName || q.inquiry.customer.company,
    vatMode:
      q.vatMode === "EXCLUSIVE" ? "EXCLUSIVE" : q.vatMode === "EXCLUSIVE_PLUS" ? "EXCLUSIVE_PLUS" : "INCLUSIVE",
    discountPct: Number(q.discountPct ?? 0),
    vatRate: config.vatRate,
    capacityUnit: (typeof units.capacity === "string" && units.capacity) || "cfm",
    pressureUnit: (typeof units.pressure === "string" && units.pressure) || "in-w.g.",
    motorUnit,
    // Signature reflects the currently logged-in sales user, not the original
    // preparer, so each sales person's downloads carry their own name.
    preparedBy: user.name,
    // Their signature image (if uploaded in Admin → Users) above the name.
    signature: await getUserSignature(user.id),
    // Quote note → template note (blank quote note falls through to the template).
    specNote: (q.notes && q.notes.trim()) || (typeof tpl.specNote === "string" ? tpl.specNote : null),
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
