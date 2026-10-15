import { describe, it, expect } from "vitest";
import { ackFormState } from "./ack-form";

const doc = [{ path: "sales/x/af.pdf", name: "af.pdf", uploadedAt: "" }];

describe("Acknowledgement Form uploaded", () => {
  it("on a VAT-exclusive order's closing documents", () => {
    expect(ackFormState("EXCLUSIVE", { or_cr_af: doc })).toBe("signed");
  });
  it("on one of its delivery batches", () => {
    expect(ackFormState("EXCLUSIVE", {}, [{ docs: {} }, { docs: { or_cr_af: doc } }])).toBe("signed");
  });
  it("not on a cancelled batch", () => {
    expect(ackFormState("EXCLUSIVE", {}, [{ docs: { or_cr_af: doc }, cancelled: true }])).toBeNull();
  });
  it("only the unsigned copy", () => {
    expect(ackFormState("EXCLUSIVE", { unsigned_or_cr_af: doc })).toBe("unsigned");
  });
  it("none yet", () => {
    expect(ackFormState("EXCLUSIVE", { sales_invoice: doc })).toBeNull();
  });
  it("a VAT-inclusive order's slot is the Collection Receipt, not an Acknowledgement Form", () => {
    expect(ackFormState("INCLUSIVE", { or_cr_af: doc })).toBeNull();
    expect(ackFormState("EXCLUSIVE_PLUS", { or_cr_af: doc })).toBeNull();
    expect(ackFormState("ZERO_RATED", { or_cr_af: doc })).toBeNull();
  });
});
