import { describe, it, expect } from "vitest";
import {
  motorCatalogueRows,
  catalogueMotorPrice,
  catalogueTecoPrice,
  catalogueHyundaiPrice,
  mountingOf,
  fanMotorCode,
  tecoCode,
  hyundaiCode,
  hpKey,
  type MotorPriceMap,
} from "./motor-catalogue";
import { MOTORS, EXPROOF_PRICE_BY_HP, motorNetPrice, exproofApplies } from "./pricing/motors";
import { TECO_SELLING, tecoNetPrice } from "./teco-induction-selling";
import { HYUNDAI_SELLING } from "./hyundai-induction-selling";

/**
 * Motor prices, moved out of three hand-edited TypeScript tables and into the
 * catalogue so a supplier increase stops needing a deploy.
 *
 * The property that matters more than any other is at the bottom: seeded from
 * the code tables, the app must price EXACTLY as it did before. A refactor that
 * moves a fan's price by a peso is worse than one that fails loudly.
 */

const rows = motorCatalogueRows();
const byCode = new Map(rows.map((r) => [r.modelCode, r]));
/** The seed, as the pricing code will see it once it is in the database. */
const seededPrices: MotorPriceMap = Object.fromEntries(rows.map((r) => [r.modelCode, r.basePrice]));

describe("the rows", () => {
  it("carries every price from all three code tables, and no others", () => {
    const expected =
      MOTORS.length +
      MOTORS.filter((m) => EXPROOF_PRICE_BY_HP[m.hp] != null && exproofApplies(m, true)).length +
      Object.values(TECO_SELLING).reduce((a, r) => a + 1 + (r.flange != null ? 1 : 0), 0) +
      Object.values(HYUNDAI_SELLING).reduce((a, r) => a + 1 + (r.flange != null ? 1 : 0), 0);
    expect(rows.length).toBe(expected);
  });

  /**
   * `CatalogueItem.modelCode` is UNIQUE. A collision would not be a wrong price,
   * it would be a row that silently fails to seed — so this is the test that has
   * to hold before anything else is worth checking.
   */
  it("gives every row a unique model code", () => {
    expect(new Set(rows.map((r) => r.modelCode)).size).toBe(rows.length);
  });

  /**
   * The reason a synthetic code was needed at all: TECO's own codes are shared
   * across poles at DIFFERENT prices, so they cannot be a unique key.
   */
  it("could not have used TECO's own model codes — they are not unique", () => {
    const by220 = new Map<string, Set<number>>();
    for (const m of MOTORS) {
      if (!m.m220) continue;
      by220.set(m.m220, (by220.get(m.m220) ?? new Set()).add(m.price));
    }
    const sharedAtDifferentPrices = [...by220.values()].filter((prices) => prices.size > 1);
    expect(sharedAtDifferentPrices.length).toBeGreaterThan(0);
  });

  it("prices every row above zero", () => {
    expect(rows.filter((r) => !(r.basePrice > 0))).toEqual([]);
  });

  it("never invents a flange price where the supplier does not offer one", () => {
    for (const [key, r] of Object.entries(TECO_SELLING)) {
      if (r.flange != null) continue;
      const section = key.split("|")[0] as "single" | "ex" | "three";
      expect(byCode.has(tecoCode(section, r.hp, r.pole, "flange"))).toBe(false);
    }
    for (const r of Object.values(HYUNDAI_SELLING)) {
      if (r.flange != null) continue;
      expect(byCode.has(hyundaiCode(r.hp, r.pole, "flange"))).toBe(false);
    }
  });

  /** A spreadsheet sorts text, so 5 HP has to sort before 10 HP or the list is a maze. */
  it("zero-pads the HP so codes sort by size, not alphabetically", () => {
    expect(hpKey(5)).toBe("005.00");
    expect(hpKey(200)).toBe("200.00");
    expect(hpKey(5) < hpKey(10)).toBe(true);
    expect("5" < "10").toBe(false); // …which is the trap being avoided
  });

  /**
   * The key must not ROUND. At one decimal the 0.25 HP motor came out as
   * `000.3` — a code naming a motor that does not exist, and one a 0.3 HP motor
   * would later collide with. Unique keys do not get to approximate.
   */
  it("represents the smallest motor exactly, rather than rounding it", () => {
    expect(hpKey(0.25)).toBe("000.25");
    expect(hpKey(0.25)).not.toBe(hpKey(0.3));
  });

  it("keeps the real model codes on the row, where the quote reads them from", () => {
    const m = MOTORS.find((x) => x.hp === 5 && x.phase === 3 && x.pole === 4)!;
    const row = byCode.get(fanMotorCode(5, 3, 4))!;
    expect(row.specs.m220).toBe(m.m220);
    expect(row.specs.m380).toBe(m.m380);
    expect(row.specs.m440).toBe(m.m440);
  });

  /** Explosion-proof swaps the trailing "T" (TEFC) for "X" — same rule as the quote. */
  it("swaps the TEFC suffix on an explosion-proof row", () => {
    const row = byCode.get(fanMotorCode(5, 3, 4, true))!;
    expect(row.specs.exproof).toBe(true);
    expect(row.specs.m380).toBe("5K3F3X");
  });

  it("sorts stably, so two exports differ only where a price changed", () => {
    expect(rows.map((r) => r.modelCode)).toEqual([...rows.map((r) => r.modelCode)].sort((a, b) => a.localeCompare(b)));
    expect(motorCatalogueRows().map((r) => r.modelCode)).toEqual(rows.map((r) => r.modelCode));
  });
});

