import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { selectFans, type FanModelInput, type SelectionResult } from "@/lib/selection";
import { toDutyPoint, type ParsedRequirement } from "@/lib/requirement";

export const runtime = "nodejs";

// -------------------------------------------------------------------------
// Public, read-only fan-selection API.
//
// This powers the "Fan Selector" on the public HVAC Tools page of the online
// store. It runs the SAME selection engine the staff quotation builder uses,
// but it is deliberately PERFORMANCE-ONLY: the response never contains a price,
// a body cost, or an internal catalogue id. (`SelectionResult` has no price
// field — prices live in a separate price map applied only inside the app —
// so simply returning the engine's output is inherently price-free; the
// `toPublicResult` mapper below is the second guard, whitelisting exactly the
// performance fields we expose.)
//
// It is unauthenticated (see middleware `PUBLIC_PATHS`) and CORS-open so the
// WordPress store can call it from the browser. Only the curated families in
// `PUBLIC_FAMILIES` are reachable — an arbitrary catalogue tag is rejected.
// -------------------------------------------------------------------------

/** A Prisma `where` fragment on `CatalogueItem.modelCode`. */
type ModelWhere = Record<string, unknown>;

/**
 * The product families the public selector is allowed to expose. Each entry's
 * `where` matches the exact model-code suffix (AV####<TAG>), mirroring the
 * staff `/api/selection` route. `directDrive` fixes the drive for direct-only
 * families so the public UI needs no separate drive picker. `propeller` marks
 * the wall/roof fans that default to 0.5" w.g. when no static pressure is set.
 */
const PUBLIC_FAMILIES: {
  tag: string;
  label: string;
  where: ModelWhere;
  directDrive?: boolean;
  propeller?: boolean;
  /** Included in the "All centrifugal" default sweep. */
  centrifugal?: boolean;
}[] = [
  {
    tag: "CEB",
    label: "Backward-Curved Centrifugal (CEB)",
    where: { AND: [{ modelCode: { endsWith: "CEB" } }, { NOT: { modelCode: { contains: "DIDW" } } }] },
    centrifugal: true,
  },
  {
    tag: "CFAB",
    label: "Forward-Curved Centrifugal (CFAB)",
    where: { AND: [{ modelCode: { endsWith: "CFAB" } }, { NOT: { modelCode: { contains: "DIDW" } } }] },
    centrifugal: true,
  },
  {
    tag: "CIEB",
    label: "Centrifugal Inline Blower (CIEB)",
    where: { modelCode: { endsWith: "CIEB" } },
    centrifugal: true,
  },
  {
    tag: "DIDWCEB",
    label: "Double-Width Centrifugal — Backward (DIDW)",
    where: { modelCode: { endsWith: "DIDWCEB" } },
    centrifugal: true,
  },
  {
    tag: "DIDWCFAB",
    label: "Double-Width Centrifugal — Forward (DIDW)",
    where: { modelCode: { endsWith: "DIDWCFAB" } },
    centrifugal: true,
  },
  {
    tag: "EWF",
    label: "Exhaust Wall Fan — Belt (EWF)",
    where: { modelCode: { endsWith: "EWF" } },
    propeller: true,
  },
  {
    tag: "EWFDD",
    label: "Exhaust Wall Fan — Direct (EWFDD)",
    where: { modelCode: { endsWith: "EWFDD" } },
    directDrive: true,
    propeller: true,
  },
  {
    tag: "FAWF",
    label: "Fresh-Air Wall Fan — Belt (FAWF)",
    where: { modelCode: { endsWith: "FAWF" } },
    propeller: true,
  },
  {
    tag: "FAWFDD",
    label: "Fresh-Air Wall Fan — Direct (FAWFDD)",
    where: { modelCode: { endsWith: "FAWFDD" } },
    directDrive: true,
    propeller: true,
  },
  {
    tag: "PRV",
    label: "Power Roof Ventilator — Belt (PRV)",
    where: { modelCode: { endsWith: "PRV" } },
    propeller: true,
  },
  {
    tag: "PRVDD",
    label: "Power Roof Ventilator — Direct (PRVDD)",
    where: { modelCode: { endsWith: "PRVDD" } },
    directDrive: true,
    propeller: true,
  },
  {
    tag: "TAF",
    label: "Tube-Axial Fan — Belt (TAF)",
    where: { modelCode: { endsWith: "TAF" } },
  },
  {
    tag: "VAF",
    label: "Vane-Axial Fan — Belt (VAF)",
    where: { modelCode: { endsWith: "VAF" } },
  },
];

const FAMILY_BY_TAG = new Map(PUBLIC_FAMILIES.map((f) => [f.tag, f]));

const M3HR_PER_CFM = 1.6990108;

const bodySchema = z.object({
  airflow: z.number().positive(),
  airflowUnit: z.enum(["cfm", "m3hr"]).default("cfm"),
  staticPressure: z.number().min(0),
  pressureUnit: z.enum(["inwg", "pa"]).default("inwg"),
  // A curated family tag (see PUBLIC_FAMILIES). Omit/blank = sweep the
  // centrifugal families (the flagship products).
  tag: z.string().optional(),
});

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  // A tiny discovery endpoint so the store can build its family dropdown from
  // the source of truth rather than hard-coding the list.
  return json({
    families: PUBLIC_FAMILIES.map((f) => ({ tag: f.tag, label: f.label })),
    units: { airflow: ["cfm", "m3hr"], pressure: ["inwg", "pa"] },
  });
}

