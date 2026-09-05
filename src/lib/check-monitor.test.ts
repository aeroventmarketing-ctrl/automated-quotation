import { describe, it, expect } from "vitest";
import type { CheckDoc } from "./voucher-check";
import { effectiveClearingYMD, printedClearingYMD, coerceCheckDocs } from "./voucher-check";
import {
  CHECK_NOTICE_DAYS, buildCheckWatch, checkWatchState, checkWatchSummary,
  daysBetweenYMD, needsAttention, notifiesAdmin, type CheckWatchState,
} from "./check-monitor";

const TODAY = "2026-09-03";

const doc = (over: Partial<CheckDoc> = {}): CheckDoc => ({
  path: "purchases/pr1/1.jpg",
  name: "check.jpg",
  uploadedAt: "",
  uploadedByName: "M",
  read: {
    accountNo: null, accountName: null, checkNo: "0000486722", payee: null,
    clearingYMD: "2026-10-17", amount: 20827.37, amountWords: null, bank: null,
    confidence: 0.95, warnings: [], issues: [], readByName: "M", readAt: "",
  },
  ...over,
});

/** The same check, due on a given day. */
const due = (ymd: string | null, over: Partial<CheckDoc> = {}) =>
  doc({ read: { ...doc().read!, clearingYMD: ymd }, ...over });

describe("days between two dates", () => {
  it("counts forwards, backwards and today", () => {
    expect(daysBetweenYMD(TODAY, "2026-09-06")).toBe(3);
    expect(daysBetweenYMD(TODAY, TODAY)).toBe(0);
    expect(daysBetweenYMD(TODAY, "2026-09-01")).toBe(-2);
  });

  it("crosses a month and a year end", () => {
    expect(daysBetweenYMD("2026-08-30", "2026-09-01")).toBe(2);
    expect(daysBetweenYMD("2026-12-30", "2027-01-02")).toBe(3);
  });
});

/**
 * `CHECK_NOTICE_DAYS` began as the owner's *"notify the admin at least 3 days
 * before clearing"*, so a check three days out is inside the window rather than
 * one day short of it. The window survives as a DISPLAY threshold only — the
 * notification itself was withdrawn: *"do not notify the admin for checks that
 * will soon clear."*
 */
describe("the state a check is in", () => {
  const CASES: [string, string | null, string][] = [
    ["a week out", "2026-09-10", "scheduled"],
    ["four days out — just outside the notice", "2026-09-07", "scheduled"],
    ["exactly three days out — the notice fires", "2026-09-06", "soon"],
    ["two days out", "2026-09-05", "soon"],
    ["tomorrow", "2026-09-04", "soon"],
    ["today", "2026-09-03", "due"],
    ["yesterday, still not cleared", "2026-09-02", "overdue"],
    ["no date could be read", null, "undated"],
  ];
  for (const [what, ymd, state] of CASES) {
    it(what, () => expect(checkWatchState(due(ymd), TODAY)).toBe(state));
  }

  it("is Cleared once a person says the bank cleared it — never by the date alone", () => {
    // A date passing proves nothing; only the bank knows.
    const past = due("2026-09-02");
    expect(checkWatchState(past, TODAY)).toBe("overdue");
    const cleared = { ...past, cleared: { on: "2026-09-02", byName: "Admin Ana", at: "" } };
    expect(checkWatchState(cleared, TODAY)).toBe("cleared");
    // …and it stays cleared even if its date is still in the future.
    expect(checkWatchState({ ...due("2026-12-01"), cleared: { on: "2026-09-03", byName: "A", at: "" } }, TODAY)).toBe("cleared");
  });

  it("draws overdue, today and within three days in amber — and nothing else", () => {
    expect((["overdue", "due", "soon"] as CheckWatchState[]).every(needsAttention)).toBe(true);
    expect((["scheduled", "cleared", "undated"] as CheckWatchState[]).some(needsAttention)).toBe(false);
  });

  it("pushes a task at the admin for an OVERDUE check only", () => {
    // The owner withdrew the advance warning: "do not notify the admin for
    // checks that will soon clear." A check approaching — today's included — is
    // on the register and in First Priority already; only the one that should
    // have cleared and did not is worth interrupting someone for.
    expect(notifiesAdmin("overdue")).toBe(true);
    for (const s of ["due", "soon", "scheduled", "cleared", "undated"] as CheckWatchState[]) {
      expect(notifiesAdmin(s), s).toBe(false);
    }
  });

  it("notifies about strictly fewer states than it colours", () => {
    // The two must not drift back together: amber is a glance, a task is a poke.
    const all: CheckWatchState[] = ["overdue", "due", "soon", "scheduled", "cleared", "undated"];
    const coloured = all.filter(needsAttention);
    const notified = all.filter(notifiesAdmin);
    expect(notified.every((s) => coloured.includes(s))).toBe(true);
    expect(notified.length).toBeLessThan(coloured.length);
  });

  it("uses the owner's number", () => {
    expect(CHECK_NOTICE_DAYS).toBe(3);
  });
});

