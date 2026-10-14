import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { solvePressurization, isPressError, type PressInput } from "@/lib/hvac/pressurization";
import { buildPressurizationWorkbook } from "@/lib/excel/pressurization-xlsx";

export const runtime = "nodejs";
export const maxDuration = 30;

const n = z.number().finite();
const body = z.object({
  project: z.string().max(120),
  criteria: z.string().max(120),
  input: z.object({
    floors: n, floorHeight: n, designPa: n, minPa: n, doorForceLimitN: n, closerForceN: n,
    doorWidth: n, doorHeight: n, doorLeakArea: n, exitLeakArea: n, otherLeakArea: n,
    outdoorC: n, stairC: n, openDoorVelocity: n, fireFloor: n, ductLeakPct: n, systemLossPa: n,
  }),
});

/**
 * POST the pressurization tool's inputs → its calculation sheet (.xlsx). The
 * figures are solved again here from the inputs, so the sheet can't disagree
 * with the method. HVAC Tools' audience: Sales, Engineers, admins.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user, "SALES", "ENGINEER", "ADMIN")) {
    return NextResponse.json({ error: "HVAC Tools are for Sales, Engineers and admins." }, { status: 403 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Some fields aren't valid — check the form." }, { status: 400 });
  const input = parsed.data.input as PressInput;
  const result = solvePressurization(input);
  if (isPressError(result)) return NextResponse.json({ error: result.error }, { status: 400 });

  const date = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" }).format(new Date());
  const out = await buildPressurizationWorkbook({ project: parsed.data.project, criteria: parsed.data.criteria, input, result, preparedBy: user.name, date });
  const who = parsed.data.project.replace(/[^\w .,&-]+/g, "").trim().slice(0, 60) || "Stair";
  const name = `Stair pressurization - ${who}.xlsx`;
  return new NextResponse(new Uint8Array(out), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
