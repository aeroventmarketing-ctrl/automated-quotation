import { describe, it, expect } from "vitest";
import { pesoAmountInWords, pesoAmountFromWords } from "./amount-words";

/**
 * The owner, on a PO whose check and net amount agree in real life:
 * *"please check. Error in AI reading, Check and Net Amount is tally."*
 *
 * The check was for **₱2,081.25** and came back read as **₱2,018.25** — two
 * digits in the wrong order, and nothing about the result looks wrong. The
 * PESOS line cannot fail that way, so it is what the amount is now taken from.
 */
describe("reading the PESOS line back as a number", () => {
  it("reads the amount that was misread off the peso box", () => {
    expect(pesoAmountFromWords("TWO THOUSAND EIGHTY-ONE AND 25/100")).toBe(2081.25);
    // …and does NOT read like the transposed figure, which is the whole point.
    expect(pesoAmountFromWords("TWO THOUSAND EIGHTEEN AND 25/100")).toBe(2018.25);
  });

  it("reads the practice check the owner walked through", () => {
    expect(pesoAmountFromWords("TWO THOUSAND ONE HUNDRED SIXTY AND 54/100")).toBe(2160.54);
    expect(pesoAmountFromWords("TWENTY THOUSAND EIGHT HUNDRED TWENTY SEVEN AND 37/100")).toBe(20827.37);
  });

  it("accepts every way a check closes a whole-peso line", () => {
    // The owner's house style — *"per 00/100 we use the words 'only' in check"* —
    // and the two other conventions the same amount arrives in.
    expect(pesoAmountFromWords("TWO THOUSAND ONE HUNDRED EIGHTY PESOS ONLY")).toBe(2180);
    expect(pesoAmountFromWords("TWO THOUSAND ONE HUNDRED EIGHTY AND 00/100")).toBe(2180);
    expect(pesoAmountFromWords("TWO THOUSAND ONE HUNDRED EIGHTY AND NO/100")).toBe(2180);
    expect(pesoAmountFromWords("*** TWO THOUSAND ONE HUNDRED EIGHTY PESOS ONLY ***")).toBe(2180);
  });

  it("does not care about case, hyphens or spacing", () => {
    expect(pesoAmountFromWords("two thousand eighty one and 25/100")).toBe(2081.25);
    expect(pesoAmountFromWords("TWENTY-ONE  AND  05 / 100")).toBe(21.05);
  });

  it("handles the big ones", () => {
    expect(pesoAmountFromWords("ONE MILLION TWO HUNDRED THIRTY-FOUR THOUSAND FIVE HUNDRED SIXTY-SEVEN AND 89/100")).toBe(1234567.89);
    expect(pesoAmountFromWords("ONE HUNDRED THOUSAND")).toBe(100000);
  });

  it("says nothing rather than half an answer", () => {
    expect(pesoAmountFromWords("TWO THOUSAND SQUIGGLE AND 25/100")).toBeNull(); // an unreadable word
    expect(pesoAmountFromWords("HUNDRED AND 25/100")).toBeNull(); // nothing in front of HUNDRED
    expect(pesoAmountFromWords("TWO THOUSAND THOUSAND")).toBeNull(); // a scale twice
    expect(pesoAmountFromWords("THOUSAND")).toBeNull();
    expect(pesoAmountFromWords("PESOS ONLY")).toBeNull(); // filler, no amount
    expect(pesoAmountFromWords("")).toBeNull();
    expect(pesoAmountFromWords(null)).toBeNull();
  });

  /**
   * The strongest test there is: whatever we can spell, we can read back. If the
   * two ever drift apart, a check will silently disagree with its own voucher.
   */
  it("round-trips everything the voucher speller can produce", () => {
    const amounts = [0.01, 1, 15, 21.05, 99.99, 100, 105, 1000, 2081.25, 2180, 20827.37, 60248.16, 999999.99, 1234567.89];
    for (const n of amounts) {
      expect(pesoAmountFromWords(pesoAmountInWords(n))).toBe(n);
    }
    // …and across a wide sweep, including the whole-peso amounts that carry no tail.
    for (let n = 0; n < 3000; n += 7) {
      const v = Math.round((n + (n % 100) / 100) * 100) / 100;
      expect(pesoAmountFromWords(pesoAmountInWords(v))).toBe(v);
    }
  });
});
