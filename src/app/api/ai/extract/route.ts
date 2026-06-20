import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_IMAGE_PROMPT, extractionUserPrompt } from "@/lib/ai/prompts";
import { extractionResultSchema } from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  rawText: z.string().optional(),
  imageBase64: z.string().optional(),
  mediaType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]).optional(),
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

  if (!body.rawText && !body.imageBase64) {
    return NextResponse.json({ error: "Provide rawText or imageBase64" }, { status: 400 });
  }

  const content: ContentBlock[] = [];
  if (body.imageBase64 && body.mediaType) {
    content.push({ type: "image", image: { mediaType: body.mediaType, base64: body.imageBase64 } });
    content.push({ type: "text", text: EXTRACTION_IMAGE_PROMPT });
    if (body.rawText) content.push({ type: "text", text: `Additional context:\n${body.rawText}` });
  } else {
    content.push({ type: "text", text: extractionUserPrompt(body.rawText!) });
  }

  try {
    const result = await callClaudeJson({
      system: EXTRACTION_SYSTEM_PROMPT,
      content,
      schema: extractionResultSchema,
      maxTokens: 3000,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("extract error", err);
    return NextResponse.json(
      { error: "Extraction failed. Verify ANTHROPIC_API_KEY and try again." },
      { status: 502 },
    );
  }
}
