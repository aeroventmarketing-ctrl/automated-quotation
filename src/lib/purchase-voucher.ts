/**
 * Voucher numbering + printed-voucher records for the purchasing cash voucher.
 *
 * The number is drawn from the SAME system-wide counter as the cash-request
 * voucher (`cash_request_counter`, set in Admin), so vouchers auto-count across
 * the whole system. A number is only CLAIMED when the voucher is printed; merely
 * viewing it does not consume a number. Printed vouchers are recorded (kept in an
 * AppSetting) so they can be viewed again later and reported on the management
 * dashboard, where each is tallied against the approved requests it covers.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const COUNTER_KEY = "cash_request_counter"; // shared system voucher counter (admin-set)
const MAP_KEY = "purchase_voucher_numbers"; // selection key -> assigned number
const PRINTED_KEY = "printed_vouchers"; // recorded printed vouchers

export interface PrintedVoucherLine {
  description: string;
  amount: number;
}
export interface PrintedVoucher {
  no: string;
  ids: string[]; // covered purchase-request ids
  paidTo: string;
  lines: PrintedVoucherLine[];
  total: number;
  printedByName: string;
  printedAt: string; // ISO
}

const selectionKey = (ids: string[]): string => [...new Set(ids.filter(Boolean))].sort().join(",");

/** The voucher number already assigned to a selection, or null (read-only). */
export async function getPurchaseVoucherNo(ids: string[]): Promise<string | null> {
  const key = selectionKey(ids);
  if (!key) return null;
  const row = await prisma.appSetting.findUnique({ where: { key: MAP_KEY } });
  const map = ((row?.value as Record<string, unknown> | null) ?? {}) as Record<string, string>;
  return typeof map[key] === "string" && map[key] ? map[key] : null;
}

/** All recorded printed vouchers (most recent first). */
export async function getPrintedVouchers(): Promise<PrintedVoucher[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: PRINTED_KEY } });
  const arr = Array.isArray(row?.value) ? (row!.value as unknown[]) : [];
  const out: PrintedVoucher[] = [];
  for (const v of arr) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o.no !== "string" || !o.no) continue;
    out.push({
      no: o.no,
      ids: Array.isArray(o.ids) ? (o.ids as unknown[]).map(String) : [],
      paidTo: String(o.paidTo ?? ""),
      lines: Array.isArray(o.lines)
        ? (o.lines as unknown[]).map((l) => ({ description: String((l as Record<string, unknown>)?.description ?? ""), amount: Number((l as Record<string, unknown>)?.amount) || 0 }))
        : [],
      total: Number(o.total) || 0,
      printedByName: String(o.printedByName ?? ""),
      printedAt: String(o.printedAt ?? ""),
    });
  }
  return out.sort((a, b) => b.printedAt.localeCompare(a.printedAt));
}

/** Map of purchase-request id -> the printed voucher number that covers it. */
export async function getVoucherNoByPr(): Promise<Map<string, string>> {
  const vouchers = await getPrintedVouchers();
  const m = new Map<string, string>();
  for (const v of vouchers) for (const id of v.ids) m.set(id, v.no);
  return m;
}

/**
 * Record a printed voucher: claim (or reuse) its number from the shared counter
 * and store the printed record. Idempotent per selection — reprinting the same
 * voucher reuses the number and refreshes the record. Returns the voucher number.
 */
export async function recordPrintedVoucher(input: {
  ids: string[];
  paidTo: string;
  lines: PrintedVoucherLine[];
  total: number;
  printedByName: string;
  printedAt: string;
}): Promise<string> {
  const key = selectionKey(input.ids);
  if (!key) return "";
  return prisma.$transaction(async (tx) => {
    // Claim/reuse the number.
    const mapRow = await tx.appSetting.findUnique({ where: { key: MAP_KEY } });
    const map = ((mapRow?.value as Record<string, unknown> | null) ?? {}) as Record<string, string>;
    let no = typeof map[key] === "string" ? map[key] : "";
    if (!no) {
      const cRow = await tx.appSetting.findUnique({ where: { key: COUNTER_KEY } });
      const cur = typeof (cRow?.value as { n?: unknown } | null)?.n === "number" ? (cRow!.value as { n: number }).n : 0;
      const n = cur + 1;
      await tx.appSetting.upsert({
        where: { key: COUNTER_KEY },
        create: { key: COUNTER_KEY, value: { n } as Prisma.InputJsonValue },
        update: { value: { n } as Prisma.InputJsonValue },
      });
      no = String(n).padStart(7, "0");
      const nextMap = { ...map, [key]: no };
      await tx.appSetting.upsert({
        where: { key: MAP_KEY },
        create: { key: MAP_KEY, value: nextMap as Prisma.InputJsonValue },
        update: { value: nextMap as Prisma.InputJsonValue },
      });
    }
    // Upsert the printed-voucher record (by number).
    const pRow = await tx.appSetting.findUnique({ where: { key: PRINTED_KEY } });
    const list = Array.isArray(pRow?.value) ? (pRow!.value as unknown[]).filter((v) => (v as { no?: unknown })?.no !== no) : [];
    const record: PrintedVoucher = {
      no,
      ids: [...new Set(input.ids.filter(Boolean))],
      paidTo: input.paidTo,
      lines: input.lines,
      total: input.total,
      printedByName: input.printedByName,
      printedAt: input.printedAt,
    };
    await tx.appSetting.upsert({
      where: { key: PRINTED_KEY },
      create: { key: PRINTED_KEY, value: [record] as unknown as Prisma.InputJsonValue },
      update: { value: [...list, record] as unknown as Prisma.InputJsonValue },
    });
    return no;
  });
}
