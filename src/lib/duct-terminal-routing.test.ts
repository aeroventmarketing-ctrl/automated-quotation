/**
 * Which department fabricates a Weather hood.
 *
 * The owner, on ACCE-JO2600095: *"Weather hood shows in Accessories JO. It
 * should appear in Duct Department JO."*
 *
 * A weather hood is a Ventilation Accessory by taxonomy (group "Air Terminals"),
 * and everything in that category fell through to the Accessories job order
 * unless it was named as duct work — only the eight Air Duct types and the
 * dampers were. What matters as much as the move is what did NOT move with it:
 * grilles, diffusers and louvers are Air Terminals too and stay where they are.
 */
import { describe, it, expect } from "vitest";
import { buildAutoJobOrders, quotationJobOrderDepts, type QuoteItemLike } from "./job-order-autogen";
import { isDuctTerminalType } from "./duct-job-order";
import { ACCESSORY_TYPE_SUGGESTIONS } from "./accessories-job-order";

const line = (type: string, over: Record<string, unknown> = {}): QuoteItemLike => ({
  qty: 4,
  descriptionSnapshot: type,
  specsSnapshot: {
    category: "Ventilation Accessories",
    type,
    sizeL: "250",
    sizeW: "250",
    sizeUnit: "mm",
    material: "Galvanized Iron",
    ...over,
  },
});
const build = (items: QuoteItemLike[]) => buildAutoJobOrders(items, { project: "P", date: "2026-10-05" });

describe("a Weather hood is the Duct department's", () => {
  it("generates a Duct job order, not an Accessories one", () => {
    const { duct, accessories } = build([line("Weather hood")]);
    expect(accessories).toHaveLength(0);
    expect(duct).toHaveLength(1);
    expect(duct[0].segments).toHaveLength(1);
  });

  it("carries its size, material and quantity onto the duct segment", () => {
    const seg = build([line("Weather hood")])[ "duct" ][0].segments[0];
    expect(seg).toMatchObject({
      type: "Weather hood",
      quantity: "4",
      uom: "pc",
      horizontal: "250",
      vertical: "250",
      unit: "mm",
      // No run length: a hood is sized, not a length of duct — same as a damper.
      length: "",
    });
    expect(seg.material).toMatch(/G/);
  });

  it("marks the order as needing the duct department and not accessories", () => {
    expect(quotationJobOrderDepts([line("Weather hood")])).toMatchObject({ duct: true, accessories: false });
  });

  it("is not offered on the Accessories panel, so it cannot be put back by hand", () => {
    expect(ACCESSORY_TYPE_SUGGESTIONS).not.toContain("Weather hood");
    expect(isDuctTerminalType("Weather hood")).toBe(true);
    expect(isDuctTerminalType(" weather hood ")).toBe(false); // exact type names only
  });
});

/**
 * The blast radius. These are the neighbours of a Weather hood in the taxonomy,
 * and every one of them must be exactly where it was.
 */
describe("nothing else moved", () => {
  it.each(["Grille", "Diffuser", "Louver"])("%s stays an Accessories line", (type) => {
    const { duct, accessories } = build([line(type)]);
    expect(duct).toHaveLength(0);
    expect(accessories).toHaveLength(1);
    expect(accessories[0].lines[0].type).toBe(type);
  });

  it("a damper is still the Duct department's", () => {
    const { duct, accessories } = build([line("Volume Damper")]);
    expect(accessories).toHaveLength(0);
    expect(duct[0].segments[0].type).toBe("Volume Damper");
  });

  it("an Air Duct type is still a duct run, with its length", () => {
    const { duct } = build([line("Straight Duct", { ductCalcWidth: "300", ductCalcLength: "200", ductCalcHeight: "1000" })]);
    expect(duct[0].segments[0].type).toBe("Straight Duct");
  });

  it("puts a hood and a grille on the job order each belongs to", () => {
    const { duct, accessories } = build([line("Weather hood"), line("Grille")]);
    expect(duct[0].segments.map((s) => s.type)).toEqual(["Weather hood"]);
    expect(accessories[0].lines.map((l) => l.type)).toEqual(["Grille"]);
  });
});
