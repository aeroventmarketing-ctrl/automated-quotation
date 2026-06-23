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
  // Restrict to a blade type so forward-curve (CFAB) and backward-curve (CEB)
  // models don't compete in one list. Matched on the model-code tag.
  bladeType: z.string().optional(),
  // Direct-drive (CEBDD) selection: constrain to standard 2-/4-pole speed bands.
  directDrive: z.boolean().optional(),
});

/** Model-code filter for a blade type: forward-curve models carry the CFAB tag. */
function bladeTypeWhere(bladeType: string | undefined) {
  if (!bladeType) return {};
  return /forward/i.test(bladeType)
    ? { modelCode: { contains: "CFAB" } }
    : { modelCode: { not: { contains: "CFAB" } } };
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
      ...bladeTypeWhere(body.bladeType),
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
