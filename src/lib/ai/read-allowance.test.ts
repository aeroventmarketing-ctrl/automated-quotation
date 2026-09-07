import { describe, it, expect } from "vitest";
import {
  coerceReadCounts, readsUsed, readsLeft, canReadAgain, bumpReadCount, readLimitMessage,
  type ReadCounts,
} from "./read-allowance";
import { AI_DEPOSIT_SLIP_READ_LIMIT, AI_SALE_DOC_READ_LIMIT } from "./limits";

const LIMIT = AI_DEPOSIT_SLIP_READ_LIMIT;
const LIMITED = { unlimited: false };
const FREE = { unlimited: true };

/**
 * The owner, on an order's four Payments Collected rows: *"in AI reading, allow
 * unlimited number of rows but limit to 3 reads per row. In the first picture,
 * 1st to 3rd row the AI reading is allowed but after the 4th row it message that
 * it exceeded the AI reading."*
 */
describe("the owner's four payment rows", () => {
  const ROWS = ["sales/q1/down.jpg", "sales/q1/full.jpg", "sales/q1/ewt1.jpg", "sales/q1/ewt2.jpg"];

  it("reads all four, one read each — the case that was broken", () => {
    let counts: ReadCounts = {};
    for (const path of ROWS) {
      expect(canReadAgain(counts, path, LIMIT, LIMITED), path).toBe(true);
      counts = bumpReadCount(counts, path, LIMITED);
    }
    // Under the old per-order budget the fourth row was refused here.
    expect(Object.values(counts)).toEqual([1, 1, 1, 1]);
    for (const path of ROWS) expect(readsLeft(counts, path, LIMIT, LIMITED), path).toBe(2);
  });

  it("stops the FOURTH read of one row without touching the others", () => {
    let counts: ReadCounts = {};
    const first = ROWS[0];
    for (let i = 0; i < LIMIT; i++) counts = bumpReadCount(counts, first, LIMITED);
    expect(canReadAgain(counts, first, LIMIT, LIMITED)).toBe(false);
    expect(readsLeft(counts, first, LIMIT, LIMITED)).toBe(0);
    // Every other row still has its own three.
    for (const path of ROWS.slice(1)) {
      expect(canReadAgain(counts, path, LIMIT, LIMITED), path).toBe(true);
      expect(readsLeft(counts, path, LIMIT, LIMITED), path).toBe(LIMIT);
    }
  });

  /** A fifth payment attached tomorrow arrives with its own three. */
  it("puts no limit on the number of rows", () => {
    let counts: ReadCounts = {};
    for (const path of ROWS) for (let i = 0; i < LIMIT; i++) counts = bumpReadCount(counts, path, LIMITED);
    expect(canReadAgain(counts, "sales/q1/a-fifth-row.jpg", LIMIT, LIMITED)).toBe(true);
  });

  it("says which row ran out, and that the others have not", () => {
    const msg = readLimitMessage(LIMIT, "payment proof", "an admin");
    expect(msg).toContain("payment proof");
    expect(msg).toContain("3 times");
    expect(msg).toContain("per attachment");
    // The old message read "used for this order", which was the whole confusion.
    expect(msg).not.toMatch(/for this order/i);
    expect(msg).toContain("Every other row still has its own 3");
  });
});

describe("who is counted", () => {
  const path = "sales/q1/slip.jpg";

  it("never limits the override, however many times they read", () => {
    let counts: ReadCounts = {};
    for (let i = 0; i < 50; i++) counts = bumpReadCount(counts, path, FREE);
    expect(canReadAgain(counts, path, LIMIT, FREE)).toBe(true);
    expect(readsLeft(counts, path, LIMIT, FREE)).toBeNull();
  });

  /**
   * …and reading a colleague's slip on their behalf must not spend the
   * colleague's allowance, so an override read leaves the count where it was.
   */
  it("charges nobody for an override's read", () => {
    const afterAdmin = bumpReadCount({}, path, FREE);
    expect(readsUsed(afterAdmin, path)).toBe(0);
    expect(readsLeft(afterAdmin, path, LIMIT, LIMITED)).toBe(LIMIT);
    // Whereas Accounting's own read costs one.
    expect(readsUsed(bumpReadCount({}, path, LIMITED), path)).toBe(1);
  });

  /**
   * A failed read costs nothing: the caller only bumps the count after a read
   * that produced an answer, so nothing here can charge for an error.
   */
  it("counts nothing for a row that was never read", () => {
    expect(readsUsed({}, path)).toBe(0);
    expect(readsLeft({}, path, LIMIT, LIMITED)).toBe(LIMIT);
  });
});

describe("reading the counts back off a classification", () => {
  it("keeps real counts and drops everything else", () => {
    expect(coerceReadCounts({ "a.jpg": 2, "b.jpg": 1 })).toEqual({ "a.jpg": 2, "b.jpg": 1 });
    expect(coerceReadCounts({ "a.jpg": "2", "b.jpg": -1, "c.jpg": 0, "d.jpg": null, "e.jpg": NaN, "": 5 })).toEqual({});
    expect(coerceReadCounts({ "a.jpg": 2.7 })).toEqual({ "a.jpg": 2 });
  });

  it("survives anything at all in the blob", () => {
    for (const junk of [null, undefined, 3, "x", [], [1, 2]]) {
      expect(coerceReadCounts(junk), JSON.stringify(junk)).toEqual({});
    }
  });

  /**
   * A count already past the limit — an older rule, a hand-edited row — still
   * stops rather than going negative and wrapping around into permission.
   */
  it("stops on a count beyond the limit", () => {
    const counts = { "a.jpg": 99 };
    expect(readsLeft(counts, "a.jpg", LIMIT, LIMITED)).toBe(0);
    expect(canReadAgain(counts, "a.jpg", LIMIT, LIMITED)).toBe(false);
  });

  it("does not mutate the map it was given", () => {
    const before: ReadCounts = { "a.jpg": 1 };
    bumpReadCount(before, "a.jpg", LIMITED);
    expect(before).toEqual({ "a.jpg": 1 });
  });
});

/** The closing documents run the same rule with their own constant. */
describe("the closing documents", () => {
  it("get three reads each, not three between them", () => {
    let counts: ReadCounts = {};
    for (const p of ["sales/q1/si.pdf", "sales/q1/cr.pdf", "sales/q1/dr.pdf", "sales/q1/2307.pdf"]) {
      counts = bumpReadCount(counts, p, LIMITED);
      expect(readsLeft(counts, p, AI_SALE_DOC_READ_LIMIT, LIMITED), p).toBe(AI_SALE_DOC_READ_LIMIT - 1);
    }
  });
});
