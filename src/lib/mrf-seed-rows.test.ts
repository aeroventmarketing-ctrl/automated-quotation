/**
 * What the MRF form opens with.
 *
 * The owner: *"make the remark box blank as standard. Let it be filled by
 * authorized to fill the remarks box."*
 */
import { describe, it, expect } from "vitest";
import { mrfSeedRows, suggestOfficeMrfRows, type MrfSuggestion } from "./mrf-suggest";

const sg = (over: Partial<MrfSuggestion> = {}): MrfSuggestion => ({
  description: 'NENUTEC VARIABLE AIR VOLUME 6" DIAMETER',
  qty: "2",
  unit: "pc",
  remark: "Variable Air Volume · Duct Diameter: 250 mm (10 in)",
  matched: true,
  ...over,
});

describe("mrfSeedRows", () => {
  it("prefills the order's answer and leaves the remark to a person", () => {
    expect(mrfSeedRows([sg()])).toEqual([
      { description: 'NENUTEC VARIABLE AIR VOLUME 6" DIAMETER', qty: "2", unit: "pc", remark: "" },
    ]);
  });

  it("blanks the remark however the suggestion carries it", () => {
    const rows = mrfSeedRows([sg({ remark: undefined }), sg({ remark: "   " }), sg({ remark: "anything" })]);
    expect(rows.map((r) => r.remark)).toEqual(["", "", ""]);
  });

  it("keeps one row per suggestion, in order", () => {
    const rows = mrfSeedRows([sg({ description: "A" }), sg({ description: "B" }), sg({ description: "C" })]);
    expect(rows.map((r) => r.description)).toEqual(["A", "B", "C"]);
  });

  it("has nothing to seed from nothing", () => {
    expect(mrfSeedRows([])).toEqual([]);
  });
});

/**
 * The suggestion still BUILDS its remark — only the box starts empty. The
 * de-duplication in `suggestOfficeMrfRows` keys on the remark, so two lines of
 * the same product with different specifications must stay two rows rather than
 * merging and summing their quantities.
 */
describe("the suggestion keeps its specification", () => {
  const products = [{ name: "VAV 6", unit: "pc" }];

  it("still carries the quotation's specification", () => {
    const [row] = suggestOfficeMrfRows([{ name: "VAV 6", qty: 2, description: "Spec one\nSpec two" }], products);
    expect(row.remark).toBe("Spec one · Spec two");
    // …and the form still shows none of it.
    expect(mrfSeedRows([row])[0].remark).toBe("");
  });

  it("does not merge two lines that differ only by specification", () => {
    const rows = suggestOfficeMrfRows(
      [
        { name: "VAV 6", qty: 2, description: "Spec one" },
        { name: "VAV 6", qty: 3, description: "Spec two" },
      ],
      products,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.qty)).toEqual(["2", "3"]);
  });
});
