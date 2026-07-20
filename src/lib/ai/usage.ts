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

export interface AiUsageLimit {
  monthlyCalls: number; // 0 = no limit
  monthlyTokens: number; // total (input + output); 0 = no limit
}
const LIMIT_KEY = "ai_usage_limit";

export async function getAiUsageLimit(): Promise<AiUsageLimit> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: LIMIT_KEY } });
    const v = (row?.value as Partial<AiUsageLimit> | null) ?? {};
    return { monthlyCalls: Number(v.monthlyCalls) || 0, monthlyTokens: Number(v.monthlyTokens) || 0 };
  } catch {
    return { monthlyCalls: 0, monthlyTokens: 0 };
  }
}

export async function saveAiUsageLimit(limit: AiUsageLimit): Promise<void> {
  const clean: AiUsageLimit = {
    monthlyCalls: Math.max(0, Math.floor(Number(limit.monthlyCalls) || 0)),
    monthlyTokens: Math.max(0, Math.floor(Number(limit.monthlyTokens) || 0)),
  };
  const value = clean as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: LIMIT_KEY }, create: { key: LIMIT_KEY, value }, update: { value } });
}

/** This month's usage row (zeros if none yet). */
export async function currentMonthUsage(): Promise<{ month: string; calls: number; inputTokens: number; outputTokens: number }> {
  const month = monthKey().replace("ai_usage_", "");
  const all = await getAiUsage();
  return all.find((u) => u.month === month) ?? { month, calls: 0, inputTokens: 0, outputTokens: 0 };
}

/** Evaluate this month's usage against the limit — ok / warn (≥80%) / over. */
export function evaluateUsageAlert(
  usage: { calls: number; inputTokens: number; outputTokens: number },
  limit: AiUsageLimit,
): { level: "ok" | "warn" | "over"; messages: string[] } {
  const messages: string[] = [];
  let level: "ok" | "warn" | "over" = "ok";
  const bump = (l: "warn" | "over") => { if (l === "over") level = "over"; else if (level !== "over") level = "warn"; };
  const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
  const tokens = usage.inputTokens + usage.outputTokens;
  if (limit.monthlyCalls > 0) {
    const pct = usage.calls / limit.monthlyCalls;
    if (pct >= 1) { bump("over"); messages.push(`AI calls this month (${fmt(usage.calls)}) reached the limit of ${fmt(limit.monthlyCalls)}.`); }
    else if (pct >= 0.8) { bump("warn"); messages.push(`AI calls this month (${fmt(usage.calls)}) are at ${Math.round(pct * 100)}% of the ${fmt(limit.monthlyCalls)} limit.`); }
  }
  if (limit.monthlyTokens > 0) {
    const pct = tokens / limit.monthlyTokens;
    if (pct >= 1) { bump("over"); messages.push(`AI tokens this month (${fmt(tokens)}) reached the limit of ${fmt(limit.monthlyTokens)}.`); }
    else if (pct >= 0.8) { bump("warn"); messages.push(`AI tokens this month (${fmt(tokens)}) are at ${Math.round(pct * 100)}% of the ${fmt(limit.monthlyTokens)} limit.`); }
  }
  return { level, messages };
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
