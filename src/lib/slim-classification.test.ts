import { describe, it, expect } from "vitest";
import { UNREAD_CLASSIFICATION_KEYS, withSlimClassification } from "./slim-classification";
import { readOrderWorkflow } from "./order-workflow";
import { saleFromClassification, isSaleConfirmed } from "./sale";
import { payableTotal, readVatExemptTotal } from "./quote";

/**
 * The seven confirmed-order readers no longer fetch `classification` with the
 * rest of their row — Postgres subtracts the keys in `UNREAD_CLASSIFICATION_KEYS`
 * first, and the slimmed column is put back on each row by
 * `withSlimClassification`.
 *
 * The danger in a blacklist is the day someone adds a key to it that a reader
 * quietly needs. Nothing would fail: `saleFromClassification` would return null
 * and the order would simply stop appearing, or `readVatExemptTotal` would return
 * 0 and a VAT-exempt order would be over-valued by 12%. So the keys the readers
 * DO open are pinned here by name.
 */
describe("the keys subtracted from classification", () => {
  /**
   * What the seven readers open. Two of them are easy to miss, because they are
   * read off the row rather than through `sale` or `workflow`: `vatExemptTotal`
   * and `pricing`, both reached by `payableTotal` (and `vatExemptTotal` again by
   * `netOfVat`), which every money-bearing reader calls.
   */
  const READ_BY_CONFIRMED_ORDER_READERS = ["sale", "workflow", "vatExemptTotal", "pricing"];

  for (const key of READ_BY_CONFIRMED_ORDER_READERS) {
    it(`keeps \`${key}\`, which the readers open`, () => {
      expect(UNREAD_CLASSIFICATION_KEYS).not.toContain(key);
    });
  }

  it("drops the revision snapshots, which are the weight", () => {
    expect(UNREAD_CLASSIFICATION_KEYS).toContain("revisions");
  });
});

describe("withSlimClassification", () => {
  const slimmed = {
    sale: { arrangement: "terms", po: { path: "sales/po.pdf", name: "po.pdf", uploadedAt: "", uploadedByName: "A" } },
    workflow: { stage: "producing" },
    vatExemptTotal: 1000,
  };

  it("puts the classification back where the loop expects it", () => {
    const row = { id: "q1", total: 11_200, discountPct: 0, vatMode: "EXCLUSIVE" };
    const q = withSlimClassification(row, new Map([["q1", slimmed]]));

    expect(isSaleConfirmed(saleFromClassification(q.classification))).toBe(true);
    expect(readOrderWorkflow(q.classification).stage).toBe("producing");
    // The VAT-exempt portion stays at face value and only the rest is divided by
    // 1.12 — ₱10,107.14, not the ₱10,000 this would come to if `vatExemptTotal`
    // had been subtracted with the rest. That difference is the whole reason the
    // key is pinned above.
    expect(readVatExemptTotal(q.classification)).toBe(1000);
    expect(payableTotal(q)).toBe(10_107.14);
  });

  it("leaves the row's other fields exactly as they were", () => {
    const row = { id: "q1", quoteNumber: "AFBM-1", nested: { company: "Acme" } };
    const q = withSlimClassification(row, new Map([["q1", slimmed]]));

    expect(q.quoteNumber).toBe("AFBM-1");
    expect(q.nested).toBe(row.nested);
    expect(row).not.toHaveProperty("classification"); // the original is untouched
  });

  /**
   * An order confirmed in the gap between the two queries is in one and not the
   * other. It must read as "no classification", which the reader's own
   * `isSaleConfirmed` gate drops — so the order appears on the next render rather
   * than half-built on this one.
   */
  it("reads as null for a row the map has never heard of", () => {
    const q = withSlimClassification({ id: "brand-new" }, new Map());

    expect(q.classification).toBeNull();
    expect(saleFromClassification(q.classification)).toBeNull();
  });
});
