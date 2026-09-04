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
import { prisma } from "@/lib/db";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { coerceCheckDocs, checkExpected } from "@/lib/voucher-check";
import type { PRStatus } from "@/lib/purchasing";
import { getSuppliers } from "@/lib/suppliers";
import { buildCheckWatch, type CheckWatchRow } from "@/lib/check-monitor";

export async function loadCheckRegister(todayYMD: string): Promise<CheckWatchRow[]> {
  // No status filter: a check clears long after its PO is finished, so a
  // COMPLETED PO's check is still on the register.
  const [prs, suppliers] = await Promise.all([
    prisma.purchaseRequest
      .findMany({ select: { id: true, quotationId: true, po: true, voucherCheckDocs: true, status: true } })
      .catch(() => []),
    getSuppliers().catch(() => []),
  ]);

  // Which suppliers we pay later, by check. The flag lives on the supplier
  // record — deliberately not read out of a PO's free-text payment remark.
  const termsCompanies = new Set(suppliers.filter((s) => s.terms).map((s) => s.company.trim().toLowerCase()));
  const givesTerms = (company: string | undefined) => !!company && termsCompanies.has(company.trim().toLowerCase());

  return buildCheckWatch(prs, todayYMD, {
    coerceDocs: coerceCheckDocs,
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
