import { describe, it, expect } from "vitest";
import { ackFormState, ackVerdict, ackFormFiles, ackAiState, coerceAckChecks, type AckCheck } from "./ack-form";

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


describe("AI check — is it really an Acknowledgement Form?", () => {
  it("an Acknowledgement Form or Acknowledgement Receipt passes", () => {
    expect(ackVerdict("acknowledgement_form", 0.9)).toBe("ack");
    expect(ackVerdict("acknowledgement_receipt", 0.9)).toBe("ack");
  });
  it("anything else is flagged", () => {
    expect(ackVerdict("sales_invoice", 0.95)).toBe("not_ack");
    expect(ackVerdict("collection_receipt", 0.95)).toBe("not_ack");
    expect(ackVerdict("other", 0.8)).toBe("not_ack");
  });
  it("an unsure read is neither", () => {
    expect(ackVerdict("acknowledgement_form", 0.5)).toBe("unclear");
    expect(ackVerdict("sales_invoice", 0.5)).toBe("unclear");
    expect(ackVerdict(null, 0.99)).toBe("unclear");
  });

  const check = (verdict: AckCheck["verdict"]): AckCheck => ({ verdict, kind: null, titleSeen: null, confidence: 0.9, reason: null, checkedAt: "", checkedByName: "" });
  const files = ackFormFiles(
    "EXCLUSIVE",
    { or_cr_af: [{ path: "a", name: "a.jpg", uploadedAt: "" }] },
    [{ drNumber: "DR-2", docs: { unsigned_or_cr_af: [{ path: "b", name: "b.jpg", uploadedAt: "" }] } }, { cancelled: true, docs: { or_cr_af: [{ path: "c", name: "c.jpg", uploadedAt: "" }] } }],
  );
  it("lists the order's and live batches' files", () => {
    expect(files).toEqual([
      { path: "a", name: "a.jpg", signed: true },
      { path: "b", name: "b.jpg", signed: false, batch: "DR-2" },
    ]);
    expect(ackFormFiles("INCLUSIVE", { or_cr_af: [{ path: "a", name: "a", uploadedAt: "" }] })).toEqual([]);
  });
  it("the order's state: one wrong file flags it; all confirmed verifies it", () => {
    expect(ackAiState(files, {})).toBe("unchecked");
    expect(ackAiState(files, { a: check("ack") })).toBe("unchecked");
    expect(ackAiState(files, { a: check("ack"), b: check("unclear") })).toBe("unclear");
    expect(ackAiState(files, { a: check("ack"), b: check("not_ack") })).toBe("flagged");
    expect(ackAiState(files, { a: check("ack"), b: check("ack") })).toBe("verified");
    expect(ackAiState([], {})).toBeNull();
  });
  it("stored checks survive a round trip; junk is dropped", () => {
    const stored = { a: { ...check("not_ack"), kind: "sales_invoice", titleSeen: "SALES INVOICE" }, b: { verdict: "maybe" }, c: null };
    const back = coerceAckChecks(JSON.parse(JSON.stringify(stored)));
    expect(Object.keys(back)).toEqual(["a"]);
    expect(back.a).toMatchObject({ verdict: "not_ack", kind: "sales_invoice", titleSeen: "SALES INVOICE" });
  });
});
