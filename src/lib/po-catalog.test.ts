/**
 * Product matching for PO line descriptions.
 *
 * These lock in a real mispricing: the tokenizer used to drop every token
 * shorter than two characters, which erased the RATING from a whole family of
 * products. "INDUCTION MOTOR 2 HP, 1PH, 4 POLE FOOT MOUNTED (TECO)", the 1.5 HP
 * and the 1 HP all reduced to the same token set, so a 2 HP line matched the
 * 1 HP product and its price. The audit that found it was itself reporting the
 * wrong comparison for the same reason.
 *
 * The KDK cases at the end are the ones the matcher was originally written to
 * protect (a specific model must never match a different one), kept here so a
 * future change cannot fix one family by breaking the other.
 */
import { describe, it, expect } from "vitest";
import { matchKey, catalogPriceFor, suppliersForDescription, type CatalogPrices } from "./po-catalog";

const KEYS = [
  "induction motor 1 hp, 1ph, 4 pole foot mounted (teco)",
  "induction motor 1.5 hp, 1ph, 4 pole foot mounted (teco)",
  "induction motor 2 hp, 1ph, 4 pole foot mounted (teco)",
  "induction motor 5 hp, 3ph, 4 pole foot mounted (teco)",
  "g.i. bolt 5/16 x 1",
  "g.i. bolt 5/16 x 3/4",
  "belt b-50",
  "belt b-40",
  "belt b-36",
  "angle bar 6.0mm x 50mm x 50mm",
  "crs rod 1 1/2 dia x 20'",
  "kdk ceiling cassette - 32chh",
  "kdk ceiling cassette - 24cdh",
  "angle bar",
];

describe("matchKey — ratings and sizes must not cross-match", () => {
  it.each([
    ["INDUCTION MOTOR 1 HP, 1PH, 4 POLE FOOT MOUNTED (TECO) (LA SALLE)", "induction motor 1 hp, 1ph, 4 pole foot mounted (teco)"],
    ["INDUCTION MOTOR 1.5 HP, 1PH, 4 POLE FOOT MOUNTED (TECO) (JOM088)", "induction motor 1.5 hp, 1ph, 4 pole foot mounted (teco)"],
    ["INDUCTION MOTOR 2 HP, 1PH, 4 POLE FOOT MOUNTED (TECO) (JOM081)", "induction motor 2 hp, 1ph, 4 pole foot mounted (teco)"],
    ["INDUCTION MOTOR 5 HP, 3PH, 4 POLE FOOT MOUNTED (TECO) (JOM076)", "induction motor 5 hp, 3ph, 4 pole foot mounted (teco)"],
  ])("%s picks its own rating", (line, expected) => {
    expect(matchKey(line, KEYS)).toBe(expected);
  });

  it("distinguishes bolt lengths that share a diameter", () => {
    expect(matchKey("G.I. BOLT 5/16 X 1 (STOCK)", KEYS)).toBe("g.i. bolt 5/16 x 1");
    expect(matchKey("G.I. BOLT 5/16 X 3/4 (STOCK)", KEYS)).toBe("g.i. bolt 5/16 x 3/4");
  });

  it("still matches through an order-reference suffix", () => {
    expect(matchKey("BELT B-50 (JO 2600080)", KEYS)).toBe("belt b-50");
    expect(matchKey("BELT B-36 (For jo2600075)", KEYS)).toBe("belt b-36");
    expect(matchKey("2 pcs · ANGLE BAR 6.0mm x 50mm x 50mm (JO#2600082)", KEYS)).toBe(
      "angle bar 6.0mm x 50mm x 50mm",
    );
  });

  it("keeps belt sizes apart", () => {
    expect(matchKey("BELT B-40", KEYS)).toBe("belt b-40");
    expect(matchKey("BELT B-50", KEYS)).toBe("belt b-50");
  });

  it("still tolerates word order and separators (the original KDK case)", () => {
    expect(matchKey("KDK Ceiling Cassette · 32CHH", KEYS)).toBe("kdk ceiling cassette - 32chh");
    expect(matchKey("KDK Ceiling Cassette · 24CDH", KEYS)).toBe("kdk ceiling cassette - 24cdh");
  });

  it("returns nothing for a product it has never seen", () => {
    expect(matchKey("MYSTERY WIDGET XZ9", KEYS)).toBeUndefined();
  });
});

describe("catalogPriceFor", () => {
  const catalog: CatalogPrices = {
    "induction motor 1 hp, 1ph, 4 pole foot mounted (teco)": { powerline: 12822 },
    "induction motor 2 hp, 1ph, 4 pole foot mounted (teco)": { powerline: 16472 },
  };

  it("prices a line from its OWN product, not a neighbouring rating", () => {
    expect(catalogPriceFor("INDUCTION MOTOR 2 HP, 1PH, 4 POLE FOOT MOUNTED (TECO) (JOM081)", "powerline", catalog)).toBe(16472);
    expect(catalogPriceFor("INDUCTION MOTOR 1 HP, 1PH, 4 POLE FOOT MOUNTED (TECO) (LA SALLE)", "powerline", catalog)).toBe(12822);
  });
});

describe("suppliersForDescription", () => {
  it("offers the suppliers of the matched product only", () => {
    expect(
      suppliersForDescription("INDUCTION MOTOR 2 HP, 1PH, 4 POLE FOOT MOUNTED (TECO) (JOM081)", {
        "induction motor 1 hp, 1ph, 4 pole foot mounted (teco)": ["WRONG SUPPLIER"],
        "induction motor 2 hp, 1ph, 4 pole foot mounted (teco)": ["POWERLINE"],
      }),
    ).toEqual(["POWERLINE"]);
  });
});
