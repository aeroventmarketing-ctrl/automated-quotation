import { describe, it, expect } from "vitest";
import {
  coerceCounterPayments,
  counterCollected,
  counterDocSlots,
  counterFileSlots,
  COUNTER_FINAL_PAYMENT_SLOT,
} from "./counter-sale";

/**
 * The Payments Collected list on a counter sale. The column is free-form JSON, so
 * the coercion is the only thing standing between a hand-edited / half-written
 * row and the panel — it has to drop what it can't trust rather than render it.
 */
describe("coerceCounterPayments", () => {
  it("reads a full row back unchanged", () => {
    const proof = { path: "counter-sales/s1/1.jpg", name: "slip.jpg", uploadedAt: "2026-08-30T01:00:00.000Z" };
    expect(coerceCounterPayments([{ id: "p1", kind: "full", amount: 1500.5, date: "2026-08-30", proof }])).toEqual([
      { id: "p1", kind: "full", amount: 1500.5, date: "2026-08-30", proof },
    ]);
  });

  it("is empty for anything that isn't a list", () => {
    for (const v of [null, undefined, {}, "", 0, { payments: [] }]) {
      expect(coerceCounterPayments(v)).toEqual([]);
    }
  });

  it("drops rows with no id — there'd be nothing to edit or remove them by", () => {
    expect(coerceCounterPayments([{ kind: "down", amount: 100 }, null, "x", { id: "", amount: 5 }])).toEqual([]);
  });

  it("falls back to a down payment for an unknown kind", () => {
    expect(coerceCounterPayments([{ id: "p1", kind: "cheque-ish", amount: 10, date: "2026-01-02" }])[0].kind).toBe("down");
  });

  it("rounds the amount to centavos and zeroes an unreadable one", () => {
    const [a, b] = coerceCounterPayments([
      { id: "p1", amount: "1200.456", date: "2026-01-02" },
      { id: "p2", amount: "not a number", date: "2026-01-02" },
    ]);
    expect(a.amount).toBe(1200.46);
    expect(b.amount).toBe(0);
  });

  it("keeps only the date part, and drops a proof with no storage path", () => {
    const [p] = coerceCounterPayments([{ id: "p1", amount: 1, date: "2026-01-02T05:00:00.000Z", proof: { name: "x" } }]);
    expect(p.date).toBe("2026-01-02");
    expect(p.proof).toBeNull();
  });

  it("counts EWT in the collected total — it settles the sale like cash", () => {
    const list = coerceCounterPayments([
      { id: "p1", kind: "down", amount: 900, date: "2026-01-02" },
      { id: "p2", kind: "ewt", amount: 100, date: "2026-01-02" },
    ]);
    expect(counterCollected(list)).toBe(1000);
  });
});

/**
 * The final-payment proof is filed in the same `docs` blob as the handover
 * documents, but it is NOT one of them: it never appears in the list of papers
 * the client is given. The two functions have to disagree about it, or the save
 * action would refuse the upload (or the client would be promised a document
 * nobody issues).
 */
describe("counterFileSlots", () => {
  it("accepts the final-payment proof as a file slot", () => {
    expect(counterFileSlots("INCLUSIVE").map((s) => s.key)).toContain(COUNTER_FINAL_PAYMENT_SLOT.key);
  });

  it("keeps it out of the documents handed to the client", () => {
    for (const mode of ["INCLUSIVE", "EXCLUSIVE", "ZERO_RATED"] as const) {
      expect(counterDocSlots(mode).map((s) => s.key)).not.toContain("final_payment");
    }
  });

  it("is optional — a sale never waits on it", () => {
    expect(COUNTER_FINAL_PAYMENT_SLOT.optional).toBe(true);
  });
});
