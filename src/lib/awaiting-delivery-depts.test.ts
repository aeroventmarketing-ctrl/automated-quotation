import { describe, expect, it } from "vitest";
import { canConfirmHold, holdRequestDepts } from "./awaiting-delivery";

describe("who may press Delivered on a held line", () => {
  const motor = { dept: "motor", itemSkus: ["CON000216", "CON000321"] };
  const fans = { dept: "fans", itemSkus: ["CON000403", "CON000216"] };

  it("finds the departments that asked for the item on its PO, by SKU", () => {
    expect(holdRequestDepts("CON000321", [motor, fans])).toEqual(["motor"]);
    expect(holdRequestDepts("con000216", [motor, fans]).sort()).toEqual(["fans", "motor"]);
  });
  it("falls back to every request on the PO when the SKU tells nothing", () => {
    expect(holdRequestDepts(null, [motor])).toEqual(["motor"]);
    expect(holdRequestDepts("CON999", [motor, fans]).sort()).toEqual(["fans", "motor"]);
    expect(holdRequestDepts("CON1", [])).toEqual([]);
  });
  it("the Warehouseman / admin confirm everything; the Motor Controller head only Motor Controller's own lines", () => {
    expect(canConfirmHold("all", [])).toBe(true);
    expect(canConfirmHold(["motor"], ["motor"])).toBe(true);
    expect(canConfirmHold(["motor"], ["motor", "fans"])).toBe(false); // shared with another department
    expect(canConfirmHold(["motor"], ["fans"])).toBe(false);
    expect(canConfirmHold(["motor"], [])).toBe(false); // request not found
    expect(canConfirmHold(["motor"], [""])).toBe(false); // no department recorded
    expect(canConfirmHold([], ["motor"])).toBe(false);
  });
});
