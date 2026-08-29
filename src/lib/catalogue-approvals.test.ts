/**
 * The flashing Inventory / Products nav counts.
 *
 * What is under test is the counting and the role gate. The badge itself is the
 * one already used by Inbound RFQs and Inquiries — same component, same blink —
 * so this feeds it numbers and checks the numbers are right for each role.
 *
 * Add --no-file-parallelism when running several DB-backed suites at once: they
 * share one database and truncate the same tables between tests.
 *
 * Runs against a real Postgres, skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/lib/catalogue-approvals
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { User } from "@prisma/client";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

/** Flipped per test to stand in for the signed-in user's workflow roles. */
const who = { admin: false, purchaser: false, warehouse: false, payment_approver: false, accounting: false };

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => ({ id: "u1", name: "Tester", role: who.admin ? "ADMIN" : "OTHER", email: "t@test" }),
  isAdmin: () => who.admin,
  hasRole: () => who.admin,
  canApprove: () => who.admin,
}));
vi.mock("@/lib/workflow-roles", () => ({
  getWorkflowRoles: async () => ({}),
  userHasWorkflowRole: (_r: unknown, _id: string, key: string) => Boolean((who as Record<string, boolean>)[key]),
  WORKFLOW_ROLES: [],
  WORKFLOW_ROLE_KEYS: [],
}));

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { getCatalogueApprovalCounts, watchesCatalogueApprovals } = await import("./catalogue-approvals");

const USER = { id: "u1", name: "Tester" } as unknown as User;
const NO_ROLES = {} as Parameters<typeof getCatalogueApprovalCounts>[1];

function be(role: keyof typeof who | "none") {
  for (const k of Object.keys(who)) (who as Record<string, boolean>)[k] = false;
  if (role !== "none") (who as Record<string, boolean>)[role] = true;
}
const counts = () => getCatalogueApprovalCounts(USER, NO_ROLES);

/** One pending stock action of the given kind. */
async function stockAction(kind: "EDIT" | "ADJUST") {
  const i = await prisma.stockItem.create({ data: { name: `ITEM ${kind} ${Math.random()}`, unit: "pc" } });
  await prisma.stockAction.create({
    data: {
      stockItemId: i.id, itemName: i.name, kind, payload: {}, summary: `${kind} ${i.name}`,
      proposedById: "wh-1", proposedByName: "Willy Ho", proposedRole: "warehouse",
    },
  });
}

run("the catalogue approval nav counts", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.stockAction.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.stockItem.deleteMany({});
    await prisma.productChange.deleteMany({});
    await prisma.product.deleteMany({});
    await stockAction("EDIT");
    await stockAction("ADJUST"); // a quantity move — deliberately not counted
    await prisma.productChange.create({
      data: {
        productName: "BELT B-50", kind: "CREATE", payload: {}, summary: "Add BELT B-50",
        proposedById: "pu-1", proposedByName: "Allan Ramos",
      },
    });
  });

  it("counts a proposed EDIT but not a proposed quantity adjustment", async () => {
    be("admin");
    await stockAction("ADJUST");
    expect(await counts()).toEqual({ inventory: 1, products: 1 });
  });

  it("gives the Purchaser and the Payment Approver both counts", async () => {
    be("purchaser");
    expect(await counts()).toEqual({ inventory: 1, products: 1 });
    be("payment_approver");
    expect(await counts()).toEqual({ inventory: 1, products: 1 });
  });

  // The Products queue shows supplier prices, which the Warehouse may not see,
  // so that page withholds the card from them — a badge there would be a dead end.
  it("gives the Warehouse the Inventory count only", async () => {
    be("warehouse");
    expect(await counts()).toEqual({ inventory: 1, products: 0 });
  });

  it("gives everyone else nothing at all", async () => {
    be("accounting");
    expect(watchesCatalogueApprovals(USER, NO_ROLES)).toBe(false);
    expect(await counts()).toEqual({ inventory: 0, products: 0 });
    be("none");
    expect(await counts()).toEqual({ inventory: 0, products: 0 });
  });

  it("clears once the changes are decided", async () => {
    be("admin");
    await prisma.stockAction.updateMany({ where: { kind: "EDIT" }, data: { status: "APPLIED" } });
    await prisma.productChange.updateMany({ data: { status: "REJECTED" } });
    expect(await counts()).toEqual({ inventory: 0, products: 0 });
  });
});
