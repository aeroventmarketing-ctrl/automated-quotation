import { describe, it, expect } from "vitest";
import { stockMatchKeys, matchRows } from "./store-stock";
import type { StockOptWithAvail } from "./inventory";

/**
 * The storefront's availability read used to pull the ENTIRE active inventory —
 * ~1,024 rows per call in production — and let `matchRows` pick out the handful
 * belonging to listed products. Postgres now does the narrowing.
 *
 * That is only safe while the narrowed set is a **superset** of everything
 * `matchRows` could have chosen. If a row that would have matched is not
 * fetched, the product looks untracked — and untracked is deliberately treated
 * as **sellable**, so the failure would be a sold-out item offered for sale.
 * Nothing would throw; the shop would just be wrong.
 *
 * So this pins the invariant the SQL implements rather than the SQL itself:
 * every row `matchRows` accepts has a canonical sku or name in `stockMatchKeys`.
 */

const row = (over: Partial<StockOptWithAvail> = {}): StockOptWithAvail => ({
  id: "s1", sku: null, name: "Some Item", unit: "pc", location: null, available: 5, ...over,
});

/** The canonicalisation the SQL mirrors: lowercase first, then strip. */
const canon = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

describe("Postgres can only narrow what matchRows would have picked", () => {
  const ENTRIES = [
    { modelCode: "AFB-250-4P", name: "Axial Fan 250mm" },
    { modelCode: "  kdk/30-ceh  ", name: "KDK Ceiling Exhaust" },
    { modelCode: "", name: "Nameless Code" },
    { modelCode: "PLAIN", name: "" },
  ];

  /** Rows designed to probe the match, matching and not. */
  const ROWS: StockOptWithAvail[] = [
    row({ id: "by-code", sku: "AFB 250 4P" }),               // punctuation differs — canon-equal
    row({ id: "by-code-case", sku: "kdk-30-ceh" }),          // case + punctuation
    row({ id: "by-name", name: "axial fan 250mm" }),         // name match, different case
    row({ id: "by-name-punct", name: "K.D.K Ceiling Exhaust" }),
    row({ id: "unrelated", sku: "XX-9", name: "Something Else" }),
    row({ id: "empty-sku", sku: "", name: "Nameless Code" }),
    row({ id: "plain", sku: "PLAIN" }),
  ];

  it("every row matchRows accepts would have been fetched", () => {
    const keys = new Set(stockMatchKeys(ENTRIES));
    let matchedAny = 0;
    for (const e of ENTRIES) {
      for (const r of matchRows(ROWS, e.modelCode, e.name)) {
        matchedAny++;
        const reachable = (r.sku && keys.has(canon(r.sku))) || keys.has(canon(r.name));
        expect(reachable, `row ${r.id} matched ${e.modelCode || e.name} but no key would fetch it`).toBe(true);
      }
    }
    // Not vacuous: the fixture really does match things.
    expect(matchedAny).toBeGreaterThan(2);
  });

  it("a row the keys do not name is never matched", () => {
    const keys = new Set(stockMatchKeys(ENTRIES));
    const unrelated = ROWS.find((r) => r.id === "unrelated")!;
    expect(keys.has(canon(unrelated.sku!))).toBe(false);
    expect(keys.has(canon(unrelated.name))).toBe(false);
    for (const e of ENTRIES) {
      expect(matchRows(ROWS, e.modelCode, e.name).map((r) => r.id)).not.toContain("unrelated");
    }
  });

  it("blank codes and names contribute no key, so they cannot widen the fetch", () => {
    // `canon("")` is "" and is filtered out — otherwise an empty sku column would
    // match every product with no model code.
    expect(stockMatchKeys([{ modelCode: "", name: "" }])).toEqual([]);
    expect(stockMatchKeys([{ modelCode: "  /  ", name: "" }])).toEqual([]);
    expect(stockMatchKeys(ENTRIES)).not.toContain("");
  });

  it("keys are deduplicated, so a big catalogue does not send the same key twice", () => {
    const dupes = [
      { modelCode: "SAME", name: "Same Thing" },
      { modelCode: "s-a-m-e", name: "SAME THING" },
    ];
    expect(stockMatchKeys(dupes)).toEqual(["same", "samething"]);
  });

  it("the code match wins over the name match, as it did before", () => {
    // Unchanged behaviour, asserted so the narrowing cannot be blamed later for
    // a preference that was always there.
    const rows = [row({ id: "code", sku: "AFB-250-4P", name: "Wrong Name" }), row({ id: "name", name: "Axial Fan 250mm" })];
    expect(matchRows(rows, "AFB-250-4P", "Axial Fan 250mm").map((r) => r.id)).toEqual(["code"]);
  });
});