/** Physical size (inches) from the size label, falling back to the model code. */
function sizeOf(sel: SelectionResult): number {
  if (sel.sizeLabel) {
    const n = parseFloat(sel.sizeLabel);
    if (!Number.isNaN(n)) return n;
  }
  const m = sel.modelCode.match(/(\d{3,5})/);
  return m ? parseInt(m[1], 10) / 100 : 0;
}

/**
 * Whitelist the performance fields we expose publicly. Deliberately omits the
 * internal catalogue id, the price map, and anything cost-related.
 */
function toPublicResult(r: SelectionResult, recommended: boolean) {
  const delivered = r.selectedAirflow_m3hr ?? r.dutyAirflow_m3hr;
  return {
    modelCode: r.modelCode,
    name: r.name,
    size: r.sizeLabel,
    rpm: r.rpm,
    motorHp: r.motorHp,
    motorKw: r.motorKw,
    motorPole: r.motorPole,
    bladeAngle: r.bladeAngle,
    deliveredAirflow_cfm: Math.round(delivered / M3HR_PER_CFM),
    deliveredAirflow_m3hr: Math.round(delivered),
    staticPressure_pa: Math.round(r.dutyStaticPressure_pa),
    bhp: r.bhp,
    power_kw: r.power_kw,
    efficiency: r.efficiency,
    outletVelocity_fpm: r.outletVelocity_fpm,
    confidence: r.confidence,
    recommended,
    summary: r.selectionNote,
    warnings: r.warnings,
  };
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const tag = (body.tag ?? "").trim();
  const family = tag ? FAMILY_BY_TAG.get(tag) : undefined;
  if (tag && !family) {
    return json({ error: "Unknown product family." }, 400);
  }

  // Resolve the SI duty point (units handled by lib/requirement only).
  const si = toDutyPoint({
    airflow: body.airflow,
    airflowUnit: body.airflowUnit,
    staticPressure: body.staticPressure,
    pressureUnit: body.pressureUnit,
  } as ParsedRequirement);
  if (!si) {
    return json({ error: "Airflow and static pressure are required." }, 422);
  }

  let duty = {
    airflow_m3hr: si.airflow_m3hr,
    staticPressure_pa: si.staticPressure_pa,
    temperatureC: si.temperatureC,
  };

  // Propeller wall/roof fans: with no static pressure, select against the
  // recommended 0.5" w.g. (≈124.5 Pa), matching the staff route.
  if (family?.propeller && duty.staticPressure_pa <= 0) {
    duty = { ...duty, staticPressure_pa: 0.5 * 249.0889 };
  }

  // Build the model-code filter: a single family, or the centrifugal sweep.
  const where: ModelWhere = family
    ? family.where
    : { OR: PUBLIC_FAMILIES.filter((f) => f.centrifugal).map((f) => f.where) };
  const directDrive = family?.directDrive ?? false;

  const models = await prisma.catalogueItem.findMany({
    where: { active: true, ratingPoints: { some: {} }, ...where },
    include: { ratingPoints: true },
  });

  const inputs: FanModelInput[] = models.map((m) => ({
    id: m.id,
    modelCode: m.modelCode,
    name: m.name,
    sizeLabel: m.sizeLabel,
    specs: m.specs as Record<string, unknown>,
    ratingPoints: m.ratingPoints.map((rp) => ({
      rpm: rp.rpm,
      airflow_m3hr: rp.airflow_m3hr,
      staticPressure_pa: rp.staticPressure_pa,
      power_kw: rp.power_kw,
      efficiency: rp.efficiency,
    })),
  }));

  const ranked = selectFans(inputs, duty, { directDrive });

  // Centre the list on the recommended (top HIGH) pick — 3 sizes smaller and 3
  // bigger — so the client sees a sensible spread without every catalogue size.
  const recommended = ranked.find((r) => r.confidence === "HIGH") ?? ranked[0] ?? null;
  let windowed = ranked;
  if (recommended) {
    const bySize = [...ranked].sort((a, b) => sizeOf(a) - sizeOf(b));
    const idx = bySize.findIndex((r) => r.modelCode === recommended.modelCode);
    windowed = bySize.slice(Math.max(0, idx - 3), idx + 4);
  }

  return json({
    duty: {
      airflow_m3hr: Math.round(duty.airflow_m3hr),
      airflow_cfm: Math.round(duty.airflow_m3hr / M3HR_PER_CFM),
      staticPressure_pa: Math.round(duty.staticPressure_pa),
    },
    family: family ? { tag: family.tag, label: family.label } : { tag: "", label: "Centrifugal fans" },
    count: windowed.length,
    results: windowed.map((r) => toPublicResult(r, recommended?.modelCode === r.modelCode)),
  });
}
