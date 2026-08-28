/**
 * Saving a purchase order: a price off the catalogue needs a reason.
 *
 * The form makes the price box read-only until the purchaser asks to change it,
 * but a read-only input is a courtesy — the request can be replayed with any
 * price. These check the SERVER, which is the actual control.
 *
 * Deliberately not a block on the price itself: a supplier quoting something new
 * must not stop purchasing. The deviation is recorded and reviewed afterwards.
 *
 * Runs against a real Postgres, skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/app/\(app\)/orders
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => ({ id: "purch-1", name: "Allan Ramos", role: "OTHER", email: "p@test" }),
  isAdmin: () => false,
  hasRole: () => false,
  canApprove: () => false,
}));
vi.mock("@/lib/workflow-roles", () => ({
  getWorkflowRoles: async () => ({}),
  // The signed-in user is the Purchaser and nothing else.
  userHasWorkflowRole: (_r: unknown, _id: string, key: string) => key === "purchaser",
  WORKFLOW_ROLES: [],
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { savePurchaseOrder } = await import("./actions");
const { coercePurchaseOrder } = await import("@/lib/purchase-order");

const WINGS = "WINGS COMMERCIAL MILLS & IND'L. SUPPLY";
let prId = "";

const line = (unitPrice: string, priceReason?: string) => ({
  description: "BELT B-50 (JO 2600080)",
  qty: "2",
  unit: "pc",
  unitPrice,
  ...(priceReason ? { priceReason } : {}),
});
const save = (unitPrice: string, priceReason?: string) =>
  savePurchaseOrder(prId, {
    supplier: { company: WINGS, attention: "", address: "" },
    date: "2026-08-28",
    lines: [line(unitPrice, priceReason)],
    ewtPct: 1,
    ewtMode: "percent" as const,
    ewtAmount: 0,
    remarks: "",
  });
const saved = async () => coercePurchaseOrder((await prisma.purchaseRequest.findUnique({ where: { id: prId } }))!.po);

run("savePurchaseOrder — a price off the catalogue", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.purchaseRequest.deleteMany({});
    await prisma.product.deleteMany({});
    const u = (await prisma.user.findFirst({ where: { id: "purch-1" } }))
      ?? (await prisma.user.create({ data: { id: "purch-1", email: "p@test", name: "Allan Ramos", role: "OTHER" } }));
    await prisma.product.create({
      data: { name: "BELT B-50", sku: "B50", unit: "pc", suppliers: [{ company: WINGS, price: 210 }] },
    });
    const pr = await prisma.purchaseRequest.create({
      data: { items: ["2 pc · BELT B-50 (JO 2600080)"], status: "APPROVED", createdById: u.id, createdByName: u.name },
    });
    prId = pr.id;
  });

  it("saves the catalogue price without asking anything", async () => {
    await save("210");
    const po = await saved();
    expect(po!.lines[0].unitPrice).toBe("210");
    expect(po!.lines[0].priceOverride).toBeUndefined();
  });

  it("refuses a different price with no reason, and says both figures", async () => {
    await expect(save("128")).rejects.toThrow(/128.*catalogue says.*210|catalogue says 210/i);
    expect(await saved()).toBeNull(); // nothing written
  });

  it("accepts a different price WITH a reason, and stamps who and when", async () => {
    await save("225", "Supplier raised the price on 27 Aug — new quote attached");
    const po = await saved();
    const ov = po!.lines[0].priceOverride!;
    expect(po!.lines[0].unitPrice).toBe("225");
    expect(ov.reason).toMatch(/Supplier raised the price/);
    expect(ov.byName).toBe("Allan Ramos");
    expect(ov.catalogue).toBe(210);       // the figure at the time of the override
    expect(Date.parse(ov.at)).toBeGreaterThan(0);
  });

  it("does not demand the reason again when the PO is re-saved unchanged", async () => {
    await save("225", "Supplier raised the price");
    const first = await saved();
    // A later save with no reason typed — e.g. the purchaser only fixed the
    // remarks — must not be refused, and must not restamp the original.
    await save("225");
    const again = await saved();
    expect(again!.lines[0].priceOverride!.reason).toBe("Supplier raised the price");
    expect(again!.lines[0].priceOverride!.at).toBe(first!.lines[0].priceOverride!.at);
  });

  it("leaves an uncatalogued product alone — nothing to hold it to", async () => {
    await savePurchaseOrder(prId, {
      supplier: { company: WINGS, attention: "", address: "" },
      date: "2026-08-28",
      lines: [{ description: "MYSTERY WIDGET XZ9", qty: "1", unit: "pc", unitPrice: "5" }],
      ewtPct: 1, ewtMode: "percent" as const, ewtAmount: 0, remarks: "",
    });
    const po = await saved();
    expect(po!.lines[0].unitPrice).toBe("5");
    expect(po!.lines[0].priceOverride).toBeUndefined();
  });

  it("clears the override when the line goes back to the catalogue price", async () => {
    await save("225", "Supplier raised the price");
    await save("210");
    const po = await saved();
    expect(po!.lines[0].priceOverride).toBeUndefined();
  });
});
