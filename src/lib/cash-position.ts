/**
 * The cash position under the check register — can we cover the checks we have
 * written?
 *
 * The owner's eight rules, in their words:
 *
 * > *1. Total First Priority is the total check amount for clearing based on the
 * > current date, if not cleared it will stay in this row · 2. COB is Cash on
 * > Bank, I will manually input the detail · 3. Remaining COB is COB − Total
 * > First Priority · 4. COH is Cash on Hand, Collectibles, Cash/Gcash/Checking,
 * > I will manually input the detail · 5. Remaining Cash is the total of
 * > Remaining COB, COH, Collectibles, Cash/Gcash/Checking · 6. Dispensable Cash
 * > is same as Remaining Cash · 7. Total Payables is the total amount of checks
 * > issued · 8. Deficit is Total payables − Dispensable cash.*
 *
 * Four figures are typed in by the owner (rules 2 and 4) because nothing in the
 * system knows a bank balance. Everything else is derived from those four and
 * from the checks themselves, so no total can drift out of step with the
 * register above it.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { round2 } from "@/lib/quote";

export const CASH_POSITION_KEY = "cash_position";

/** The four figures only a person can know. Rules 2 and 4. */
export interface CashPositionInput {
  /** **Cash in Bank** (the sheet's COB). */
  cob: number;
  /** **Cash on Hand** (COH). */
  coh: number;
  /**
   * NO LONGER TYPED IN. The owner's rule: *"Collectibles change to Receivables,
   * link and show the amount from Receivables in Management dashboard."* The
   * figure is now computed by `getReceivablesOutstanding()`; this field survives
   * only so a previously saved value can be read back and ignored rather than
   * crashing the panel.
   *
   * @deprecated superseded by the linked Receivables figure.
   */
  collectibles: number;
  /** Cash / Gcash / Checking. */
  cashGcashChecking: number;
  updatedByName: string;
  updatedAt: string; // ISO
}

export const EMPTY_CASH_POSITION: CashPositionInput = {
  cob: 0, coh: 0, collectibles: 0, cashGcashChecking: 0, updatedByName: "", updatedAt: "",
};

/**
 * The panel's figures, under the names the owner gave them:
 *
 * | was | is |
 * | --- | --- |
 * | Total First Priority | **Outstanding Check** |
 * | COB | **Cash in Bank** |
 * | Remaining COB | **Available Cash Balance** |
 * | COH | **Cash on Hand** |
 * | Collectibles | **Receivables** (now linked, not typed) |
 * | Remaining Cash | **Available Cash Balance** |
 * | Dispensable Cash | **Available Funds** |
 * | Total Payables | **Accounts Payable** |
 * | Deficit | **Funding Shortfall** |
 *
 * Two rows carry the name *Available Cash Balance* — the bank-only line and the
 * all-in line. The owner was asked about the collision and answered *"Change the
 * name only"*, so both keep it and no row was removed.
 */
export interface CashPosition extends CashPositionInput {
  /**
   * Rule 1 — the checks whose clearing date has ARRIVED (today or earlier) and
   * which nobody has cleared. *"If not cleared it will stay in this row"*: a
   * check whose date has passed is more urgent, not less, so it stays counted
   * until someone confirms the bank took it.
   */
  firstPriority: number;
  /** Rule 3 — COB − Total First Priority. May go negative; that is the point. */
  remainingCob: number;
  /** Receivables — linked from the Management Dashboard, not typed in. */
  receivables: number;
  /** Rule 5 — Available Cash Balance + Cash on Hand + Receivables + Cash/Gcash/Checking. */
  remainingCash: number;
  /** Rule 6 — the same figure, under the name the owner uses for it. */
  dispensableCash: number;
  /** Rule 7 — every check issued and not yet cleared. */
  totalPayables: number;
  /** Rule 8 — Total Payables − Dispensable Cash. Positive means short. */
  deficit: number;
}

/**
 * Rules 1, 3, 5, 6 and 8, given the two figures the register supplies and the
 * four the owner types.
 *
 * `firstPriority` and `totalPayables` come from the check watch, so the panel and
 * the table above it can never disagree.
 */
export function computeCashPosition(
  input: CashPositionInput,
  totals: { firstPriority: number; totalPayables: number; receivables: number },
): CashPosition {
  const remainingCob = round2(input.cob - totals.firstPriority);
  // Receivables comes from the Management Dashboard now, not from the stored
  // `collectibles`, which is why the old field is ignored here.
  const receivables = round2(totals.receivables);
  const remainingCash = round2(remainingCob + input.coh + receivables + input.cashGcashChecking);
  return {
    ...input,
    firstPriority: round2(totals.firstPriority),
    receivables,
    remainingCob,
    remainingCash,
    // Rule 6 says these are the same figure. Kept as two named fields rather
    // than one, because the owner's sheet shows both lines and a reader looking
    // for "Dispensable Cash" should find it.
    dispensableCash: remainingCash,
    totalPayables: round2(totals.totalPayables),
    deficit: round2(totals.totalPayables - remainingCash),
  };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function coerceCashPosition(v: unknown): CashPositionInput {
  if (!v || typeof v !== "object") return EMPTY_CASH_POSITION;
  const o = v as Record<string, unknown>;
  return {
    cob: num(o.cob),
    coh: num(o.coh),
    collectibles: num(o.collectibles),
    cashGcashChecking: num(o.cashGcashChecking),
    updatedByName: typeof o.updatedByName === "string" ? o.updatedByName : "",
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
  };
}

export async function getCashPosition(): Promise<CashPositionInput> {
  const row = await prisma.appSetting.findUnique({ where: { key: CASH_POSITION_KEY } });
  return coerceCashPosition(row?.value);
}

export async function saveCashPosition(input: CashPositionInput): Promise<CashPositionInput> {
  const clean = coerceCashPosition(input);
  await prisma.appSetting.upsert({
    where: { key: CASH_POSITION_KEY },
    create: { key: CASH_POSITION_KEY, value: clean as unknown as Prisma.InputJsonValue },
    update: { value: clean as unknown as Prisma.InputJsonValue },
  });
  return clean;
}
