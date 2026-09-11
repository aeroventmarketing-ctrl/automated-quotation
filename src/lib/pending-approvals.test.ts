import { describe, it, expect } from "vitest";
import { isSaleConfirmed, saleFromClassification } from "./sale";

/**
 * The approver alarm polls `pendingApprovalsForUser` every 30 seconds, on every
 * page, for every signed-in user. Its query therefore asks Postgres a NECESSARY
 * condition — `classification -> sale -> po` is present — so the database ships
 * confirmed orders instead of every quotation ever written.
 *
 * That filter is only safe while **a confirmed sale always carries a PO**. If
 * `isSaleConfirmed` ever stops requiring one, the filter would start silently
 * dropping orders — an approver would simply never be told, and nothing would
 * look broken.
 *
 * So this pins the invariant rather than the query: change `isSaleConfirmed` to
 * accept a sale with no PO and this test fails, right next to the reason why.
 *
 * **Seven queries now stand on this one invariant.** They are the blast radius
 * of a change to `isSaleConfirmed`, and none of them would fail loudly:
 *
 *  - `lib/pending-approvals.ts`   — the approver alarm
 *  - `lib/my-dashboard.ts`        — My Dashboard's half of the same alarm
 *  - `lib/finance-monitor.ts`     — receivables / unreconciled / vouchers
 *  - `lib/receivables.ts`         — the outstanding-balance figure
 *  - `app/(app)/management/page`  — the Management Dashboard's twin
 *  - `lib/sales-commission.ts`    — who is owed commission
 *  - `lib/production-status.ts`   — what is still on the shop floor
 */
describe("the SQL pre-filter shared by the confirmed-order queries is safe", () => {
  const po = { path: "sales/po.pdf", name: "po.pdf", uploadedAt: "", uploadedByName: "A" };

  /** Every shape a sale can take, PO-bearing or not. */
  const SALES = [
    ["terms, with a PO", { arrangement: "terms", po }],
    ["cash, with a PO and a payment", { arrangement: "cash", po, payments: [{ amount: 1 }] }],
    ["cash, with a PO, no payment", { arrangement: "cash", po, payments: [] }],
    ["terms, no PO key", { arrangement: "terms" }],
    ["terms, PO explicitly null", { arrangement: "terms", po: null }],
    ["cash, no PO, with a payment", { arrangement: "cash", payments: [{ amount: 1 }] }],
    ["no arrangement", { po }],
  ] as const;

  for (const [who, sale] of SALES) {
    it(`${who}: if it is confirmed, it carries a PO`, () => {
      const parsed = saleFromClassification({ sale });
      if (isSaleConfirmed(parsed)) expect(parsed?.po).toBeTruthy();
    });
  }

  it("at least one shape IS confirmed, so the check above is not vacuous", () => {
    const confirmed = SALES.filter(([, sale]) => isSaleConfirmed(saleFromClassification({ sale })));
    expect(confirmed.length).toBeGreaterThan(0);
  });

  it("a sale with no PO is never confirmed, whatever else it has", () => {
    for (const arrangement of ["terms", "cash"]) {
      for (const payments of [[], [{ amount: 1 }]]) {
        const sale = saleFromClassification({ sale: { arrangement, payments } });
        expect(isSaleConfirmed(sale), `${arrangement} / ${payments.length} payments`).toBe(false);
      }
    }
  });
});
