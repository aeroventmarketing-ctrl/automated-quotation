import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { selectFans, type FanModelInput } from "@/lib/selection";
import { toDutyPoint, type ParsedRequirement } from "@/lib/requirement";

export const runtime = "nodejs";

const bodySchema = z.object({
  // Either pass a parsed requirement (client units) ...
  requirement: z.record(z.unknown()).optional(),
  // ... or an explicit SI duty point.
  duty: z
    .object({
      airflow_m3hr: z.number().positive(),
      staticPressure_pa: z.number().min(0),
      temperatureC: z.number().optional(),
    })
    .optional(),
  // Optionally restrict to specific catalogue models or a family.
  catalogueItemIds: z.array(z.string()).optional(),
  family: z.string().optional(),
  // Restrict to a single product catalogue by tag (CEB / CFAB / DIDWCEB) so the
  // lists never mix. Preferred over `bladeType`; matched on the model-code suffix.
  tag: z.string().optional(),
  // Legacy: restrict to a blade type (forward-curve CFAB vs backward CEB).
  bladeType: z.string().optional(),
  // Direct-drive (CEBDD) selection: constrain to standard 2-/4-pole speed bands.
  directDrive: z.boolean().optional(),
});

/**
 * Model-code filter for a product catalogue. Model codes are AV#### + tag, e.g.
 * AV1225CEB, AV0900CFAB, AV1225DIDWCEB. We match on the exact tag suffix so the
 * backward-curve pool (CEB) never leaks the DIDW models (which also end "CEB").
 */
function catalogueWhere(tag: string | undefined, bladeType: string | undefined) {
  // Explicit tag from the quotation builder takes precedence.
  const t = tag ?? (bladeType ? (/forward/i.test(bladeType) ? "CFAB" : "CEB") : undefined);
  if (t === "DIDWCFAB") return { modelCode: { endsWith: "DIDWCFAB" } };
  if (t === "DIDWCEB") return { modelCode: { endsWith: "DIDWCEB" } };
  if (t === "CIEB") return { modelCode: { endsWith: "CIEB" } };
  if (t === "CFAB") {
    // Forward-curve single-width: ends "CFAB" but not the DIDW catalogue (…DIDWCFAB).
    return {
      AND: [{ modelCode: { endsWith: "CFAB" } }, { NOT: { modelCode: { contains: "DIDW" } } }],
    };
  }
  if (t === "CEB") {
    // Backward-curve CEB: ends "CEB" but not the DIDW catalogue (…DIDWCEB).
    return {
      AND: [{ modelCode: { endsWith: "CEB" } }, { NOT: { modelCode: { contains: "DIDW" } } }],
    };
  }
  return {};
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Resolve the SI duty point deterministically (units via lib/units only).
  let duty = body.duty;
  let sourceUnits: { airflow: string | null; pressure: string | null } | null = null;
  if (!duty && body.requirement) {
    const si = toDutyPoint(body.requirement as ParsedRequirement);
    if (si) {
      duty = {
        airflow_m3hr: si.airflow_m3hr,
        staticPressure_pa: si.staticPressure_pa,
        temperatureC: si.temperatureC,
      };
      sourceUnits = { airflow: si.sourceAirflowUnit, pressure: si.sourcePressureUnit };
    }
  }

  if (!duty) {
    return NextResponse.json(
      { error: "Could not derive a duty point — airflow and static pressure are required." },
      { status: 422 },
    );
  }

  const models = await prisma.catalogueItem.findMany({
    where: {
      active: true,
      ratingPoints: { some: {} },
      ...(body.catalogueItemIds ? { id: { in: body.catalogueItemIds } } : {}),
      ...(body.family ? { family: body.family as never } : {}),
      ...catalogueWhere(body.tag, body.bladeType),
    },
    include: { ratingPoints: true },
  });

  const inputs: FanModelInput[] = models.map((m) => ({
    id: m.id,
    modelCode: m.modelCode,
    name: m.name,
    sizeLabel: m.sizeLabel,
    specs: m.specs as Record<string, unknown>,
    ratingPoints: m.ratingPoints.map((r) => ({
      rpm: r.rpm,
      airflow_m3hr: r.airflow_m3hr,
      staticPressure_pa: r.staticPressure_pa,
      power_kw: r.power_kw,
      efficiency: r.efficiency,
    })),
  }));

  const results = selectFans(inputs, duty, { directDrive: body.directDrive });
  return NextResponse.json({ duty, sourceUnits, results });
}
