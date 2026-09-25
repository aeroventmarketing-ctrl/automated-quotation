import { describe, it, expect } from "vitest";
import { dealHaystack, matchesQuery } from "./commission-search";

/** A real row off the owner's screenshot. */
const ternion = dealHaystack("2026 - AFBM00003264S", "TERNION ENGINEERING COMPANY");
const counter = dealHaystack("CS-2026-0114", "Walk-in — J. Reyes");

describe("matchesQuery", () => {
  /**
   * The most important case in the file. An empty box must show the whole page,
   * not an empty one — clearing the search is how you get back.
   */
  it("matches everything when nothing is typed", () => {
    for (const q of ["", "   ", "\t"]) {
      expect(matchesQuery(ternion, q)).toBe(true);
      expect(matchesQuery(counter, q)).toBe(true);
    }
  });

  it("finds a client by any part of its name, in any case", () => {
    for (const q of ["ternion", "TERNION", "Ternion Engineering", "engineering company", "ern"]) {
      expect(matchesQuery(ternion, q)).toBe(true);
    }
  });

  it("finds an order by its number as it is printed", () => {
    expect(matchesQuery(ternion, "2026 - AFBM00003264S")).toBe(true);
    expect(matchesQuery(ternion, "AFBM00003264S")).toBe(true);
    expect(matchesQuery(ternion, "3264")).toBe(true);
  });

  /**
   * The separators pass. Nobody retypes " - "; they type the number the way it
   * appears in an email, and it has to find the row either way.
   */
  it("finds an order however the separators were typed", () => {
    for (const q of ["2026-AFBM00003264S", "2026AFBM00003264S", "afbm-0000-3264"]) {
      expect(matchesQuery(ternion, q)).toBe(true);
    }
  });

  it("narrows on several words rather than widening", () => {
    expect(matchesQuery(ternion, "ternion 3264")).toBe(true);
    // Both terms must hit — the client is right, the number is not.
    expect(matchesQuery(ternion, "ternion 9999")).toBe(false);
  });

  it("says no to a row that has neither", () => {
    expect(matchesQuery(ternion, "reyes")).toBe(false);
    expect(matchesQuery(counter, "ternion")).toBe(false);
  });

  /**
   * A punctuation-only term squashes to nothing. It must not then match by
   * accident via `"".includes("")` — typing "-" would otherwise look like it
   * had found every row.
   */
  it("does not treat punctuation as a wildcard", () => {
    expect(matchesQuery(ternion, "@@@")).toBe(false);
    expect(matchesQuery(ternion, "ternion @@@")).toBe(false);
  });

  /** The em dash in "Walk-in — J. Reyes" is punctuation on both sides. */
  it("handles a row whose text is mostly punctuation", () => {
    expect(matchesQuery(counter, "walk-in")).toBe(true);
    expect(matchesQuery(counter, "walkin")).toBe(true);
    expect(matchesQuery(counter, "j reyes")).toBe(true);
  });
});

describe("dealHaystack", () => {
  it("carries the order number and the client, lower-cased", () => {
    expect(dealHaystack("Q-2026-01", "Acme Corp")).toBe("q-2026-01 acme corp");
  });

  it("collapses the whitespace a label may carry", () => {
    expect(dealHaystack("  2026 -  AFBM1 ", " Acme   Corp ")).toBe("2026 - afbm1 acme corp");
  });

  /** A counter sale with no client shows "—"; it must not crash or match "—". */
  it("survives a placeholder client", () => {
    const h = dealHaystack("CS-1", "—");
    expect(matchesQuery(h, "cs-1")).toBe(true);
    expect(matchesQuery(h, "acme")).toBe(false);
  });
});
