/**
 * The Products Save waits for the Admin / Payment Approver.
 *
 * The point of these is that the catalogue does not move until the owner clicks.
 * A parked change is not a failed save — it is a proposal held whole, prices
 * included — and it must be applied EXACTLY as proposed when confirmed, or the
 * owner approved one thing and got another.
 *
 * Add --no-file-parallelism when running several DB-backed suites at once: they
 * share one database and truncate the same tables between tests.
 *
 * Runs against a real Postgres, skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/app/\(app\)/products
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

/** Flipped per test to stand in for the signed-in user. */
const who = { admin: false, payment_approver: false, purchaser: false };
let currentId = "purch-1";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => ({ id: currentId, name: currentId === "purch-1" ? "Allan Ramos" : "Ana Cruz", role: who.admin ? "ADMIN" : "OTHER", email: `${currentId}@test` }),
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
const { createProduct, updateProduct, deleteProduct, approveProductChange, rejectProductChange, withdrawProductChange } =
  await import("./actions");

const WINGS = "WINGS COMMERCIAL MILLS & IND'L. SUPPLY";

/** Become the Purchaser (proposes) or the Payment Approver (decides). */
function be(role: "purchaser" | "payment_approver" | "admin") {
  for (const k of Object.keys(who)) (who as Record<string, boolean>)[k] = false;
  (who as Record<string, boolean>)[role] = true;
  currentId = role === "purchaser" ? "purch-1" : "appr-1";
}

const belt = (price: number, extra: Record<string, unknown> = {}) => ({
  name: "BELT B-50", unit: "pc",
  suppliers: [{ supplierId: "", company: WINGS, price }],
  ...extra,
});
const pending = () => prisma.productChange.findFirst({ where: { status: "PENDING" } });
const live = () => prisma.product.findFirst({ where: { name: { startsWith: "BELT" }, active: true } });

/** Seed a live product priced by the owner, then hand over to the Purchaser. */
async function seedThenPropose(price = 128, extra: Record<string, unknown> = {}) {
  be("payment_approver");
  await createProduct(belt(210));
  const p = (await live())!;
  be("purchaser");
  await updateProduct({ id: p.id, ...belt(price, extra) });
  return p;
}

run("a product change waits for the price owner", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.productChange.deleteMany({});
    await prisma.product.deleteMany({});
  });

  it("applies the parked change verbatim — the proposed price included", async () => {
    const p = await seedThenPropose(128, { note: "supplier re-quoted" });
    const c = (await pending())!;

    be("payment_approver");
    expect(await approveProductChange(c.id)).toEqual({ ok: true, applied: true });

    const after = await prisma.product.findUnique({ where: { id: p.id } });
    expect((after!.suppliers as { price?: number }[])[0].price).toBe(128);
    expect(after!.note).toBe("supplier re-quoted");
    const decided = await prisma.productChange.findUnique({ where: { id: c.id } });
    expect(decided!.status).toBe("APPLIED");
    expect(decided!.decidedByName).toBe("Ana Cruz");
  });

  it("keeps the old price when the change is rejected, with the reason on record", async () => {
    const p = await seedThenPropose(128);
    const c = (await pending())!;

    be("payment_approver");
    await rejectProductChange(c.id, "Quote not attached");

    const after = await prisma.product.findUnique({ where: { id: p.id } });
    expect((after!.suppliers as { price?: number }[])[0].price).toBe(210);
    const decided = await prisma.productChange.findUnique({ where: { id: c.id } });
    expect(decided!.status).toBe("REJECTED");
    expect(decided!.rejectReason).toBe("Quote not attached");
  });

  it("refuses to let the Purchaser approve their own change", async () => {
    await seedThenPropose();
    const c = (await pending())!;
    be("purchaser");
    const r = await approveProductChange(c.id);
    expect(r.ok).toBe(false);
    // Still pending, and the catalogue is still on the owner's figure.
    expect((await pending())!.id).toBe(c.id);
    expect(((await live())!.suppliers as { price?: number }[])[0].price).toBe(210);
  });

  it("will not decide the same change twice", async () => {
    await seedThenPropose();
    const c = (await pending())!;
    be("payment_approver");
    await approveProductChange(c.id);
    const again = await approveProductChange(c.id);
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.error).toMatch(/already been decided/i);
  });

  it("lets the proposer withdraw their own, and nobody else's", async () => {
    await seedThenPropose();
    const c = (await pending())!;

    // A second Purchaser can see the queue but not clear someone else's row.
    be("purchaser");
    currentId = "purch-2";
    expect((await withdrawProductChange(c.id)).ok).toBe(false);
    expect((await pending())!.id).toBe(c.id);

    currentId = "purch-1"; // the person who proposed it
    expect((await withdrawProductChange(c.id)).ok).toBe(true);
    expect(await pending()).toBeNull();
    expect((await prisma.productChange.findUnique({ where: { id: c.id } }))!.rejectReason).toMatch(/Withdrawn/i);
  });

  it("parks a removal too, and the product stays until it is confirmed", async () => {
    be("payment_approver");
    await createProduct(belt(210));
    const p = (await live())!;

    be("purchaser");
    const r = await deleteProduct(p.id);
    expect(r.ok && r.applied).toBe(false);
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.active).toBe(true);

    be("payment_approver");
    await approveProductChange((await pending())!.id);
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.active).toBe(false);
  });

  it("does not resurrect a product that was removed while the change waited", async () => {
    const p = await seedThenPropose();
    const c = (await pending())!;
    await prisma.product.update({ where: { id: p.id }, data: { active: false } });
    await prisma.product.delete({ where: { id: p.id } });

    be("payment_approver");
    const r = await approveProductChange(c.id);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/no longer exists/i);
    expect((await prisma.productChange.findUnique({ where: { id: c.id } }))!.status).toBe("PENDING");
  });

  it("gives the owner's own Add and Save a straight path — nothing is parked", async () => {
    be("admin");
    expect(await createProduct(belt(210))).toEqual({ ok: true, applied: true });
    const p = (await live())!;
    expect(await updateProduct({ id: p.id, ...belt(240) })).toEqual({ ok: true, applied: true });
    expect(((await live())!.suppliers as { price?: number }[])[0].price).toBe(240);
    expect(await prisma.productChange.count()).toBe(0);
  });
});