/**
 * *"If in case the check cannot be cleared because of lack of funds, admin has
 * the option to move the check date to other date."*
 */
describe("moving a check's date", () => {
  it("watches the new date, and keeps what the check itself says", () => {
    const moved = due("2026-09-02", {
      reschedules: [{ from: "2026-09-02", to: "2026-09-20", reason: "insufficient funds", byName: "Admin Ana", at: "" }],
    });
    expect(effectiveClearingYMD(moved)).toBe("2026-09-20");
    expect(moved.read!.clearingYMD).toBe("2026-09-02"); // untouched — it is what is printed
    expect(checkWatchState(moved, TODAY)).toBe("scheduled"); // no longer overdue
  });

  it("follows the LAST move when a check has been put off more than once", () => {
    const twice = due("2026-09-02", {
      reschedules: [
        { from: "2026-09-02", to: "2026-09-10", reason: "insufficient funds", byName: "A", at: "" },
        { from: "2026-09-10", to: "2026-09-04", reason: "funded", byName: "A", at: "" },
      ],
    });
    expect(effectiveClearingYMD(twice)).toBe("2026-09-04");
    expect(checkWatchState(twice, TODAY)).toBe("soon");
  });

  it("survives the column: a reschedule with no new date says nothing and is dropped", () => {
    const [back] = coerceCheckDocs([{ ...doc(), reschedules: [{ from: "x", reason: "y" }, "junk", null] }]);
    expect(back.reschedules).toBeUndefined();
  });

  it("round-trips a real reschedule and a clearing through the column", () => {
    const moved = due("2026-09-02", {
      reschedules: [{ from: "2026-09-02", to: "2026-09-20", reason: "insufficient funds", byName: "Admin Ana", at: "2026-09-03T01:00:00.000Z" }],
      cleared: { on: "2026-09-20", byName: "Admin Ana", at: "2026-09-20T01:00:00.000Z" },
    });
    const [back] = coerceCheckDocs([moved]);
    expect(back.reschedules).toEqual(moved.reschedules);
    expect(back.cleared).toEqual(moved.cleared);
  });
});

describe("the monitoring list", () => {
  const helpers = {
    coerceDocs: (v: unknown) => v as CheckDoc[],
    poOf: (v: unknown) => v as { poNumber: string; supplierCompany: string; date: string | null; net: number } | null,
  };
  const pr = (id: string, docs: CheckDoc[], over: { status?: string; net?: number } = {}) => ({
    id, quotationId: null,
    po: { poNumber: `PO-${id}`, supplierCompany: "POWERLINK", date: "2026-08-01", net: over.net ?? 0 },
    voucherCheckDocs: docs,
    status: over.status ?? "CASH_RELEASED",
  });

  const rows = buildCheckWatch([
    pr("a", [due("2026-09-20", { path: "a1" })]),
    pr("b", [due("2026-09-02", { path: "b1" })]),
    pr("c", [due("2026-09-04", { path: "c1" })]),
    pr("d", [due(null, { path: "d1" })]),
    pr("e", [due("2026-08-01", { path: "e1", cleared: { on: "2026-08-01", byName: "Ana", at: "" } })]),
  ], TODAY, helpers);

  it("puts the soonest first, the undated last, and the cleared after everything", () => {
    expect(rows.map((r) => r.path)).toEqual(["b1", "c1", "a1", "d1", "e1"]);
  });

  it("counts what the tile shows", () => {
    const s = checkWatchSummary(rows);
    expect(s.open).toBe(4); // everything not cleared, undated included
    expect(s.attention).toBe(2); // overdue (b) + soon (c)
    expect(s.overdue).toBe(1);
    expect(s.cleared).toBe(1);
    expect(s.undated).toBe(1);
    expect(s.nextYMD).toBe("2026-09-02"); // the one already past is still the next one owed
    expect(s.openAmount).toBeCloseTo(20827.37 * 4, 2);
  });

  it("reports a moved date, and why", () => {
    const [row] = buildCheckWatch([pr("f", [due("2026-09-02", {
      path: "f1",
      reschedules: [{ from: "2026-09-02", to: "2026-09-20", reason: "insufficient funds", byName: "Ana", at: "" }],
    })])], TODAY, helpers);
    expect(row.clearingYMD).toBe("2026-09-20");
    expect(row.originalYMD).toBe("2026-09-02"); // shown only because it differs
    expect(row.moves).toBe(1);
    expect(row.lastMoveReason).toBe("insufficient funds");
  });

  it("does not repeat the printed date when nothing was moved", () => {
    const [row] = buildCheckWatch([pr("g", [due("2026-09-20", { path: "g1" })])], TODAY, helpers);
    expect(row.originalYMD).toBeNull();
    expect(row.moves).toBe(0);
  });
});


