import { describe, it, expect } from "vitest";
import { jobOrderDues, isOverdueDue, daysToDue, canSetPurchaseDue, purchaseDueState } from "./job-order-due";
import type { OrderWorkflow } from "./order-workflow";

const wf = (jobOrders: Record<string, { dueAt?: string }>) =>
  ({ jobOrders } as unknown as OrderWorkflow);

/**
 * The owner: *"Show job order deadline at the right side of order number."*
 * Asked which of an order's four possible deadlines to show, they chose **every
 * department's** — a purchase can be feeding any of them, and this screen cannot
 * know which.
 */
describe("the deadlines an order is working to", () => {
  it("lists every department that has one, earliest first", () => {
    const dues = jobOrderDues(wf({
      motor: { dueAt: "2026-10-25" },
      fans: { dueAt: "2026-10-20" },
      duct: { dueAt: "2026-10-12" },
    }));
    expect(dues.map((d) => `${d.label} ${d.dueAt}`)).toEqual([
      "Duct 2026-10-12", "Fans & Blower 2026-10-20", "Motor Controller 2026-10-25",
    ]);
  });

  /**
   * A job order with no date is left out rather than shown blank. A row of "—"
   * teaches the eye to skip the whole line, taking the real dates with it.
   */
  it("leaves out a job order nobody has dated", () => {
    expect(jobOrderDues(wf({ fans: {}, duct: { dueAt: "2026-10-12" } })).map((d) => d.dept)).toEqual(["duct"]);
    expect(jobOrderDues(wf({}))).toEqual([]);
    expect(jobOrderDues(wf({ fans: {} }))).toEqual([]);
  });

  it("breaks a tie on the department name, so the order never wobbles", () => {
    const dues = jobOrderDues(wf({ motor: { dueAt: "2026-10-12" }, duct: { dueAt: "2026-10-12" } }));
    expect(dues.map((d) => d.label)).toEqual(["Duct", "Motor Controller"]);
  });

  it("compares a deadline as a calendar day, not an instant", () => {
    expect(isOverdueDue("2026-10-12", "2026-10-13")).toBe(true);
    expect(isOverdueDue("2026-10-12", "2026-10-12")).toBe(false); // due today is not late
    expect(isOverdueDue("2026-10-12", "2026-10-11")).toBe(false);
    expect(daysToDue("2026-10-12", "2026-10-05")).toBe(7);
    expect(daysToDue("2026-10-05", "2026-10-12")).toBe(-7);
  });
});

/**
 * *"Add due date of purchase, purchaser or admin/payment approver can add due
 * date of purchase."*
 */
describe("the due date of purchase", () => {
  it("is set by the three the owner named, and nobody else", () => {
    expect(canSetPurchaseDue({ purchaser: true })).toBe(true);
    expect(canSetPurchaseDue({ admin: true })).toBe(true);
    expect(canSetPurchaseDue({ paymentApprover: true })).toBe(true);
    // Accounting handles the voucher and the check, not when the buying happens.
    expect(canSetPurchaseDue({})).toBe(false);
  });

  it("reads louder as the day approaches, and passes it in red", () => {
    const today = "2026-10-12";
    expect(purchaseDueState("2026-10-20", today, false)).toBe("none"); // still far off
    expect(purchaseDueState("2026-10-15", today, false)).toBe("soon");
    expect(purchaseDueState("2026-10-12", today, false)).toBe("due");
    expect(purchaseDueState("2026-10-11", today, false)).toBe("overdue");
  });

  /**
   * Once the goods are bought the date has done its job. A screen that keeps a
   * purchased item red teaches people to ignore red.
   */
  it("goes quiet once the purchase is made, however late it was", () => {
    expect(purchaseDueState("2026-01-01", "2026-10-12", true)).toBe("met");
    expect(purchaseDueState("2026-10-20", "2026-10-12", true)).toBe("met");
  });

  it("says nothing when there is no date, or no today to measure against", () => {
    expect(purchaseDueState(null, "2026-10-12", false)).toBe("none");
    expect(purchaseDueState("", "2026-10-12", false)).toBe("none");
    // A caller that did not supply today must not turn every date into "due
    // today" — the one answer that is always wrong.
    for (const today of ["", "today", "2026-10"]) {
      expect(purchaseDueState("2026-10-20", today, false), today).toBe("none");
    }
  });
});
