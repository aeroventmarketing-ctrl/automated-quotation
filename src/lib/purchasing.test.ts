import { describe, it, expect } from "vitest";
import { isDeptRequisition, DEPT_REQUISITION_WHERE, DEPT_REQUISITION_KIND } from "./purchasing";

/**
 * One rule, two spellings — a predicate for rows already in memory and a Prisma
 * filter for rows still in the database. They drifted once, and the drift was
 * invisible until a user pressed a button:
 *
 *   the order page ticked "Purchaser bought the goods" with `isDeptRequisition`
 *   (kind "department" OR mrfId set), while `notifyClientBoughtInOrder` counted
 *   only `kind: "department"`. An MRF-escalated request — which carries `mrfId`
 *   and the schema DEFAULT kind "order" — satisfied the tick and was invisible
 *   to the server. Button enabled, server refused, reason masked by Next.js.
 *
 * So both spellings are asserted over the same truth table.
 */
describe("a department / material requisition", () => {
  const CASES: { label: string; kind: string | null; mrfId: string | null; isDept: boolean }[] = [
    { label: "raised by a department", kind: "department", mrfId: null, isDept: true },
    { label: "escalated from an MRF — kind stays at the schema default", kind: "order", mrfId: "mrf1", isDept: true },
    { label: "an MRF escalation that is also marked department", kind: "department", mrfId: "mrf1", isDept: true },
    { label: "a plain order-linked request", kind: "order", mrfId: null, isDept: false },
    { label: "a replenishment", kind: "replenishment", mrfId: null, isDept: false },
  ];

  /** Evaluate the Prisma fragment the way Postgres would, for these two fields. */
  const matchesWhere = (pr: { kind: string | null; mrfId: string | null }) =>
    DEPT_REQUISITION_WHERE.OR.some((c) =>
      "kind" in c ? pr.kind === c.kind : pr.mrfId !== null,
    );

  for (const { label, kind, mrfId, isDept } of CASES) {
    it(`${label} → ${isDept ? "counts" : "does not count"}`, () => {
      expect(isDeptRequisition({ kind, mrfId })).toBe(isDept);
      // …and the database filter agrees. This is the assertion that would have
      // failed while the two were out of step.
      expect(matchesWhere({ kind, mrfId })).toBe(isDept);
    });
  }

  it("keeps the two spellings structurally identical", () => {
    // A third condition added to one side and not the other is the failure mode;
    // pin the shape, not just the outcomes.
    expect(DEPT_REQUISITION_WHERE.OR).toHaveLength(2);
    expect(DEPT_REQUISITION_WHERE.OR).toContainEqual({ kind: DEPT_REQUISITION_KIND });
    expect(DEPT_REQUISITION_WHERE.OR).toContainEqual({ mrfId: { not: null } });
  });

  it("treats a missing kind as not a department requisition", () => {
    expect(isDeptRequisition({})).toBe(false);
    expect(isDeptRequisition({ kind: null, mrfId: null })).toBe(false);
  });
});