/**
 * The owner: *"september 3 and september 4 PO not showing in check monitoring."*
 *
 * Nothing was hiding them — a row WAS a check photo, so a PO nobody had
 * photographed had no row to show. Their answer: list those too, as
 * **"Check not attached"** — the *For Payment* line from their own register.
 */
describe("POs that owe a check but have none attached", () => {
  const TODAY = "2026-09-04";
  const helpers = {
    coerceDocs: (v: unknown) => (v as CheckDoc[]) ?? [],
    poOf: (v: unknown) => v as { poNumber: string; supplierCompany: string; date: string | null; net: number } | null,
    expectsCheck: () => true,
  };
  const pr = (id: string, docs: CheckDoc[], net = 28344.64) => ({
    id, quotationId: null,
    po: { poNumber: `PO-${id}`, supplierCompany: "TKL STEEL CORPORATION", date: "2026-09-03", net },
    voucherCheckDocs: docs,
    status: "CASH_RELEASED",
  });

  it("gives a payable PO with no photo a row of its own", () => {
    const [row] = buildCheckWatch([pr("648", [])], TODAY, helpers);
    expect(row.state).toBe("awaiting");
    expect(row.statusLabel).toBe("For Payment"); // the owner's own register word
    expect(row.poDate).toBe("2026-09-03");
    expect(row.supplier).toBe("TKL STEEL CORPORATION");
    // The PO's NET, because that is what the check will be written for.
    expect(row.amount).toBe(28344.64);
    // …and nothing it cannot honestly claim.
    expect(row.checkNo).toBeNull();
    expect(row.clearingYMD).toBeNull();
    expect(row.daysLeft).toBeNull();
    expect(row.path).toBe(""); // no photo to open
  });

  it("owes money but cannot be overdue, and never pushes a task at the admin", () => {
    const rows = buildCheckWatch([pr("648", [])], TODAY, helpers);
    const s = checkWatchSummary(rows);
    // Accounts Payable — yes: the money is owed.
    expect(s.openAmount).toBe(28344.64);
    expect(s.open).toBe(1);
    // Outstanding Check — no: nothing can clear until a check is written.
    expect(s.firstPriorityAmount).toBe(0);
    expect(s.overdue).toBe(0);
    expect(s.attention).toBe(0);
    expect(s.undated).toBe(0); // an undated CHECK is a different thing entirely
    expect(notifiesAdmin(rows[0].state)).toBe(false);
  });

  it("disappears the moment a photo is attached — never both rows at once", () => {
    const withDoc = buildCheckWatch([pr("648", [due("2026-10-04", { path: "p" })])], TODAY, helpers);
    expect(withDoc).toHaveLength(1);
    expect(withDoc[0].state).not.toBe("awaiting");
    expect(withDoc[0].path).toBe("p");
  });

  it("stays out when no check is expected — a cash supplier, or a PO not yet signed", () => {
    expect(buildCheckWatch([pr("648", [])], TODAY, { ...helpers, expectsCheck: () => false })).toEqual([]);
    // …and callers that never opt in keep the old register exactly.
    expect(buildCheckWatch([pr("648", [])], TODAY, { coerceDocs: helpers.coerceDocs, poOf: helpers.poOf })).toEqual([]);
  });

  it("sorts after the dated checks, with the undated ones", () => {
    const rows = buildCheckWatch(
      [pr("648", []), pr("640", [due("2026-09-10", { path: "x" })])],
      TODAY,
      helpers,
    );
    expect(rows.map((r) => r.state)).toEqual(["scheduled", "awaiting"]);
  });
});


