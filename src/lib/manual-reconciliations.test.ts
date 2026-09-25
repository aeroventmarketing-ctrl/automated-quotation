/**
 * One purchase order, one row.
 *
 * The owner, on the Unreconciled PO list: *"List shows multiple same PO's. When
 * reconciling it returns to unreconciled"* — `PO-AFBM20260000797` appearing four
 * times, each at the combined total ₱44,845.98.
 *
 * A combined PO stores the identical `po` JSON on EVERY member PurchaseRequest
 * (see `lib/purchase-batch`), so a loop over requests reports one PO as many. And
 * `recordReconciliation` writes its record to a single member, so the unreconciled
 * siblings kept the PO in the backlog — which reads as the reconciliation not
 * sticking.
 *
 * Runs against a real Postgres, skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/lib/manual-reconciliations
 */
import { describe, it, expect, beforeEach } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { getUnreconciledCounts, getManualReconciliations } = await import("./manual-reconciliations");

const BATCH = "batch-797";
const po = (batched: boolean) => ({
  poNumber: "PO-AFBM20260000797",
  supplier: { company: "METAL EXPONENT INC." },
  lines: [{ description: "GI SHEET", qty: "10", unit: "pc", unitPrice: "4484.598" }],
  ...(batched ? { batchId: BATCH, memberPrIds: ["m1", "m2", "m3", "m4"] } : {}),
});

/** A hand-recorded reconciliation — the shape `isReconciled` accepts. */
const recorded = {
  vatMode: "inclusive",
  lines: [{ description: "GI SHEET", qty: "10", poAmount: 44845.98, actualAmount: 44845.98 }],
  recordedByName: "Michelle Cotura",
  recordedRole: "Accounting",
  recordedAt: "2026-09-25T09:00:00.000Z",
  aiVerified: false,
};

async function members(count: number, opts: { batched: boolean; reconciledIndex?: number }) {
  // These readers scan EVERY purchase request, so the table is the fixture.
  await prisma.purchaseRequest.deleteMany({});
  for (let i = 0; i < count; i++) {
    await prisma.purchaseRequest.create({
      data: {
        kind: "order", dept: "office", status: "PURCHASED", note: "TEST-BATCH",
        items: ["10 pc · GI SHEET"],
        po: po(opts.batched) as never,
        ...(opts.reconciledIndex === i ? { reconciliation: recorded as never } : {}),
        createdById: "test-user", createdByName: "Joemel Jamero",
        createdAt: new Date(Date.UTC(2026, 8, 19 + i, 3, 0, 0)),
      },
    });
  }
}

run("a combined PO in the unreconciled list", () => {
  beforeEach(async () => {
    await prisma.purchaseRequest.deleteMany({});
  });

  it("is ONE row and counts ONCE, however many requests it covers", async () => {
    await members(4, { batched: true });
    const { pos, poRows } = await getUnreconciledCounts();
    expect(pos).toBe(1);
    expect(poRows).toHaveLength(1);
    expect(poRows[0].ref).toBe("PO-AFBM20260000797");
    // The total is the PO's, not four times the PO's. (₱44,845.98 gross less
    // ₱400.41 EWT — `poTotals().net` is what the tile shows.)
    expect(poRows[0].amount).toBeCloseTo(44445.57, 2);
    // The failure this guards: four members, four times the money.
    expect(poRows[0].amount).toBeLessThan(44845.98 * 2);
    expect(poRows[0].detail).toContain("4 requests on this PO");
  });

  /** The age of a backlog entry is how long the need has waited — its first request. */
  it("dates the row from the OLDEST request on the PO", async () => {
    await members(4, { batched: true });
    const { poRows } = await getUnreconciledCounts();
    expect(poRows[0].raisedAtISO.slice(0, 10)).toBe("2026-09-19");
  });

  /**
   * The second half of the report. `recordReconciliation` writes to ONE member,
   * so the PO must leave the backlog on that alone — otherwise reconciling looks
   * like it did nothing.
   */
  it("leaves the backlog when ANY member is reconciled", async () => {
    await members(4, { batched: true, reconciledIndex: 2 });
    const { pos, poRows } = await getUnreconciledCounts();
    expect(pos).toBe(0);
    expect(poRows).toEqual([]);
  });

  /** …including when the reconciled member is the last one seen. */
  it("leaves the backlog even when the reconciled member comes last", async () => {
    await members(4, { batched: true, reconciledIndex: 3 });
    expect((await getUnreconciledCounts()).pos).toBe(0);
  });

  it("appears once, not four times, in the hand-tallied list", async () => {
    await members(4, { batched: true, reconciledIndex: 0 });
    const rows = (await getManualReconciliations()).filter((r) => r.ref === "PO-AFBM20260000797");
    expect(rows).toHaveLength(1);
  });

  /**
   * Separate POs must never merge. Without a batch id the key falls back to the
   * request's own id, so four unrelated requests that happen to share a PO number
   * stay four rows — a data error to surface, not to hide.
   */
  it("does not merge requests that only share a PO number", async () => {
    await members(4, { batched: false });
    const { pos, poRows } = await getUnreconciledCounts();
    expect(pos).toBe(4);
    expect(poRows).toHaveLength(4);
    expect(poRows.every((r) => !r.detail.includes("requests on this PO"))).toBe(true);
  });

  it("says nothing extra when a PO really is one request", async () => {
    await members(1, { batched: true });
    const { poRows } = await getUnreconciledCounts();
    expect(poRows).toHaveLength(1);
    expect(poRows[0].detail).not.toContain("requests on this PO");
  });
});

/**
 * The write side, now that `recordReconciliation` fans out across the batch.
 *
 * These assert the INVARIANT rather than the action (the action needs a signed-in
 * user with a workflow role): after a reconciliation lands on a combined PO,
 * **every member row carries it**. That is what makes every other reader — the
 * purchasing chain, the reports, the order page — agree with these lists.
 */
run("a reconciliation on a combined PO", () => {
  beforeEach(async () => {
    await prisma.purchaseRequest.deleteMany({});
  });

  it("reaches every member, so no sibling still reads as unreconciled", async () => {
    await members(4, { batched: true });
    const all = await prisma.purchaseRequest.findMany({ select: { id: true, po: true } });
    const ids = all.map((r) => r.id);

    // What writeReconciliation does: one write across the whole batch.
    await prisma.purchaseRequest.updateMany({
      where: { id: { in: ids } },
      data: { reconciliation: recorded as never },
    });

    const after = await prisma.purchaseRequest.findMany({ select: { reconciliation: true } });
    expect(after).toHaveLength(4);
    expect(after.every((r) => (r.reconciliation as { recordedAt?: string } | null)?.recordedAt)).toBe(true);
    expect((await getUnreconciledCounts()).pos).toBe(0);
  });

  /**
   * The bug as it was: the record on one member only. The list survives it now
   * (a PO is handled if ANY member is), which is why the display fix shipped
   * first — but the rows disagreeing with each other is what this change ends.
   */
  it("was inconsistent when only one member was written", async () => {
    await members(4, { batched: true, reconciledIndex: 1 });
    const after = await prisma.purchaseRequest.findMany({ select: { reconciliation: true } });
    const carried = after.filter((r) => (r.reconciliation as { recordedAt?: string } | null)?.recordedAt).length;
    expect(carried).toBe(1); // ← what the old write produced
    // The reader tolerates it, which is why the symptom is gone either way.
    expect((await getUnreconciledCounts()).pos).toBe(0);
  });
});
