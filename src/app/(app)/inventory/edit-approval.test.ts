/**
 * The approval chain on an Inventory request — EVERY kind of request.
 *
 * The owner's sequence:
 *
 *   Warehouse raises it  →  Purchaser approves  →  Admin / Payment Approver
 *   Purchaser raises it  →  Admin / Payment Approver          (no Warehouse step)
 *   Admin / PA raises it →  applies at once
 *
 * These check the item does not move until the chain is finished and that the
 * chain is the right LENGTH for who raised it. The ADJUST case is a regression
 * test: it ran the old two-party handshake, so a Warehouse adjustment applied
 * itself the moment the Purchaser approved and never reached the Admin / Payment
 * Approver — who then had nothing pending to be notified about either.
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

run("an inventory request ends with the price owner", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.stockAction.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.stockReservation.deleteMany({});
    await prisma.stockItem.deleteMany({});
    const i = await prisma.stockItem.create({
      data: { name: "BELT B-50", unit: "pc", quantity: 4, reorderLevel: 1, unitCost: 210, sellPrice: 300, location: "Plant Warehouse" },
    });
    itemId = i.id;
  });

  const proposeEdit = (unitCost: number) =>
    proposeStockAction("EDIT", itemId, { category: "SUPPLIES", location: "Plant Warehouse", reorderLevel: 2, unitCost, sellPrice: 300 });

  it("holds the Warehouse's edit after the Purchaser has signed", async () => {
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

  // Rule 2: "Remove the warehouse in approval stage."
  it("sends the Purchaser's own edit straight to the price owner, with no Warehouse step", async () => {
    be("purchaser");
    await proposeEdit(128);
    const a = (await action())!;
    expect(a.status).toBe("PENDING");
    expect(a.purchaserByName).toBe("Allan Ramos");
    expect(a.warehouseAt).toBeNull();      // and it never will be

    // The Warehouseman has nothing to sign here.
    be("warehouse");
    const r = await approveStockAction(a.id);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/Admin \/ Payment Approver/i);
    expect((await action())!.status).toBe("PENDING");

    be("payment_approver");
    expect(await approveStockAction(a.id)).toEqual({ ok: true });
    expect((await action())!.status).toBe("APPLIED");
    expect(Number((await item())!.unitCost)).toBe(128);
  });

  // Rule 1, in order: the price owner does not get to sign before the Purchaser.
  it("will not take the final approval before the Purchaser has reviewed it", async () => {
    be("warehouse");
    await proposeEdit(128);
    be("payment_approver");
    const r = await approveStockAction((await action())!.id);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/Purchaser/i);
    expect(Number((await item())!.unitCost)).toBe(210);
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

  it("tells whoever clicks out of turn whose signature is wanted", async () => {
    be("warehouse");
    await proposeEdit(128);
    // The Warehouseman's slot is already theirs; the Purchaser is next.
    const r = await approveStockAction((await action())!.id);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/Purchaser/i);
  });

  // THE REGRESSION. Reported as "once warehouse raise a request, purchaser
  // approves… after purchaser approves it stops and admin/payment approver cannot
  // approve": the adjustment had already applied itself, so there was nothing
  // left to approve and nothing left to notify anyone about.
  it("does NOT apply a Warehouse adjustment when the Purchaser approves", async () => {
    be("warehouse");
    expect(await proposeStockAction("ADJUST", itemId, { kind: "RECEIPT", qty: 6, reason: "delivery" })).toEqual({ ok: true });
    be("purchaser");
    await approveStockAction((await action())!.id);

    expect((await action())!.status).toBe("PENDING");            // still waiting
    expect(Number((await item())!.quantity)).toBe(4);            // stock has not moved

    be("payment_approver");
    expect(await approveStockAction((await action())!.id)).toEqual({ ok: true });
    expect((await action())!.status).toBe("APPLIED");
    expect(Number((await item())!.quantity)).toBe(10);
  });

  it("holds a Warehouse reservation for the same two signatures", async () => {
    be("warehouse");
    expect(await proposeStockAction("RESERVE", itemId, { qty: 2, forRef: "JO 2600080" })).toEqual({ ok: true });
    expect((await action())!.status).toBe("PENDING");            // used to apply on the spot
    expect(await prisma.stockReservation.count()).toBe(0);

    be("purchaser"); await approveStockAction((await action())!.id);
    be("payment_approver"); await approveStockAction((await action())!.id);
    expect((await action())!.status).toBe("APPLIED");
    expect(await prisma.stockReservation.count()).toBe(1);
  });

  // The price owner IS the final approver, so their own edit has nobody left to
  // wait for. Previously it filed itself as a Warehouseman's and queued for two
  // people who would only have been signing on their behalf.
  it("applies the price owner's own edit at once", async () => {
    be("payment_approver");
    await proposeEdit(128);
    const a = (await action())!;
    expect(a.status).toBe("APPLIED");
    expect(a.approverByName).toBe("Ana Cruz");
    expect(Number((await item())!.unitCost)).toBe(128);
  });
});