/**
 * The owner, on a check plainly reading `1 0 1 7 2 0 2 6`: *"error in reading
 * check 10 17 2026 is october 17, 2026."* The register showed **17 July** —
 * not a month/day swap, a different month entirely.
 *
 * The date had never come from the boxes. Either the read predated their being
 * transcribed at all, or the model could not make them out and its own written
 * answer stood by default — and nothing on screen distinguished either case
 * from a date read straight off the check.
 */
describe("a clearing date nobody confirmed", () => {
  const TODAY = "2026-09-04";
  const helpers = {
    coerceDocs: (v: unknown) => (v as CheckDoc[]) ?? [],
    poOf: (v: unknown) => v as { poNumber: string; supplierCompany: string; date: string | null; net: number } | null,
  };
  const pr = (docs: CheckDoc[]) => ({
    id: "pr", quotationId: null,
    po: { poNumber: "PO-630", supplierCompany: "POWERLINK", date: "2026-09-01", net: 39210.75 },
    voucherCheckDocs: docs, status: "CASH_RELEASED",
  });
  const read = (over: Record<string, unknown> = {}) => ({
    accountNo: null, accountName: null, checkNo: "0000486709", payee: null,
    clearingYMD: "2026-10-17", dateBoxes: "10172026", amount: 39210.75,
    amountFigures: 39210.75, amountFromWords: 39210.75, amountWords: "", bank: "BDO",
    confidence: 0.95, warnings: [], issues: [], readByName: "M", readAt: "", ...over,
  });
  const doc = (r: Record<string, unknown> = {}): CheckDoc =>
    ({ path: "c.jpg", name: "c.jpg", uploadedAt: "", uploadedByName: "M", read: read(r) } as CheckDoc);

  it("trusts a date assembled from the check's own boxes", () => {
    const [row] = buildCheckWatch([pr([doc()])], TODAY, helpers);
    expect(row.clearingYMD).toBe("2026-10-17");
    expect(row.dateVerified).toBe(true);
  });

  it("does NOT trust a date the boxes never produced", () => {
    // The owner's row exactly: the model wrote July, the boxes say October, and
    // the boxes were never recorded — so July is what was stored.
    const [row] = buildCheckWatch([pr([doc({ clearingYMD: "2026-07-17", dateBoxes: null })])], TODAY, helpers);
    expect(row.clearingYMD).toBe("2026-07-17");
    expect(row.dateVerified).toBe(false);
  });

  it("does not trust a date the boxes CONTRADICT", () => {
    // Belt and braces: stored date and stored digits disagreeing means one of
    // them is wrong, and the row must not present the date as settled.
    const [row] = buildCheckWatch([pr([doc({ clearingYMD: "2026-07-17", dateBoxes: "10172026" })])], TODAY, helpers);
    expect(row.dateVerified).toBe(false);
  });

  it("counts them, so a person knows how much of the register to check", () => {
    const rows = buildCheckWatch([
      { ...pr([doc()]), id: "ok" },
      { ...pr([doc({ clearingYMD: "2026-07-17", dateBoxes: null })]), id: "bad1" },
      { ...pr([doc({ clearingYMD: "2026-08-01", dateBoxes: null })]), id: "bad2" },
    ], TODAY, helpers);
    expect(checkWatchSummary(rows).unverifiedDates).toBe(2);
  });

  it("takes a person's word over the boxes — a moved or cleared date is settled", () => {
    const moved = doc({ clearingYMD: "2026-07-17", dateBoxes: null });
    moved.reschedules = [{ from: "2026-07-17", to: "2026-10-17", reason: "funds", byName: "Ana", at: "" }];
    expect(buildCheckWatch([pr([moved])], TODAY, helpers)[0].dateVerified).toBe(true);

    const done = doc({ clearingYMD: "2026-07-17", dateBoxes: null });
    done.cleared = { on: "2026-07-17", byName: "Ana", at: "" };
    expect(buildCheckWatch([pr([done])], TODAY, helpers)[0].dateVerified).toBe(true);
  });

  it("says nothing about a PO whose check is not written yet", () => {
    const rows = buildCheckWatch([pr([])], TODAY, { ...helpers, expectsCheck: () => true });
    expect(rows[0].state).toBe("awaiting");
    expect(rows[0].dateVerified).toBe(true); // no date, nothing to doubt
    expect(checkWatchSummary(rows).unverifiedDates).toBe(0);
  });
});

/**
 * The owner, with the check in front of them: *"Error in reading date. It should
 * be October 17, 2026."*
 *
 * They had already corrected it — with the only tool there was, **Move date** —
 * and the register still printed *"moved from Jul 12, 2026"* in amber under the
 * corrected date, announcing a reschedule that never happened.
 */
