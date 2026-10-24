import { describe, it, expect } from "vitest";
import { ewtAllowed, paymentKindsFor, newEwtOnExclusive } from "./sale";
import { counterDocSlots } from "./counter-sale";

/**
 * The owner: *"1. VAT Zero Rated - No VAT but can deduct EWT. 2. VAT Exclusive -
 * NO VAT and cannot deduct EWT."*
 */
describe("EWT (BIR 2307) — not on VAT Exclusive", () => {
  it("every mode but VAT Exclusive may have EWT withheld", () => {
    expect(ewtAllowed("ZERO_RATED")).toBe(true);
    expect(ewtAllowed("INCLUSIVE")).toBe(true);
    expect(ewtAllowed("EXCLUSIVE_PLUS")).toBe(true);
    expect(ewtAllowed("EXCLUSIVE")).toBe(false);
  });
  it("VAT Exclusive offers no 'EWT withheld' payment", () => {
    expect(paymentKindsFor("EXCLUSIVE")).not.toContain("ewt");
    expect(paymentKindsFor("ZERO_RATED")).toContain("ewt");
  });
  it("a save adding EWT to a VAT Exclusive sale is refused; one already on record is left alone", () => {
    expect(newEwtOnExclusive("EXCLUSIVE", [{ id: "a", kind: "ewt" }], [])).toMatch(/can't have EWT/);
    expect(newEwtOnExclusive("EXCLUSIVE", [{ id: "a", kind: "ewt" }], [{ id: "a", kind: "ewt" }])).toBeNull();
    expect(newEwtOnExclusive("EXCLUSIVE", [{ id: "a", kind: "down" }], [])).toBeNull();
    expect(newEwtOnExclusive("ZERO_RATED", [{ id: "a", kind: "ewt" }], [])).toBeNull();
  });
  it("a VAT Exclusive counter sale asks for no BIR 2307; zero-rated still requires it", () => {
    expect(counterDocSlots("EXCLUSIVE").map((s) => s.key)).not.toContain("bir_2307");
    expect(counterDocSlots("ZERO_RATED").find((s) => s.key === "bir_2307")?.optional).toBe(false);
  });
});
