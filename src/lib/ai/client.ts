import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/** Strip ```json ... ``` fences and locate the JSON body in a model response. */
export function stripJsonFences(text: string): string {
  let t = text.trim();
  // Remove leading/trailing markdown code fences.
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // If there is still surrounding prose, slice to the outermost JSON object/array.
  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const start =
    firstArr === -1
      ? firstObj
      : firstObj === -1
        ? firstArr
        : Math.min(firstObj, firstArr);
  if (start > 0) {
    const lastObj = t.lastIndexOf("}");
    const lastArr = t.lastIndexOf("]");
    const end = Math.max(lastObj, lastArr);
    if (end > start) t = t.slice(start, end + 1);
  }
  return t.trim();
}

export interface ContentBlock {
  type: "text" | "image" | "document";
  text?: string;
  image?: { mediaType: string; base64: string };
  document?: { base64: string }; // PDF (application/pdf)
}

function toAnthropicContent(blocks: ContentBlock[]): Anthropic.MessageParam["content"] {
  return blocks.map((b) => {
    if (b.type === "image" && b.image) {
      return {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: b.image.mediaType as
            | "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp",
          data: b.image.base64,
        },
      };
    }
    if (b.type === "document" && b.document) {
      return {
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: b.document.base64 },
      };
    }
    return { type: "text" as const, text: b.text ?? "" };
  });
}

/**
 * Call Claude and parse the response into a zod-validated object.
 * Strips markdown fences, and retries ONCE on a parse/validation failure with
 * an explicit "return valid JSON only" nudge.
 */
export async function callClaudeJson<T>(opts: {
  system: string;
  content: ContentBlock[];
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<T> {
  const client = getClient();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: toAnthropicContent(opts.content) },
  ];

  const run = async (): Promise<string> => {
    const res = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages,
    });
    const block = res.content.find((c) => c.type === "text");
    return block && "text" in block ? block.text : "";
  };

  const attempt = (raw: string): T => {
    const cleaned = stripJsonFences(raw);
    const parsed = JSON.parse(cleaned);
    return opts.schema.parse(parsed);
  };

  const first = await run();
  try {
    return attempt(first);
  } catch {
    // Retry once: feed back the previous (bad) output and demand strict JSON.
    messages.push({ role: "assistant", content: first });
    messages.push({
      role: "user",
      content:
        "That was not valid JSON matching the required schema. Reply again with STRICT JSON only — no prose, no markdown fences.",
    });
    const second = await run();
    return attempt(second);
  }
}
