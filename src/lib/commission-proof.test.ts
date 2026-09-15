import { describe, it, expect } from "vitest";
import {
  canAttachCommissionProof,
  canViewCommissionProof,
  cleanProofName,
  coerceProofDocs,
  editProofDocs,
  MAX_PROOF_DOCS,
  MAX_PROOF_NAME,
  proofPathPrefix,
  proofTargets,
  salespersonIdFromProofPath,
  type CommissionProofDoc,
  type ProofTarget,
} from "./commission-proof";

/**
 * Proof of payment: the slip behind a payout.
 *
 * The owner: *"add an option to attach proof of payment to sales personnel for
 * accounting, payment approver and admin. Proof of payment must be viewable by
 * sales account holder."* Two different sentences — one about a job, one about a
 * relationship — and the difference is the whole rule.
 */
describe("who may attach a proof", () => {
  const seats = [
    ["Admin", { admin: true, workflowRoles: [] }],
    ["Accounting", { admin: false, workflowRoles: ["accounting"] }],
    ["Payment Approver", { admin: false, workflowRoles: ["payment_approver"] }],
  ] as const;

  for (const [who, viewer] of seats) {
    it(`${who} may`, () => expect(canAttachCommissionProof(viewer)).toBe(true));
  }

  it("a salesperson may not — it is evidence about them, not from them", () => {
    expect(canAttachCommissionProof({ admin: false, workflowRoles: [] })).toBe(false);
    expect(canAttachCommissionProof({ admin: false, workflowRoles: ["sales_head"] })).toBe(false);
  });

  it("nor may anyone else who happens to be around", () => {
    for (const r of ["warehouse", "purchaser", "plant_manager", "logistics"]) {
      expect(canAttachCommissionProof({ admin: false, workflowRoles: [r] }), r).toBe(false);
    }
  });
});

describe("who may open one", () => {
  const path = `${proofPathPrefix("rep-1")}1758000000000-1.pdf`;

  it("the payee opens the proof of their own payment", () => {
    expect(canViewCommissionProof({ id: "rep-1", admin: false, workflowRoles: [] }, path)).toBe(true);
  });

  /** The requirement's other half, and the one a role check would have missed. */
  it("another salesperson does not", () => {
    expect(canViewCommissionProof({ id: "rep-2", admin: false, workflowRoles: [] }, path)).toBe(false);
  });

  it("the three seats that attach can also read", () => {
    expect(canViewCommissionProof({ id: "acct-1", admin: false, workflowRoles: ["accounting"] }, path)).toBe(true);
    expect(canViewCommissionProof({ id: "pa-1", admin: false, workflowRoles: ["payment_approver"] }, path)).toBe(true);
    expect(canViewCommissionProof({ id: "admin-1", admin: true, workflowRoles: [] }, path)).toBe(true);
  });

  /**
   * The permission is read out of the PATH, not out of a record that points at
   * it — so a wrong record cannot serve a file to the wrong person.
   */
  it("a path that names nobody belongs to nobody", () => {
    expect(salespersonIdFromProofPath("sales/q1/po.pdf")).toBeNull();
    expect(canViewCommissionProof({ id: "rep-1", admin: false, workflowRoles: [] }, "sales/q1/po.pdf")).toBe(false);
    expect(canViewCommissionProof({ id: "rep-1", admin: false, workflowRoles: [] }, "commissions/")).toBe(false);
  });

  it("and a near-miss id is still a miss", () => {
    expect(canViewCommissionProof({ id: "rep-10", admin: false, workflowRoles: [] }, path)).toBe(false);
  });
});

describe("which commissions a proof attaches to", () => {
  const d = (over: Partial<ProofTarget> = {}): ProofTarget => ({
    salespersonId: "rep-1", paid: false, receivedAt: null, payableNow: false, ...over,
  });

  it("the payout in flight: released, or about to be", () => {
    const rows = [d({ paid: true }), d({ payableNow: true })];
    expect(proofTargets("rep-1", rows)).toHaveLength(2);
  });

  it("not a payout the payee has already signed for", () => {
    expect(proofTargets("rep-1", [d({ paid: true, receivedAt: "2026-09-15T00:00:00Z" })])).toHaveLength(0);
  });

  it("not a commission that is neither paid nor due", () => {
    expect(proofTargets("rep-1", [d()])).toHaveLength(0);
  });

  it("never somebody else's", () => {
    expect(proofTargets("rep-1", [d({ salespersonId: "rep-2", paid: true })])).toHaveLength(0);
  });
});

