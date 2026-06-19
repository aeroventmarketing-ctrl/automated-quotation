import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { callClaudeJson } from "@/lib/ai/client";
import { MATCH_SYSTEM_PROMPT, matchUserPrompt } from "@/lib/ai/prompts";
import { matchResultSchema } from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  requirement: z.record(z.unknown()),
  family: z
    .enum(["AXIAL", "CENTRIFUGAL", "PROPELLER", "TUBULAR_INLINE", "CABINET", "ACCESSORY", "SERVICE", "OTHER"])
    .optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Provide only text-relevant catalogue fields to the model (no pricing/sizing).
  const catalogue = await prisma.catalogueItem.findMany({
    where: { active: true, ...(body.family ? { family: body.family } : {}) },
    select: { id: true, modelCode: true, family: true, name: true, description: true, specs: true },
    take: 80,
  });

  try {
    const result = await callClaudeJson({
      system: MATCH_SYSTEM_PROMPT,
      content: [{ type: "text", text: matchUserPrompt(body.requirement, catalogue) }],
      schema: matchResultSchema,
      maxTokens: 1500,
    });

    // Guard: drop any candidate the model invented that isn't a real catalogue id.
    const validIds = new Set(catalogue.map((c) => c.id));
    const candidates = (result.candidates ?? []).filter((c) => validIds.has(c.catalogueItemId));
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("match error", err);
    return NextResponse.json({ error: "Matching failed." }, { status: 502 });
  }
}
