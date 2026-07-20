import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { recordAiUsage } from "./usage";

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

/** A provider-neutral chat message (converted per provider at call time). */
interface NeutralMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}
interface RunResult {
  text: string;
  inTokens: number;
  outTokens: number;
}

/** OpenAI-compatible content (used by OpenRouter). */
function toOpenAIContent(blocks: ContentBlock[]): string | Record<string, unknown>[] {
  if (blocks.every((b) => b.type === "text")) return blocks.map((b) => b.text ?? "").join("\n");
  return blocks.map((b) => {
    if (b.type === "image" && b.image) return { type: "image_url", image_url: { url: `data:${b.image.mediaType};base64,${b.image.base64}` } };
    if (b.type === "document" && b.document) return { type: "file", file: { filename: "receipt.pdf", file_data: `data:application/pdf;base64,${b.document.base64}` } };
    return { type: "text", text: b.text ?? "" };
  });
}

async function runAnthropic(system: string, messages: NeutralMessage[], maxTokens: number): Promise<RunResult> {
  const client = getClient();
  const res = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: maxTokens,
    system,
    messages: messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
  });
  const block = res.content.find((c) => c.type === "text");
  return { text: block && "text" in block ? block.text : "", inTokens: res.usage?.input_tokens ?? 0, outTokens: res.usage?.output_tokens ?? 0 };
}

async function runOpenRouter(system: string, messages: NeutralMessage[], maxTokens: number): Promise<RunResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.appUrl,
      "X-Title": "AeroQuote",
    },
    body: JSON.stringify({
      model: config.openrouterModel,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: toOpenAIContent(m.content) }))],
    }),
  });
  const json = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: unknown;
  } | null;
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json?.error ?? json ?? {})}`);
  const c = json?.choices?.[0]?.message?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? "").join("") : "";
  return { text, inTokens: json?.usage?.prompt_tokens ?? 0, outTokens: json?.usage?.completion_tokens ?? 0 };
}

/**
 * Call Claude (via Anthropic direct, or via OpenRouter when OPENROUTER_API_KEY
 * is set / AI_PROVIDER=openrouter) and parse the response into a zod-validated
 * object. Strips markdown fences, and retries ONCE on a parse/validation
 * failure with an explicit "return valid JSON only" nudge.
 */
export async function callClaudeJson<T>(opts: {
  system: string;
  content: ContentBlock[];
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<T> {
  const useOpenRouter = config.aiProvider === "openrouter";
  const runOnce = (msgs: NeutralMessage[]) =>
    useOpenRouter ? runOpenRouter(opts.system, msgs, opts.maxTokens ?? 2048) : runAnthropic(opts.system, msgs, opts.maxTokens ?? 2048);

  const messages: NeutralMessage[] = [{ role: "user", content: opts.content }];
  let inTokens = 0;
  let outTokens = 0;
  const run = async (): Promise<string> => {
    const r = await runOnce(messages);
    inTokens += r.inTokens;
    outTokens += r.outTokens;
    return r.text;
  };

  const attempt = (raw: string): T => {
    const cleaned = stripJsonFences(raw);
    const parsed = JSON.parse(cleaned);
    return opts.schema.parse(parsed);
  };

  try {
    const first = await run();
    try {
      return attempt(first);
    } catch {
      // Retry once: feed back the previous (bad) output and demand strict JSON.
      messages.push({ role: "assistant", content: [{ type: "text", text: first }] });
      messages.push({ role: "user", content: [{ type: "text", text: "That was not valid JSON matching the required schema. Reply again with STRICT JSON only — no prose, no markdown fences." }] });
      const second = await run();
      return attempt(second);
    }
  } finally {
    await recordAiUsage(inTokens, outTokens);
  }
}