describe("correcting a date the AI read wrongly", () => {
  const TODAY = "2026-09-05";
  const helpers = {
    coerceDocs: (v: unknown) => (v as CheckDoc[]) ?? [],
    poOf: (v: unknown) => v as { poNumber: string; supplierCompany: string; date: string | null; net: number } | null,
  };
  const pr = (docs: CheckDoc[]) => ({
    id: "pr", quotationId: null,
    po: { poNumber: "PO-AFBM20260000630", supplierCompany: "POWERLINK MERCHANDISE TRADING CORP.", date: "2026-09-01", net: 39210.75 },
    voucherCheckDocs: docs, status: "CASH_RELEASED",
  });
  /** The owner's row: the AI's July date, no boxes behind it. */
  const misread = (over: Partial<CheckDoc> = {}): CheckDoc => ({
    path: "c.jpg", name: "c.jpg", uploadedAt: "", uploadedByName: "M",
    read: {
      accountNo: null, accountName: null, checkNo: "0000486709", payee: null,
      clearingYMD: "2026-07-12", dateBoxes: null, amount: 39210.75, amountWords: null,
      bank: "BDO", confidence: 0.9, warnings: [], issues: [], readByName: "M", readAt: "",
    },
    ...over,
  });
  const fix = { ymd: "2026-10-17", was: "2026-07-12", byName: "Admin Ana", at: "2026-09-05T01:00:00.000Z" };

  it("is what the check says — it beats the reading", () => {
    const fixed = misread({ dateFix: fix });
    expect(printedClearingYMD(fixed)).toBe("2026-10-17");
    expect(effectiveClearingYMD(fixed)).toBe("2026-10-17");
    // The misread is kept, not erased: correcting it is not pretending it never happened.
    expect(fixed.read!.clearingYMD).toBe("2026-07-12");
    expect(fixed.dateFix!.was).toBe("2026-07-12");
  });

  it("leaves NO 'moved from' behind, because nothing moved", () => {
    const [row] = buildCheckWatch([pr([misread({ dateFix: fix })])], TODAY, helpers);
    expect(row.clearingYMD).toBe("2026-10-17");
    expect(row.originalYMD).toBeNull();
    expect(row.moves).toBe(0);
    expect(row.dateFixedBy).toBe("Admin Ana");
    // …and the date is settled, so the row stops calling itself unconfirmed.
    expect(row.dateVerified).toBe(true);
    expect(checkWatchSummary([row]).unverifiedDates).toBe(0);
  });

  /**
   * The screenshot's row: corrected with Move date before there was anything
   * else. Correcting it properly must clear the amber line the move left.
   */
  it("clears the phantom reschedule off a row that was corrected with Move date", () => {
    const patched = misread({
      reschedules: [{ from: "2026-07-12", to: "2026-10-17", reason: "Correct date", byName: "Admin Ana", at: "" }],
      dateFix: fix,
    });
    const [row] = buildCheckWatch([pr([patched])], TODAY, helpers);
    expect(row.clearingYMD).toBe("2026-10-17");
    expect(row.originalYMD).toBeNull(); // no "moved from Jul 12, 2026"
  });

  /**
   * The two acts stay distinct in both directions. A check correctly read as the
   * 17th and then put off to November IS rescheduled, and the register must
   * still say so.
   */
  it("still reports a real reschedule made after a correction", () => {
    const both = misread({
      dateFix: fix,
      reschedules: [{ from: "2026-10-17", to: "2026-11-04", reason: "insufficient funds", byName: "Admin Ana", at: "" }],
    });
    expect(effectiveClearingYMD(both)).toBe("2026-11-04"); // the move wins for WHEN
    expect(printedClearingYMD(both)).toBe("2026-10-17"); // …the correction for WHAT IT SAYS
    const [row] = buildCheckWatch([pr([both])], TODAY, helpers);
    expect(row.clearingYMD).toBe("2026-11-04");
    expect(row.originalYMD).toBe("2026-10-17"); // moved from the date it really carries
  });

  it("survives the column, and a correction that isn't a real day is dropped", () => {
    const [back] = coerceCheckDocs([misread({ dateFix: fix })]);
    expect(back.dateFix).toEqual(fix);
    for (const bad of [{ ymd: "" }, { ymd: "2026-02-31" }, { ymd: "17-10-2026" }, { ymd: "2026-13-01" }, "junk", null]) {
      expect(coerceCheckDocs([{ ...misread(), dateFix: bad }])[0].dateFix, JSON.stringify(bad)).toBeUndefined();
    }
  });
});
