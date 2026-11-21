import { describe, it, expect } from "vitest";
import {
  CONTROLLER_CODE_PREFIX, DOL_HP_OPTIONS, DOL_PRICE, REDUCED_HP_OPTIONS, VFD_HP_OPTIONS, VFD_PRICE, YDELTA_PRICE, YYY_PRICE,
  controllerCatalogueRows, dolCode, starterNetPrice, vfdCode, vfdNetPrice, yDeltaCode, yyyCode,
} from "./motor-controller-prices";
import { MOTOR_CODE_PREFIX } from "./motor-catalogue";

describe("motor controller prices in the catalogue", () => {
  const rows = controllerCatalogueRows();

  it("one row per price in the tables — 36 DOL, 18 Y-Delta, 9 Y-Double Y, 17 VFD — codes unique", () => {
    expect(rows).toHaveLength(36 + 18 + 9 + 17);
    expect(new Set(rows.map((r) => r.modelCode)).size).toBe(rows.length);
  });
  it("sit inside the motors' MTR- prefix, so the shop and the website price list leave them out like motors", () => {
    for (const r of rows) {
      expect(r.modelCode.startsWith(CONTROLLER_CODE_PREFIX)).toBe(true);
      expect(r.modelCode.startsWith(MOTOR_CODE_PREFIX)).toBe(true);
    }
  });
  it("seed exactly today's table prices — a quotation prices the same the moment they are added", () => {
    const map = Object.fromEntries(rows.map((r) => [r.modelCode, r.basePrice]));
    for (const hp of DOL_HP_OPTIONS) {
      expect(starterNetPrice("DOL", 1, 220, hp, map)).toBe(DOL_PRICE.sp220[hp]);
      expect(starterNetPrice("DOL", 3, 220, hp, map)).toBe(DOL_PRICE.tp220[hp]);
      expect(starterNetPrice("DOL", 3, 400, hp, map)).toBe(DOL_PRICE.tp380400[hp]);
      expect(starterNetPrice("DOL", 3, 440, hp, map)).toBe(DOL_PRICE.tp440[hp]);
    }
    for (const hp of REDUCED_HP_OPTIONS) {
      expect(starterNetPrice("Y/Δ", 3, 220, hp, map)).toBe(YDELTA_PRICE["220"][hp]);
      expect(starterNetPrice("Y/Δ", 3, 440, hp, map)).toBe(YDELTA_PRICE["440"][hp]);
      expect(starterNetPrice("Y/YY", 3, 380, hp, map)).toBe(YYY_PRICE[hp]);
    }
    for (const hp of VFD_HP_OPTIONS) expect(vfdNetPrice(hp >= 125 ? 440 : 220, hp, map)).toBe(VFD_PRICE[hp]);
  });
  it("the owner's example: DOL · 3-phase · 220 V · 1.5 HP = ₱10,405 net (₱11,653.60 with VAT)", () => {
    expect(starterNetPrice("DOL", 3, 220, 1.5)).toBe(10405);
    expect(Math.round(10405 * 1.12 * 100) / 100).toBe(11653.6);
  });
});

describe("the catalogue price wins; the table is the fallback", () => {
  it("an edited price is used", () => {
    expect(starterNetPrice("DOL", 3, 220, 1.5, { [dolCode("tp220", 1.5)]: 11000 })).toBe(11000);
    expect(starterNetPrice("Y/Δ", 3, 440, 10, { [yDeltaCode("440", 10)]: 24000 })).toBe(24000);
    expect(starterNetPrice("Y/YY", 3, 400, 20, { [yyyCode(20)]: 31000 })).toBe(31000);
    expect(vfdNetPrice(380, 10, { [vfdCode(10)]: 50000 })).toBe(50000);
  });
  it("a missing or zeroed row prices from the table, as before", () => {
    expect(starterNetPrice("DOL", 3, 220, 1.5, {})).toBe(10405);
    expect(starterNetPrice("DOL", 3, 220, 1.5, { [dolCode("tp220", 1.5)]: 0 })).toBe(10405);
    expect(vfdNetPrice(380, 10, null)).toBe(49862);
  });
  it("a size or voltage that isn't sold has no price, whatever the catalogue says", () => {
    expect(starterNetPrice("DOL", 3, 220, 10, { [dolCode("tp220", 10)]: 1 })).toBeNull();
    expect(starterNetPrice("Y/Δ", 3, 380, 10)).toBeNull();
    expect(vfdNetPrice(220, 125)).toBeNull(); // 440 V only
  });
});
