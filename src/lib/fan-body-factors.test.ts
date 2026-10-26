import { describe, it, expect } from "vitest";
import { fanBodyFactored, fanTagOf } from "./fan-body-factors";

const round2 = (n: number) => Math.round(n * 100) / 100;
const spec = (type: string, bladeType: string) => ({ category: "Centrifugal Type", type, bladeType, drive: "Belt", material: "Black Iron Sheet" });

describe("cabinet blower body factors", () => {
  // The owner: "/0.9 - Forward Curved, /0.57 - DIDW, 0.54 - Cabinet" — the
  // cabinet is ÷0.54 on the forward-curved DIDW too, not ÷0.9.
  it("Cabinet Blower (DIDW), Forward Curved: ÷0.9 ÷0.57 ÷0.54", () => {
    const s = spec("Cabinet Blower (DIDW)", "Forward Curved");
    expect(fanTagOf(s)).toBe("CFABCAB");
    expect(round2(fanBodyFactored(22738, s))).toBe(round2(22738 / (0.9 * 0.57 * 0.54)));
    expect(round2(fanBodyFactored(22738, s))).toBe(82080.72);
  });
  it("Cabinet Blower (DIDW), Backward: ÷0.57 ÷0.54", () => {
    const s = spec("Cabinet Blower (DIDW)", "Backward Curved");
    expect(fanTagOf(s)).toBe("CEBCAB");
    expect(round2(fanBodyFactored(10000, s))).toBe(round2(10000 / (0.57 * 0.54)));
  });
});
