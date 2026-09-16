import { describe, it, expect } from "vitest";
import { isSaleConfirmed, saleFromClassification } from "./sale";
import { saleRecognitionDate } from "./department-pnl";
import { alertPasses, type AlertGoLive } from "./alert-golive";

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
 * **Eight queries now stand on this one invariant.** They are the blast radius
 * of a change to `isSaleConfirmed`, and none of them would fail loudly:
 *
 *  - `lib/pending-approvals.ts`   — the approver alarm
 *  - `lib/my-dashboard.ts`        — My Dashboard's half of the same alarm
 *  - `lib/finance-monitor.ts`     — receivables / unreconciled / vouchers
 *  - `lib/receivables.ts`         — the outstanding-balance figure
 *  - `app/(app)/management/page`  — the Management Dashboard's twin
 *  - `lib/sales-commission.ts`    — who is owed commission
 *  - `lib/production-status.ts`   — what is still on the shop floor
 *  - `management/pnl-actions.ts`  — the departmental P&L and its detail, which
 *    reach the gate through `saleRecognitionDate` rather than by name
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

  /**
   * The departmental P&L is the eighth query on this filter, and the only one
   * that never calls `isSaleConfirmed` by name — it reaches the same gate one
   * level down, through `saleRecognitionDate`, which begins with it and returns
   * null when it fails. So the invariant the P&L actually stands on is this one:
   * **no PO, no recognition date, nothing booked.**
   *
   * Worth pinning separately, because the day `saleRecognitionDate` learns to
   * date a sale some other way, the filter would start dropping revenue from a
   * financial report with nothing to show for it.
   */
  for (const [who, sale] of SALES) {
    it(`${who}: if the P&L can date it, it carries a PO`, () => {
      const parsed = saleFromClassification({ sale });
      const dated = saleRecognitionDate({ ...parsed!, soldAt: "2026-09-01T00:00:00Z" });
      if (dated) expect(parsed?.po).toBeTruthy();
    });
  }

  it("a datable sale exists, so the P&L check above is not vacuous", () => {
    const dated = SALES.filter(([, sale]) =>
      saleRecognitionDate({ ...saleFromClassification({ sale })!, soldAt: "2026-09-01T00:00:00Z" }),
    );
    expect(dated.length).toBeGreaterThan(0);
  });
});

/**
 * The go-live gate moved into SQL, and what makes that safe.
 *
 * `confirmedOrdersForAlarm` now carries `and q."createdAt" > $goLiveAt` when the
 * gate is on. The loop that follows still runs `alertPasses(q.createdAt, golive)`
 * on everything returned, so the two must agree exactly — a SQL gate even one
 * boundary case narrower than the loop's would silently stop an order ringing,
 * and nothing would look broken.
 *
 * This pins the equivalence rather than the query, the same way the `sale.po`
 * pre-filter above is pinned: if `alertPasses` ever stops being "strictly after
 * the go-live moment, and everything when the gate is off", this fails next to
 * the reason why.
 */
describe("pushing the alerts go-live gate into SQL is equivalent", () => {
  const AT = "2026-07-31T21:00:00.000Z"; // 1 Aug 2026, 5am Manila — the default
  const on: AlertGoLive = { on: true, at: AT };
  const off: AlertGoLive = { on: false, at: AT };
  /** What the SQL fragment does: `createdAt > $at`, or nothing at all. */
  const sqlKeeps = (d: Date, g: AlertGoLive) => (g.on ? d.getTime() > Date.parse(g.at) : true);

  const CASES: [string, Date][] = [
    ["a practice order from July", new Date("2026-07-15T02:00:00.000Z")],
    ["one raised the hour before go-live", new Date("2026-07-31T20:00:00.000Z")],
    ["one raised at the go-live instant exactly", new Date(AT)],
    ["one a millisecond after it", new Date(Date.parse(AT) + 1)],
    ["one raised the day after", new Date("2026-08-01T09:00:00.000Z")],
    ["one raised today", new Date("2026-09-16T04:00:00.000Z")],
  ];

  for (const [what, createdAt] of CASES) {
    it(`agrees with the loop on ${what}`, () => {
      expect(sqlKeeps(createdAt, on)).toBe(alertPasses(createdAt, on));
      expect(sqlKeeps(createdAt, off)).toBe(alertPasses(createdAt, off));
    });
  }

  /** The boundary is the whole risk: `>=` here would ring the last test order. */
  it("excludes the go-live instant itself, and keeps the millisecond after", () => {
    expect(alertPasses(new Date(AT), on)).toBe(false);
    expect(alertPasses(new Date(Date.parse(AT) + 1), on)).toBe(true);
  });

  /** Gate off means no condition at all — not a condition that happens to pass. */
  it("adds nothing when the gate is off, however old the order", () => {
    expect(alertPasses(new Date("2020-01-01T00:00:00.000Z"), off)).toBe(true);
  });
});
