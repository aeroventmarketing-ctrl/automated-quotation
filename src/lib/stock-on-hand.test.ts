/**
 * What the Purchasing row says the warehouse has.
 *
 * The owner: *"In purchasing pending and approved tab, show the available
 * quantity in each row. Get the details in inventory tab. For example if
 * Induction Motor 5.5HP, 3PH or SKU CAT00182 show 0 in stock if no stock is
 * available or 2 in stock if 2 items is available."*
 *
 * The lines are the ones from that screenshot (MRF #0441), spelled as the
 * requisition stores them — qty, unit, `·`, then the description with whatever
 * the requestor typed after it.
 */
import { describe, it, expect } from "vitest";
import { buildOnHandIndex, onHandFor, EMPTY_ON_HAND_INDEX } from "./stock-on-hand";

const MOTOR = "INDUCTION MOTOR 5.5 HP , 3 PH 4KW (HYUNDAI)";
const inventory = [
  { name: "INDUCTION MOTOR 5.5 HP , 3 PH 4KW", sku: "CAT00182", unit: "pc", available: 2 },
  { name: "PULLEY 3 1/2\"Ø x 2B BIG HUB", sku: "CON000549", unit: "pc", available: 0 },
  { name: "FLANGE BEARING UCF-208", sku: "CON000325", unit: "pc", available: 18 },
];

describe("the quantity beside a request line", () => {
  const index = buildOnHandIndex(inventory);

  it("finds the item by its code, whatever the line says", () => {
    expect(onHandFor("ANYTHING AT ALL", "CAT00182", index)).toMatchObject({ available: 2, unit: "pc" });
    expect(onHandFor("anything", " cat00182 ", index)).toMatchObject({ available: 2 });
  });

  it("finds it by name when the line carries no code", () => {
    // The requestor's "(HYUNDAI)" is peeled, exactly as the SKU chip peels it.
    expect(onHandFor(MOTOR, null, index)).toMatchObject({ available: 2, unit: "pc" });
  });

  it("says 0 for an item that is on the list with none left", () => {
    expect(onHandFor("PULLEY 3 1/2\"Ø x 2B BIG HUB", null, index)?.available).toBe(0);
  });

  it("says nothing — not zero — for an item inventory has never heard of", () => {
    // The difference the badge keeps: null is "we were never asked", 0 is "we
    // looked, and there are none". Collapsing them would invent an answer.
    expect(onHandFor("PULLEY 8\"Ø x 2B BIG HUB", "CON000580", index)).toBeNull();
  });

  it("has no answers at all when no inventory was loaded", () => {
    expect(onHandFor(MOTOR, "CAT00182", EMPTY_ON_HAND_INDEX)).toBeNull();
    expect(onHandFor(MOTOR, "CAT00182", buildOnHandIndex([]))).toBeNull();
  });
});

describe("the same item in more than one place", () => {
  // One bolt, two bins: 40 in the Plant Warehouse and 12.5 in the Office. The
  // row has no space to say where, and "how many do we have" is one number.
  const index = buildOnHandIndex([
    { name: "G.I. BOLT 3/8\"Ø x 1\"", sku: "CON000111", unit: "pc", available: 40 },
    { name: "G.I. BOLT 3/8\"Ø x 1\"", sku: "CON000111", unit: "pc", available: 12.5 },
  ]);

  it("adds the locations up, and says how many there were", () => {
    expect(onHandFor("G.I. BOLT 3/8\"Ø x 1\"", null, index)).toMatchObject({ available: 52.5, unit: "pc", places: 2 });
  });
});

describe("an availability that was never computed", () => {
  /**
   * `listStockItemsWithAvailability` always computes one, but the type allows
   * absent and the difference matters: an unknown quantity summed in as zero
   * would report "0 in stock" for an item nobody counted.
   */
  const index = buildOnHandIndex([
    { name: "ANGLE BAR 2.0 X 25 X 25", sku: "CON000900", unit: "pc" },
    { name: "ANGLE BAR 2.0 X 25 X 25", sku: "CON000900", unit: "pc", available: 6 },
  ]);

  it("is left out rather than counted as none", () => {
    expect(onHandFor("ANGLE BAR 2.0 X 25 X 25", null, index)).toMatchObject({ available: 6, places: 1 });
  });

  it("leaves an item with no counted record unanswered", () => {
    expect(onHandFor("WELDING ROD 6013", "CON000901", buildOnHandIndex([{ name: "WELDING ROD 6013", sku: "CON000901" }]))).toBeNull();
  });
});

describe("the code wins over the name", () => {
  /**
   * Two bins can carry the same words. The code is the line's recorded
   * identity — written when the line was composed — so an exact code hit must
   * not be overruled by a name that merely looks similar.
   */
  const index = buildOnHandIndex([
    { name: "MOTOR PULLEY", sku: "AAA111", unit: "pc", available: 3 },
    { name: "MOTOR PULLEY SPARE", sku: "BBB222", unit: "pc", available: 99 },
  ]);

  it("answers from the code when the line has one", () => {
    expect(onHandFor("MOTOR PULLEY", "BBB222", index)?.available).toBe(99);
  });

  it("falls back to the name when the code matches nothing", () => {
    expect(onHandFor("MOTOR PULLEY", "NOT-A-CODE", index)?.available).toBe(3);
  });
});
