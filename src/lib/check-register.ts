/**
 * The check register, loaded once and shared.
 *
 * Three screens ask the same question — the Check Monitoring page, the
 * Management Dashboard's tile, and My Dashboard's overdue-check task — and they
 * must not answer it differently. A tile reading "7" beside a register listing
 * twelve rows is the kind of disagreement nobody can debug from the outside, so
 * the query, the supplier-terms lookup and the row builder live here, once.
 *
 * Whether a PO with NO check photo appears is part of that shared answer: the
 * owner asked for those rows after *"september 3 and september 4 PO not showing
 * in check monitoring"* — POs payable by check that nobody had photographed yet.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { coerceCheckDocs, checkExpected } from "@/lib/voucher-check";
import type { PRStatus } from "@/lib/purchasing";
import { getSuppliers } from "@/lib/suppliers";
import { poBatchId } from "@/lib/purchase-batch";
import { buildCheckWatch, type CheckWatchRow } from "@/lib/check-monitor";
import { coerceCashPayment } from "@/lib/cash-payment";

/**
 * Which purchases were settled in cash — asked SEPARATELY, and on purpose.
 *
 * `cashPayment` is a column added by a migration, and this repo deploys
 * `prisma generate && next build` with no `prisma migrate deploy`, so code
 * reliably goes live before schema. Selecting it in the register's own query
 * would be worse than a crash: that query already catches into `[]`, so a column
 * that is not there yet would leave the page rendering an EMPTY register rather
 * than failing loudly. An empty check register is a lie; a missing "Cash" tag on
 * a handful of rows for a few minutes is not.
 *
 * So it is its own small read, and its own empty-on-failure. Only rows that have
 * one come back, which is almost none of them.
 */
async function loadCashPayments(): Promise<Map<string, unknown>> {
  try {
    const rows = await prisma.purchaseRequest.findMany({
      where: { cashPayment: { not: Prisma.DbNull } },
      select: { id: true, cashPayment: true },
    });
    return new Map(rows.map((r) => [r.id, r.cashPayment]));
  } catch (e) {
    console.error("cash payments unavailable — the register will show none", e);
    return new Map();
  }
}

export async function loadCheckRegister(todayYMD: string): Promise<CheckWatchRow[]> {
  // No status filter: a check clears long after its PO is finished, so a
  // COMPLETED PO's check is still on the register.
  const [prs, suppliers, cash] = await Promise.all([
    prisma.purchaseRequest
      .findMany({ select: { id: true, quotationId: true, po: true, voucherCheckDocs: true, status: true } })
      .catch(() => []),
    getSuppliers().catch(() => []),
    loadCashPayments(),
  ]);

  // Which suppliers we pay later, by check. The flag lives on the supplier
  // record — deliberately not read out of a PO's free-text payment remark.
  const termsCompanies = new Set(suppliers.filter((s) => s.terms).map((s) => s.company.trim().toLowerCase()));
  const givesTerms = (company: string | undefined) => !!company && termsCompanies.has(company.trim().toLowerCase());

  return buildCheckWatch(prs, todayYMD, {
    coerceDocs: coerceCheckDocs,
    // Paid in cash — a PO carrying this clears as cash instead of waiting for a
    // check that is never coming.
    cashPaidOf: (pr) => coerceCashPayment(cash.get(pr.id)),
    // A combined PO is several requests sharing one `po` JSON — and one net.
    // Grouping on the batch id makes the register count that PO once, where
    // walking requests counted it once per member. See `buildCheckWatch`.
    batchIdOf: poBatchId,
    /**
     * One unreadable PO must not take the register down with it.
     *
     * This runs over EVERY purchase request in the system, including ones whose
     * `po` JSON predates the current shape. A register of fifty checks is worth
     * far more with one row missing than it is as a white error screen — and
     * the row that dropped out is still on its own PO, where it can be seen.
     */
    poOf: (v) => {
      try {
        const po = coercePurchaseOrder(v);
        return po
          ? { poNumber: po.poNumber, supplierCompany: po.supplier.company, date: po.date || null, net: poTotals(po).net }
          : null;
      } catch (e) {
        console.error("check register: unreadable PO", e);
        return null;
      }
    },
    // The owner's *"For Payment"* rows: due to be paid by check, no photo yet.
    // `checkExpected` is the same rule the PO card uses for its "Check not
    // attached" badge, so the two can't disagree about which POs owe a check.
    expectsCheck: (pr, company) => {
      try {
        return checkExpected({ supplierGivesTerms: givesTerms(company), status: pr.status as PRStatus });
      } catch {
        return false; // an unknown status is not a reason to lose the screen
      }
    },
  });
}
