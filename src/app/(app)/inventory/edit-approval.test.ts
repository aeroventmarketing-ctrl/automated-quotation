/**
 * An Inventory "Propose edit" now needs a third sign-off.
 *
 * The edit panel carries the unit cost and the selling price, so the Warehouse +
 * Purchaser handshake was a way past the rule that only the Admin / Payment
 * Approver sets a catalogue price. These check that the item does not move until
 * all three have signed — and that the quantity actions, which move stock rather
 * than money, are untouched by the change.
 *
 * Add --no-file-parallelism when running several DB-backed suites at once: they
 * share one database and truncate the same tables between tests.
 *
 * Runs against a real Postgres, skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/app/\(app\)/inventory
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

/** Flipped per test to stand in for the signed-in user. */
const who = { admin: false, warehouse: false, purchaser: false, payment_approver: false };
let currentId = "wh-1";
const NAMES: Record<string, string> = { "wh-1": "Willy Ho", "pu-1": "Allan Ramos", "pa-1": "Ana Cruz" };

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => ({ id: currentId, name: NAMES[currentId], role: who.admin ? "ADMIN" : "OTHER", email: `${currentId}@test` }),
  isAdmin: () => who.admin,
  hasRole: () => who.admin,
  canApprove: () => who.admin,
}));
vi.mock("@/lib/workflow-roles", () => ({
  getWorkflowRoles: async () => ({}),
  userHasWorkflowRole: (_r: unknown, _id: string, key: string) => Boolean((who as Record<string, boolean>)[key]),
  WORKFLOW_ROLES: [],
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { proposeStockAction, approveStockAction } = await import("./stock-action-actions");

function be(role: "warehouse" | "purchaser" | "payment_approver") {
  for (const k of Object.keys(who)) (who as Record<string, boolean>)[k] = false;
  (who as Record<string, boolean>)[role] = true;
  currentId = role === "warehouse" ? "wh-1" : role === "purchaser" ? "pu-1" : "pa-1";
}

let itemId = "";
const item = () => prisma.stockItem.findUnique({ where: { id: itemId } });
const action = () => prisma.stockAction.findFirst({ orderBy: { proposedAt: "desc" } });

run("an inventory edit needs the price owner too", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.stockAction.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.stockItem.deleteMany({});
    const i = await prisma.stockItem.create({
      data: { name: "BELT B-50", unit: "pc", quantity: 4, reorderLevel: 1, unitCost: 210, sellPrice: 300, location: "Plant Warehouse" },
    });
    itemId = i.id;
  });

  const proposeEdit = (unitCost: number) =>
    proposeStockAction("EDIT", itemId, { category: "SUPPLIES", location: "Plant Warehouse", reorderLevel: 2, unitCost, sellPrice: 300 });

  it("holds the edit after the Warehouseman and the Purchaser have both signed", async () => {
    be("warehouse");
    expect(await proposeEdit(128)).toEqual({ ok: true });
    be("purchaser");
    expect(await approveStockAction((await action())!.id)).toEqual({ ok: true });

    const a = (await action())!;
    expect(a.status).toBe("PENDING");
    expect(a.warehouseByName).toBe("Willy Ho");
    expect(a.purchaserByName).toBe("Allan Ramos");
    expect(a.approverAt).toBeNull();
    // Nothing has reached the item — not the cost, not the reorder level.
    const i = (await item())!;
    expect(Number(i.unitCost)).toBe(210);
    expect(Number(i.reorderLevel)).toBe(1);
  });

  it("applies it on the price owner's sign-off, and only then", async () => {
    be("warehouse"); await proposeEdit(128);
    be("purchaser"); await approveStockAction((await action())!.id);
    be("payment_approver"); expect(await approveStockAction((await action())!.id)).toEqual({ ok: true });

    const a = (await action())!;
    expect(a.status).toBe("APPLIED");
    expect(a.approverByName).toBe("Ana Cruz");
    const i = (await item())!;
    expect(Number(i.unitCost)).toBe(128);   // proposed by the Warehouse, RELEASED by the owner
    expect(Number(i.reorderLevel)).toBe(2);
    expect(i.category).toBe("SUPPLIES");
  });

  it("tells whoever clicks too early who is still missing", async () => {
    be("warehouse");
    await proposeEdit(128);
    // The Warehouseman's slot is already theirs; there is nothing left for them.
    const r = await approveStockAction((await action())!.id);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/Purchaser.*Admin|Payment Approver/i);
  });

  it("leaves a quantity adjustment on the old two-party rule", async () => {
    be("warehouse");
    expect(await proposeStockAction("ADJUST", itemId, { kind: "RECEIPT", qty: 6, reason: "delivery" })).toEqual({ ok: true });
    be("purchaser");
    await approveStockAction((await action())!.id);

    expect((await action())!.status).toBe("APPLIED");   // no third sign-off wanted
    expect(Number((await item())!.quantity)).toBe(10);
  });

  it("does not let the price owner's own proposal skip the other two", async () => {
    be("payment_approver");
    await proposeEdit(128);
    const a = (await action())!;
    expect(a.status).toBe("PENDING");
    expect(a.approverByName).toBe("Ana Cruz");   // their own slot, filled by proposing
    expect(a.warehouseAt).toBeNull();
    expect(Number((await item())!.unitCost)).toBe(210);
  });
});