/**
 * The two TECO tables are NOT merged, and this pins that they are not.
 *
 * `pricing/motors.ts` and `teco-induction-selling.ts` describe the same motors
 * and have drifted apart on purpose — the selling file's own header says it is
 * independent and that fan pricing "must not change". Merging them would
 * silently re-price every fabricated fan. If somebody later decides fan motors
 * SHOULD adopt the newer prices, that is a commercial decision and this test is
 * the thing that should make them say so out loud.
 */
describe("the two TECO tables, kept separate on purpose", () => {
  it("seeds a fan motor and a standalone TECO motor as different rows", () => {
    const fan = byCode.get(fanMotorCode(15, 3, 4));
    const standalone = byCode.get(tecoCode("three", 15, 4, "foot"));
    expect(fan).toBeDefined();
    expect(standalone).toBeDefined();
    expect(fan!.basePrice).not.toBe(standalone!.basePrice);
  });

  it("carries each table's own price, untouched", () => {
    const m = MOTORS.find((x) => x.hp === 100 && x.phase === 3 && x.pole === 4)!;
    expect(byCode.get(fanMotorCode(100, 3, 4))!.basePrice).toBe(m.price);
    expect(byCode.get(tecoCode("three", 100, 4, "foot"))!.basePrice).toBe(TECO_SELLING["three|100|4"].foot);
  });
});

/**
 * THE test. Seeded from the code tables, every fan must price exactly as it did
 * before — to the peso, for every motor, standard and explosion-proof.
 */
