/**
 * Expenses ↔ Checks reconciliation.
 *
 * The owner, comparing PO-AFBM20260000607 on Expenses Records (₱79,337.70) with
 * Check monitoring (₱88,064.84): *"please check amount is different in expenses
 * and check monitoring. Check and compare other expenses and check for
 * discrepancies"*, then *"yes please build the reconciliation view"*.
 *
 * The two figures are the same purchase on two bases:
 *
 *   PO total (VAT-inclusive)      G
 *   Expenses Records              G ÷ 1.12          (VAT-registered supplier; else G)
 *   Input VAT                     G − G ÷ 1.12      (claimed back from BIR)
 *   EWT withheld                  per the PO        (paid to BIR, not the supplier)
 *   Check to the supplier         G − EWT           = what the check should say
 *
 * So the only real discrepancy is a check whose amount is not G − EWT: a wrong
 * figure on the check, a misread photo, or a PO changed after the check was
 * written. This module works that out per PURCHASE ORDER (a combined PO is one
 * PO however many requests it covers) and flags anything more than ₱1 out.
 *
 * Pure: the database read is `getExpenseCheckRecon` in management/pnl-actions.
 */
import { poBatchId } from "@/lib/purchase-batch";
import { purchaseOrderKey } from "@/lib/check-duplicates";

export const RECON_TOLERANCE = 1; // ₱

/**
 * Requests grouped ONE PER PURCHASE ORDER. A combined PO is several requests
 * carrying the same `po` JSON — the WHOLE PO's lines and total — so anything that
 * sums PO amounts request by request counts a combined PO once per member. Same
 * key Check monitoring groups by.
 */
export function groupByPurchaseOrder<T extends { id: string; po: unknown }>(prs: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const pr of prs) {
    const po = pr.po as { poNumber?: unknown } | null;
    const poNumber = po && typeof po.poNumber === "string" ? po.poNumber : null;
    const key = purchaseOrderKey({ id: pr.id, poNumber, batchId: poBatchId(pr.po) });
    const g = groups.get(key);
    if (g) g.push(pr);
    else groups.set(key, [pr]);
  }
  // Stable member order, so the request a PO is booked under never changes between reads.
  return [...groups.values()].map((g) => [...g].sort((a, b) => a.id.localeCompare(b.id)));
}

export type ReconStatus = "match" | "mismatch" | "no-check" | "unread" | "cash";

export interface ReconInput {
  key: string;
  poNumber: string;
  supplier: string;
  /** Departments the PO's requests came from (first = where Expenses books it). */
  deptLabels: string[];
  /** Booked on Expenses Records (a production department's PO). */
  inExpenses: boolean;
  releasedYMD: string;
  /** PO total, VAT-inclusive. */
  gross: number;
  /** Withholding tax on the PO. */
  ewt: number;
  /** The supplier is VAT-registered: the expense is the total ÷ 1.12. */
  vatInclusive: boolean;
  /** Every check photo's amount on the PO (null where unread). */
  checkAmounts: (number | null)[];
  /** Settled in cash instead of by check. */
  paidInCash: boolean;
  requests: number;
  href: string | null;
}

export interface ReconRow extends Omit<ReconInput, "checkAmounts"> {
  expense: number;
  vat: number;
  expectedCheck: number;
  actualCheck: number | null;
  checks: number;
  /** actual − expected, when there is an actual. */
  diff: number | null;
  status: ReconStatus;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function reconcile(i: ReconInput, vatRate = 0.12): ReconRow {
  const expense = i.vatInclusive ? r2(i.gross / (1 + vatRate)) : r2(i.gross);
  const vat = r2(i.gross - expense);
  const expectedCheck = r2(i.gross - i.ewt);
  const { checkAmounts, ...rest } = i;
  let actualCheck: number | null = null;
  let status: ReconStatus;
  if (checkAmounts.length === 0) {
    status = i.paidInCash ? "cash" : "no-check";
  } else if (checkAmounts.some((a) => a == null)) {
    status = "unread";
  } else {
    // More than one check on a PO (a split payment) — they add up to the PO.
    actualCheck = r2(checkAmounts.reduce<number>((s, a) => s + (a ?? 0), 0));
    status = Math.abs(actualCheck - expectedCheck) <= RECON_TOLERANCE ? "match" : "mismatch";
  }
  return {
    ...rest,
    expense,
    vat,
    expectedCheck,
    actualCheck,
    checks: checkAmounts.length,
    diff: actualCheck == null ? null : r2(actualCheck - expectedCheck),
    status,
  };
}

export interface ReconSummary {
  count: number;
  mismatches: number;
  noCheck: number;
  unread: number;
  expense: number;
  vat: number;
  ewt: number;
  expectedChecks: number;
  actualChecks: number;
}

export function reconSummary(rows: ReconRow[]): ReconSummary {
  const sum = (f: (r: ReconRow) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  return {
    count: rows.length,
    mismatches: rows.filter((r) => r.status === "mismatch").length,
    noCheck: rows.filter((r) => r.status === "no-check").length,
    unread: rows.filter((r) => r.status === "unread").length,
    expense: sum((r) => (r.inExpenses ? r.expense : 0)),
    vat: sum((r) => r.vat),
    ewt: sum((r) => r.ewt),
    expectedChecks: sum((r) => r.expectedCheck),
    actualChecks: sum((r) => r.actualCheck ?? 0),
  };
}

export const RECON_STATUS_LABEL: Record<ReconStatus, string> = {
  match: "Matches",
  mismatch: "Check differs",
  "no-check": "No check yet",
  unread: "Check not read",
  cash: "Paid in cash",
};
