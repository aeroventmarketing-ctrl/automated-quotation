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
  let t = tag ?? (bladeType ? (/forward/i.test(bladeType) ? "CFAB" : "CEB") : undefined);
  // Cabinet / square-inline variants reuse a base catalogue (same models, just a
  // different price factor at quote time): CABSISW→CEB, CEBCAB→DIDWCEB,
  // CFABCAB→DIDWCFAB, SIEB→CIEB.
  const reuse: Record<string, string> = {
    CABSISW: "CEB",
    CEBCAB: "DIDWCEB",
    CFABCAB: "DIDWCFAB",
    SIEB: "CIEB",
  };
  if (t && reuse[t]) t = reuse[t];
  if (t === "DIDWCFAB") return { modelCode: { endsWith: "DIDWCFAB" } };
  if (t === "DIDWCEB") return { modelCode: { endsWith: "DIDWCEB" } };
  if (t === "CIEB") return { modelCode: { endsWith: "CIEB" } };
  // Propeller wall fans by application + drive. Each tag is the exact model-code
  // suffix; "…EWF"/"…FAWF" never match the direct "…DD" codes, and "EWF" vs
  // "FAWF" don't collide (suffixes "EWF" vs "AWF"), so the four pools stay split.
  if (t === "EWFDD") return { modelCode: { endsWith: "EWFDD" } };
  if (t === "FAWFDD") return { modelCode: { endsWith: "FAWFDD" } };
  if (t === "FAWF") return { modelCode: { endsWith: "FAWF" } };
  if (t === "EWF") return { modelCode: { endsWith: "EWF" } };
  if (t === "PRVDD") return { modelCode: { endsWith: "PRVDD" } };
  if (t === "PRV") return { modelCode: { endsWith: "PRV" } };
  // Axial fans (TAF tubeaxial / VAF vaneaxial), belt vs direct. The "…DD" codes
  // end in "DD" so endsWith "TAF"/"VAF" never matches the direct variants.
  if (t === "TAFDD") return { modelCode: { endsWith: "TAFDD" } };
  if (t === "VAFDD") return { modelCode: { endsWith: "VAFDD" } };
  if (t === "TAF") return { modelCode: { endsWith: "TAF" } };
  if (t === "VAF") return { modelCode: { endsWith: "VAF" } };
  // High Pressure Blower — model codes like AV1650HPB. AV8900HPB (89") is
  // hidden for now (no matching CEB price yet).
  if (t === "HPB") return { AND: [{ modelCode: { endsWith: "HPB" } }, { modelCode: { not: "AV8900HPB" } }] };
  // Radial Blower blade catalogues — model codes like AV1281CMH / …CMA / …CMB.
  // The 85.25" size (AV8525*) is hidden until the client supplies its price.
  if (t === "CMH") return { AND: [{ modelCode: { endsWith: "CMH" } }, { modelCode: { not: "AV8525CMH" } }] };
  if (t === "CMA") return { AND: [{ modelCode: { endsWith: "CMA" } }, { modelCode: { not: "AV8525CMA" } }] };
  if (t === "CMB") return { AND: [{ modelCode: { endsWith: "CMB" } }, { modelCode: { not: "AV8525CMB" } }] };
  // Ceiling-cassette ventilating fans — model codes like 17CUG / 24CDF / 38CHG.
  if (t === "CASSETTE") {
    return {
      OR: ["CUF", "CUG", "CDF", "CDG", "CHG", "CHH", "CDH"].map((s) => ({
        modelCode: { endsWith: s },
      })),
    };
  }
  // Östberg CK inline duct fans — model codes CK200 / CK250 / CK315.
  if (t === "CK") return { modelCode: { in: ["CK200", "CK250", "CK315"] } };
  // KDK cabinet fans — model codes like 12NSB / 18NFB / 23NLB.
  if (t === "CABINETFAN") {
    return {
      OR: ["NSB", "NFB", "NLB"].map((s) => ({ modelCode: { endsWith: s } })),
    };
  }
  // KDK mini sirocco fans — model codes like 10CGB15 / 21CGB15.
  if (t === "MINISIROCCO") return { modelCode: { endsWith: "CGB15" } };
  // Wall Mounted Fan, High Pressure Series — model codes like 25GSC / 60GSC.
  if (t === "GSCHP") return { modelCode: { endsWith: "GSC" } };
  // Wall Mounted Fan, Shutter Series — shutter/louver wall fans. The codes share
  // no common suffix (AAQ1/ALH/AUH/RLF/ALF/AUH/KQT/RLE), so list them explicitly.
  if (t === "WMFSHUTTER") {
    return {
      modelCode: {
        in: ["15AAQ1", "20ALH", "20AUH", "25ALH", "25AUH", "25RLF", "30ALF", "30AUH", "30KQT", "30RLE", "40KQT"],
      },
    };
  }
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

  // Propeller wall fans (EWF/EWFDD/FAWF/FAWFDD): when no static pressure is
  // given, select against the recommended 0.5" w.g. (≈124.5 Pa).
  if (
    ["EWF", "EWFDD", "FAWF", "FAWFDD", "PRV", "PRVDD"].includes(body.tag ?? "") &&
    duty.staticPressure_pa <= 0
  ) {
    duty = { ...duty, staticPressure_pa: 0.5 * 249.0889 };
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