describe("day one prices identically", () => {
  it("returns the code table's own figure for every motor", () => {
    for (const m of MOTORS) {
      for (const exproof of [false, true]) {
        const before = motorNetPrice(m, exproof);
        const after = catalogueMotorPrice(m, exproof, seededPrices);
        expect(after, `${m.hp}HP ${m.phase}ph ${m.pole}p exproof=${exproof}`).toBe(before);
      }
    }
  });

  it("falls back to the code table when the catalogue has nothing", () => {
    for (const m of MOTORS) {
      expect(catalogueMotorPrice(m, false, null)).toBeNull();
      expect(catalogueMotorPrice(m, false, {})).toBeNull();
    }
  });

  /** An edited price must actually reach the quote — otherwise none of this works. */
  it("prefers the catalogue over the code table once a price is edited", () => {
    const m = MOTORS.find((x) => x.hp === 5 && x.phase === 3 && x.pole === 4)!;
    const raised = { ...seededPrices, [fanMotorCode(5, 3, 4)]: 25000 };
    expect(catalogueMotorPrice(m, false, raised)).toBe(25000);
    expect(motorNetPrice(m, false)).not.toBe(25000); // …and the code table is untouched
  });

  /**
   * Deleting one explosion-proof row must not drag that motor's STANDARD price
   * back to the code table as well. It falls back to the standard CATALOGUE
   * price, which is the smaller and more predictable change.
   */
  it("falls an explosion-proof row back to the standard catalogue price, not to code", () => {
    const m = MOTORS.find((x) => x.hp === 5 && x.phase === 3 && x.pole === 4)!;
    const edited = { ...seededPrices, [fanMotorCode(5, 3, 4)]: 25000 };
    delete edited[fanMotorCode(5, 3, 4, true)];
    expect(catalogueMotorPrice(m, true, edited)).toBe(25000);
  });

  it("ignores a zero or negative price rather than quoting it", () => {
    const m = MOTORS.find((x) => x.hp === 5 && x.phase === 3 && x.pole === 4)!;
    for (const bad of [0, -1]) {
      expect(catalogueMotorPrice(m, false, { ...seededPrices, [fanMotorCode(5, 3, 4)]: bad })).toBeNull();
    }
  });

  /**
   * Explosion-proof is published for 3-phase 4-pole only. Asking for it on a
   * 2-pole motor is not an EX price at zero — it is the standard motor, which is
   * what `exproofApplies` already decides and what this must keep agreeing with.
   */
  it("gives the standard price where explosion-proof is not published", () => {
    const m = MOTORS.find((x) => x.hp === 5 && x.phase === 3 && x.pole === 2)!;
    expect(catalogueMotorPrice(m, true, seededPrices)).toBe(m.price);
  });
});

/**
 * The standalone lines. Their fallback rule is the subtle one: flange falls back
 * to FOOT, because TECO offers explosion-proof, single-phase and the largest
 * three-phase frames foot-mounted only. `tecoNetPrice` has always done that, and
 * the catalogue has to do it identically or a flange line silently reprices.
 */
describe("the standalone TECO and Hyundai lines", () => {
  it("prices every TECO row exactly as the file does, for both mountings", () => {
    for (const [key, r] of Object.entries(TECO_SELLING)) {
      const section = key.split("|")[0] as "single" | "ex" | "three";
      expect(catalogueTecoPrice(section, r.hp, r.pole, "foot", seededPrices)).toBe(tecoNetPrice(r, "Foot Mounted"));
      expect(catalogueTecoPrice(section, r.hp, r.pole, "flange", seededPrices)).toBe(tecoNetPrice(r, "Flanged Mounted"));
    }
  });

  it("prices every Hyundai row exactly as the file does", () => {
    for (const [key, r] of Object.entries(HYUNDAI_SELLING)) {
      const [, pole] = key.split("|");
      expect(catalogueHyundaiPrice(r.hp, Number(pole), "foot", seededPrices)).toBe(tecoNetPrice(r, "Foot Mounted"));
      expect(catalogueHyundaiPrice(r.hp, Number(pole), "flange", seededPrices)).toBe(tecoNetPrice(r, "Flanged Mounted"));
    }
  });

  /** The rule stated outright, on a row the supplier really does sell foot-only. */
  it("falls a flange request back to the foot price where no flange is sold", () => {
    const footOnly = Object.entries(TECO_SELLING).find(([, r]) => r.flange == null)!;
    const section = footOnly[0].split("|")[0] as "single" | "ex" | "three";
    const r = footOnly[1];
    expect(catalogueTecoPrice(section, r.hp, r.pole, "flange", seededPrices)).toBe(r.foot);
  });

  it("falls back to the file when the catalogue is empty", () => {
    expect(catalogueTecoPrice("three", 5, 4, "foot", {})).toBeNull();
    expect(catalogueHyundaiPrice(5, 4, "foot", null)).toBeNull();
  });

  it("reads an edited standalone price", () => {
    const raised = { ...seededPrices, [tecoCode("three", 5, 4, "foot")]: 30000 };
    expect(catalogueTecoPrice("three", 5, 4, "foot", raised)).toBe(30000);
  });

  /** The builder stores the mounting as a label; the mapping must be one place. */
  it("maps the stored mounting label", () => {
    expect(mountingOf("Flanged Mounted")).toBe("flange");
    expect(mountingOf("Foot Mounted")).toBe("foot");
    expect(mountingOf(undefined)).toBe("foot");
    expect(mountingOf(null)).toBe("foot");
  });
});
