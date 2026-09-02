/**
 * Voucher numbering + printed-voucher records for the SALES COMMISSION cash
 * voucher — one voucher per salesperson, totalling every commission they have
 * earned and not yet been paid.
 *
 * Owner (2026-09-02): *"voucher creation for release of commission is per sales
 * personnel. Total every approved inquiry and make a single cash voucher per
 * sales personnel."*
 *
 * Deliberately a sibling of `purchase-voucher.ts` rather than a change to it:
 * that one is Phase 4 (frozen) and pays suppliers, this one pays staff. They
 * share only the **system voucher counter** (`cash_request_counter`, set in
 * Admin), so every cash voucher the company issues — purchasing, cash request or
 * commission — draws from one sequence and two vouchers can never carry the same
 * number. Their maps and registries are separate.
 *
 * A number is CLAIMED only when the voucher is printed; viewing it consumes
 * nothing. Reprinting the same voucher reuses its number.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const COUNTER_KEY = "cash_request_counter"; // shared system voucher counter (admin-set)
const MAP_KEY = "commission_voucher_numbers"; // selection key -> assigned number
const PRINTED_KEY = "printed_commission_vouchers"; // recorded printed vouchers

export interface CommissionVoucherLine {
  description: string;
  amount: number;
}

export interface PrintedCommissionVoucher {
  no: string;
  salespersonId: string;
  paidTo: string;
  /** The deal keys this voucher covers — `<order|counter>:<refId>:<base|override>`. */
  dealKeys: string[];
  lines: CommissionVoucherLine[];
  total: number;
  printedByName: string;
  printedAt: string; // ISO
}

/**
 * The identity of a voucher is the salesperson PLUS the exact set of commissions
 * it covers. A voucher printed today and another printed next month — after two
 * more clients have paid — are different vouchers and must take different
 * numbers, which is why the deal keys are part of the key and not just the person.
 */
const selectionKey = (salespersonId: string, dealKeys: string[]): string =>
  `${salespersonId}|${[...new Set(dealKeys.filter(Boolean))].sort().join(",")}`;

/** The voucher number already assigned to this exact selection, or null (read-only). */
export async function getCommissionVoucherNo(salespersonId: string, dealKeys: string[]): Promise<string | null> {
  if (!salespersonId || dealKeys.length === 0) return null;
  const key = selectionKey(salespersonId, dealKeys);
  const row = await prisma.appSetting.findUnique({ where: { key: MAP_KEY } }).catch(() => null);
  const map = ((row?.value as Record<string, unknown> | null) ?? {}) as Record<string, string>;
  return typeof map[key] === "string" && map[key] ? map[key] : null;
}

/** All recorded printed commission vouchers (most recent first). */
export async function getPrintedCommissionVouchers(): Promise<PrintedCommissionVoucher[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: PRINTED_KEY } }).catch(() => null);
  const arr = Array.isArray(row?.value) ? (row!.value as unknown[]) : [];
  const out: PrintedCommissionVoucher[] = [];
  for (const v of arr) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o.no !== "string" || !o.no) continue;
    out.push({
      no: o.no,
      salespersonId: String(o.salespersonId ?? ""),
      paidTo: String(o.paidTo ?? ""),
      dealKeys: Array.isArray(o.dealKeys) ? (o.dealKeys as unknown[]).map(String) : [],
      lines: Array.isArray(o.lines)
        ? (o.lines as unknown[]).map((l) => ({
            description: String((l as Record<string, unknown>)?.description ?? ""),
            amount: Number((l as Record<string, unknown>)?.amount) || 0,
          }))
        : [],
      total: Number(o.total) || 0,
      printedByName: String(o.printedByName ?? ""),
      printedAt: String(o.printedAt ?? ""),
    });
  }
  return out.sort((a, b) => b.printedAt.localeCompare(a.printedAt));
}

/** Deal key → the printed voucher number that covers it. */
export async function getCommissionVoucherNoByDeal(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const v of await getPrintedCommissionVouchers()) for (const k of v.dealKeys) m.set(k, v.no);
  return m;
}

/**
 * Record a printed commission voucher: claim (or reuse) its number from the
 * shared counter and store the record. Idempotent per selection — reprinting the
 * same voucher reuses the number and refreshes the record.
 */
export async function recordPrintedCommissionVoucher(input: {
  salespersonId: string;
  paidTo: string;
  dealKeys: string[];
  lines: CommissionVoucherLine[];
  total: number;
  printedByName: string;
  printedAt: string;
}): Promise<string> {
  if (!input.salespersonId || input.dealKeys.length === 0) return "";
  const key = selectionKey(input.salespersonId, input.dealKeys);
  return prisma.$transaction(async (tx) => {
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
    const pRow = await tx.appSetting.findUnique({ where: { key: PRINTED_KEY } });
    const list = Array.isArray(pRow?.value) ? (pRow!.value as unknown[]).filter((v) => (v as { no?: unknown })?.no !== no) : [];
    const record: PrintedCommissionVoucher = {
      no,
      salespersonId: input.salespersonId,
      paidTo: input.paidTo,
      dealKeys: [...new Set(input.dealKeys.filter(Boolean))],
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