describe("reading the stored JSON", () => {
  it("keeps what it can and drops what it can't", () => {
    const docs = coerceProofDocs([
      { path: "commissions/rep-1/a.pdf", name: "slip.pdf", uploadedAt: "2026-09-15T00:00:00Z", uploadedById: "acct-1", uploadedByName: "Michelle" },
      { name: "no path" },
      null,
      "nonsense",
    ]);
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe("slip.pdf");
  });

  it("an empty or broken column is simply no proof", () => {
    expect(coerceProofDocs(null)).toEqual([]);
    expect(coerceProofDocs({})).toEqual([]);
    expect(coerceProofDocs([])).toEqual([]);
  });

  it("a file with no name is still openable", () => {
    expect(coerceProofDocs([{ path: "commissions/rep-1/a.pdf" }])[0].name).toBe("proof");
  });
});

/**
 * *"Add an option to delete, replace and edit the attached file."*
 *
 * Null everywhere below means "this row didn't move" — not a failure. One edit
 * is fanned across every row of a voucher, and those rows are not all in the
 * same state.
 */
describe("editing an attached file", () => {
  const doc = (path: string, name = path): CommissionProofDoc => ({
    path, name, uploadedAt: "2026-09-15T00:00:00Z", uploadedById: "acct-1", uploadedByName: "Michelle",
  });
  const a = doc("commissions/rep-1/a.pdf", "slip.pdf");
  const b = doc("commissions/rep-1/b.pdf", "screenshot.png");

  describe("add", () => {
    it("appends", () => {
      expect(editProofDocs([a], { op: "add", doc: b })).toEqual([a, b]);
    });
    it("is idempotent — the same file twice is one file", () => {
      expect(editProofDocs([a], { op: "add", doc: a })).toBeNull();
    });
    it("stops at the cap", () => {
      const full = Array.from({ length: MAX_PROOF_DOCS }, (_, i) => doc(`commissions/rep-1/${i}.pdf`));
      expect(editProofDocs(full, { op: "add", doc: b })).toBeNull();
    });
  });

  describe("delete", () => {
    it("takes only the one named", () => {
      expect(editProofDocs([a, b], { op: "remove", path: a.path })).toEqual([b]);
    });
    it("a file that isn't here doesn't move this row", () => {
      expect(editProofDocs([a], { op: "remove", path: b.path })).toBeNull();
    });
  });

  describe("replace", () => {
    /** The list is read top to bottom; a swap must not reshuffle it. */
    it("puts the new file where the old one was", () => {
      const c = doc("commissions/rep-1/c.pdf", "corrected slip.pdf");
      expect(editProofDocs([a, b], { op: "replace", path: a.path, doc: c })).toEqual([c, b]);
    });
    it("never leaves the same file listed twice", () => {
      expect(editProofDocs([a, b], { op: "replace", path: a.path, doc: b })).toEqual([b]);
    });
    it("replaces nothing when the old file is gone", () => {
      expect(editProofDocs([b], { op: "replace", path: a.path, doc: a })).toBeNull();
    });
  });

  describe("rename", () => {
    it("changes the label and nothing else", () => {
      const out = editProofDocs([a, b], { op: "rename", path: a.path, name: "BDO deposit 09-15" })!;
      expect(out[0]).toEqual({ ...a, name: "BDO deposit 09-15" });
      expect(out[1]).toBe(b);
    });
    it("an unchanged name is not a change", () => {
      expect(editProofDocs([a], { op: "rename", path: a.path, name: "slip.pdf" })).toBeNull();
    });
    it("a blank name is refused — a file with no label can't be told apart", () => {
      expect(editProofDocs([a], { op: "rename", path: a.path, name: "   " })).toBeNull();
    });
  });
});

describe("the label a file is read by", () => {
  it("collapses whitespace and control characters", () => {
    expect(cleanProofName("  BDO\tslip\n\n 09-15 ")).toBe("BDO slip 09-15");
  });
  it("is bounded", () => {
    expect(cleanProofName("x".repeat(500))).toHaveLength(MAX_PROOF_NAME);
  });
  it("and an empty one stays empty, so the caller can refuse it", () => {
    expect(cleanProofName("   ")).toBe("");
  });
});
