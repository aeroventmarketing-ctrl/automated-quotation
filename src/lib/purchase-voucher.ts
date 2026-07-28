/**
 * Voucher numbering for the purchasing payment (cash) voucher.
 *
 * The number is drawn from the SAME system-wide counter as the cash-request
 * voucher (`cash_request_counter`, set in Admin), so vouchers auto-count across
 * the whole system. The assigned number for a given set of requests is remembered
 * (keyed by the sorted request ids) so re-viewing the same voucher shows the same
 * number instead of consuming a new one.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const COUNTER_KEY = "cash_request_counter"; // shared system voucher counter (admin-set)
const MAP_KEY = "purchase_voucher_numbers"; // selection key -> assigned number

/**
 * Claim (or reuse) the voucher number for a set of purchase requests. Idempotent
 * per selection; increments the shared voucher counter only on first use.
 * Formatted as a 7-digit sequence to match the cash voucher (e.g. "0000812").
 */
export async function claimPurchaseVoucherNo(ids: string[]): Promise<string> {
  const key = [...new Set(ids.filter(Boolean))].sort().join(",");
  if (!key) return "";
  return prisma.$transaction(async (tx) => {
    const mapRow = await tx.appSetting.findUnique({ where: { key: MAP_KEY } });
    const map = ((mapRow?.value as Record<string, unknown> | null) ?? {}) as Record<string, string>;
    if (typeof map[key] === "string" && map[key]) return map[key];

    const cRow = await tx.appSetting.findUnique({ where: { key: COUNTER_KEY } });
    const cur = typeof (cRow?.value as { n?: unknown } | null)?.n === "number" ? (cRow!.value as { n: number }).n : 0;
    const n = cur + 1;
    await tx.appSetting.upsert({
      where: { key: COUNTER_KEY },
      create: { key: COUNTER_KEY, value: { n } as Prisma.InputJsonValue },
      update: { value: { n } as Prisma.InputJsonValue },
    });
    const no = String(n).padStart(7, "0");
    const nextMap = { ...map, [key]: no };
    await tx.appSetting.upsert({
      where: { key: MAP_KEY },
      create: { key: MAP_KEY, value: nextMap as Prisma.InputJsonValue },
      update: { value: nextMap as Prisma.InputJsonValue },
    });
    return no;
  });
}
