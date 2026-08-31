/**
 * The record of decided catalogue requests.
 *
 * Owner's gap, and the reason this exists: the pending card shows a request only
 * while it is still waiting. The moment the last signature lands the request
 * applies and the card disappears, so the completed record of who approved what
 * was visible only in the window before it stopped mattering.
 *
 * Nothing new is stored — these check that the rows already on disk are read
 * back correctly, and that the trail reads the SAME as it did while pending.
 *
 * Add --no-file-parallelism when running several DB-backed suites at once: they
 * share one database and truncate the same tables between tests.
 *
 * Runs against a real Postgres, skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/lib/approval-history
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { getApprovalHistory } = await import("./approval-history");

const T = (h: number) => new Date(Date.UTC(2026, 7, 31, h, 0, 0));

run("the approval history", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.stockAction.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.stockItem.deleteMany({});
    await prisma.productChange.deleteMany({});
    await prisma.product.deleteMany({});
  });

  const applied = async (over = {}) => {
    const i = await prisma.stockItem.create({ data: { name: "BELT B-50", unit: "pc", quantity: 10 } });
    return prisma.stockAction.create({ data: {
      stockItemId: i.id, itemName: i.name, kind: "ADJUST", payload: {},
      summary: "Receive +6 pc · BELT B-50", status: "APPLIED",
      proposedById: "wh", proposedByName: "Willy Ho", proposedRole: "warehouse", proposedAt: T(1),
      warehouseByName: "Willy Ho", warehouseAt: T(1),
      purchaserByName: "Allan Ramos", purchaserAt: T(2),
      approverByName: "Rey Gil", approverAt: T(3), appliedAt: T(3),
      ...over,
    } });
  };

  it("keeps the whole signature trail after the request has applied", async () => {
    await applied();
    const [r] = await getApprovalHistory();
    expect(r.outcome).toBe("applied");
    expect(r.title).toBe("BELT B-50");
    expect(r.raisedBy).toMatchObject({ name: "Willy Ho", designation: "Warehouseman" });
    expect(r.steps.map((s) => [s.designation, s.name, s.signed])).toEqual([
      ["Purchaser", "Allan Ramos", true],
      ["Admin / Payment Approver", "Rey Gil", true],
    ]);
    expect(r.steps[1].at).toBe(T(3).toISOString());
  });

  // The same helper the pending card uses, so a Purchaser's request has no
  // Warehouse line in the record either — the chain never took that step.
  it("omits a step the chain never took", async () => {
    await applied({ proposedRole: "purchaser", proposedByName: "Allan Ramos", warehouseByName: null, warehouseAt: null });
    const [r] = await getApprovalHistory();
    expect(r.raisedBy.designation).toBe("Purchaser");
    expect(r.steps.map((s) => s.designation)).toEqual(["Admin / Payment Approver"]);
  });

  it("records a rejection with its reason and who gave it", async () => {
    await applied({
      status: "REJECTED", appliedAt: null, approverByName: null, approverAt: null,
      rejectedByName: "Rey Gil", rejectedAt: T(4), rejectReason: "Wrong quantity",
    });
    const [r] = await getApprovalHistory();
    expect(r.outcome).toBe("rejected");
    expect(r.rejectReason).toBe("Wrong quantity");
    expect(r.steps.at(-1)).toMatchObject({ designation: "Rejected by", name: "Rey Gil" });
  });

  it("carries product changes in the same record, newest first", async () => {
    await applied();
    await prisma.productChange.create({ data: {
      productName: "GI SHEET 24GA", kind: "UPDATE", payload: {}, summary: "Edit GI SHEET 24GA: price 850",
      status: "APPLIED", proposedById: "pu", proposedByName: "Allan Ramos", proposedAt: T(5),
      decidedByName: "Rey Gil", decidedAt: T(6),
    } });
    const rows = await getApprovalHistory();
    expect(rows.map((r) => r.sourceLabel)).toEqual(["Products", "Inventory"]); // T(6) then T(3)
    expect(rows[0].raisedBy).toMatchObject({ name: "Allan Ramos", designation: "Purchaser" });
    expect(rows[0].steps[0]).toMatchObject({ designation: "Admin / Payment Approver", name: "Rey Gil", signed: true });
  });

  it("leaves a request that is still pending out of the record", async () => {
    await applied({ status: "PENDING", appliedAt: null, approverByName: null, approverAt: null });
    expect(await getApprovalHistory()).toEqual([]);
  });
});
