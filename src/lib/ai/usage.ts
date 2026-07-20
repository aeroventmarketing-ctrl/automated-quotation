/**
 * Lightweight AI usage meter. Each Claude call records its token usage into a
 * per-month AppSetting counter (key "ai_usage_<YYYY-MM>"), so admins can see how
 * much the AI features (receipt reading, inquiry/quote extraction) consume
 * without logging into the Anthropic console. Best-effort — never throws.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface AiUsageValue {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

function monthKey(): string {
  // "YYYY-MM" in Manila time (en-CA yields ISO-style year-month).
  const ym = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date());
  return `ai_usage_${ym}`;
}

export async function recordAiUsage(inputTokens: number, outputTokens: number): Promise<void> {
  try {
    const key = monthKey();
    await prisma.$transaction(async (tx) => {
      const row = await tx.appSetting.findUnique({ where: { key } });
      const cur = (row?.value as Partial<AiUsageValue> | null) ?? {};
      const next: AiUsageValue = {
        calls: (Number(cur.calls) || 0) + 1,
        inputTokens: (Number(cur.inputTokens) || 0) + Math.max(0, inputTokens),
        outputTokens: (Number(cur.outputTokens) || 0) + Math.max(0, outputTokens),
      };
      const value = next as unknown as Prisma.InputJsonValue;
      await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    });
  } catch (e) {
    console.error("recordAiUsage failed", e);
  }
}

/** Recent months of AI usage, newest first. */
export async function getAiUsage(): Promise<{ month: string; calls: number; inputTokens: number; outputTokens: number }[]> {
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "ai_usage_" } }, orderBy: { key: "desc" } });
    return rows.map((r) => {
      const v = (r.value as Partial<AiUsageValue> | null) ?? {};
      return {
        month: r.key.replace("ai_usage_", ""),
        calls: Number(v.calls) || 0,
        inputTokens: Number(v.inputTokens) || 0,
        outputTokens: Number(v.outputTokens) || 0,
      };
    });
  } catch {
    return [];
  }
}
