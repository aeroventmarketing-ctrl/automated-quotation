/**
 * Bulk stock import — the update / rename / conflict rules.
 *
 * Runs against a real Postgres so the transaction, the case-insensitive lookups
 * and the unique constraints are the real ones. Skipped automatically when no
 * TEST_DATABASE_URL is set, so `npm test` stays green on a machine without one:
 *
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/app/\(app\)/inventory
 *
 * `requireItemCreator` reads the Supabase session from request cookies, which
 * only exist inside a request, so the auth module is mocked to a warehouse user
 * — the thing under test is the import's matching logic, not who may run it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => ({ id: "test-user", name: "Warehouse", role: "ADMIN", email: "w@test" }),
  isAdmin: () => true,
  hasRole: () => true,
  canApprove: () => true,
}));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { importStockItems } = await import("./actions");

/** A CSV upload, as the panel submits it. */
function upload(csv: string): FormData {
  const f = new FormData();
  f.set("file", new File([csv], "stock.csv", { type: "text/csv" }));
  return f;
}
const byName = (name: string) =>
  prisma.stockItem.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });

run("bulk stock import", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.stockMovement.deleteMany({});
    await prisma.stockItem.deleteMany({});
    await prisma.stockItem.createMany({
      data: [
        { sku: "CAT00100", name: "VENT CAP - ALPHAAIR - 100mmØ SS201", unit: "pc", unitCost: 10, quantity: 3 },
        { sku: "CAT00101", name: "VENT CAP - ALPHAAIR - 150mmØ SS201", unit: "pc", unitCost: 20, quantity: 0 },
        { sku: "CAT00102", name: "VENT CAP - ALPHAAIR - 200mmØ SS201", unit: "pc", unitCost: 30, quantity: 1 },
        // A ghost left behind by "Merge duplicates" / "Clear all", which only
        // deactivate. It keeps the code, and used to block the live item.
        { sku: "CAT00102", name: "VENT CAP ALPHAAIR 200 OLD", unit: "pc", quantity: 0, active: false },
        // Two LIVE items genuinely sharing a code — must stay an error.
        { sku: "CAT00200", name: "ITEM ONE", unit: "pc", quantity: 0 },
        { sku: "CAT00200", name: "ITEM TWO", unit: "pc", quantity: 0 },
        { sku: "CAT00300", name: "TAKEN NAME", unit: "pc", quantity: 0 },
      ],
    });
  });

  it("renames items on re-import instead of refusing them", async () => {
    const res = await importStockItems(
      upload(
        "name,sku,unitCost\n" +
          '"VENT CAP - ALPHAAIR - 100mmØ SS201 (MATTE)",CAT00100,11\n' +
          '"VENT CAP - ALPHAAIR - 150mmØ SS201 (MATTE)",CAT00101,21\n' +
          '"VENT CAP - ALPHAAIR - 200mmØ SS201 (MATTE)",CAT00102,31\n',
      ),
    );
    expect(res.errors).toEqual([]);
    expect(res).toMatchObject({ updated: 3, created: 0 });

    const renamed = await byName("VENT CAP - ALPHAAIR - 100mmØ SS201 (MATTE)");
    expect(renamed).toBeTruthy();
    // Renamed in place: same row, so stock on hand and history are intact.
    expect(Number(renamed!.quantity)).toBe(3);
    expect(Number(renamed!.unitCost)).toBe(11);
    expect(await prisma.stockItem.count({ where: { sku: "CAT00100" } })).toBe(1);
  });

  it("is not blocked by a deactivated duplicate holding the same code", async () => {
    const res = await importStockItems(
      upload('name,sku\n"VENT CAP - ALPHAAIR - 200mmØ SS201 (MATTE)",CAT00102\n'),
    );
    expect(res.errors).toEqual([]);
    expect(await byName("VENT CAP - ALPHAAIR - 200mmØ SS201 (MATTE)")).toBeTruthy();
  });

  it("still refuses a code shared by two live items, and names them", async () => {
    const res = await importStockItems(upload('name,sku\n"SOMETHING NEW",CAT00200\n'));
    expect(res).toMatchObject({ updated: 0, created: 0 });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/ITEM ONE/);
    expect(res.errors[0]).toMatch(/ITEM TWO/);
  });

  it("refuses a rename onto a name another item already answers to", async () => {
    const res = await importStockItems(upload('name,sku\n"TAKEN NAME",CAT00101\n'));
    expect(res).toMatchObject({ updated: 0, created: 0 });
    expect(res.errors[0]).toMatch(/150mm/);
    expect(res.errors[0]).toMatch(/CAT00300/);
  });

  it("leaves everything untouched when an unedited file is re-imported", async () => {
    const csv = 'name,sku,unitCost\n"VENT CAP - ALPHAAIR - 100mmØ SS201",CAT00100,10\n';
    // `updatedAt` is excluded: the import rewrites the same values, so the row's
    // touch timestamp moves even though no field changed. What matters is that
    // no VALUE differs and no row is added or removed.
    const snapshot = async () =>
      (await prisma.stockItem.findMany({ orderBy: [{ sku: "asc" }, { name: "asc" }] })).map(
        ({ updatedAt: _updatedAt, ...rest }) => rest,
      );
    const before = await snapshot();
    const res = await importStockItems(upload(csv));
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(0);
    expect(JSON.stringify(await snapshot())).toBe(JSON.stringify(before));
  });

  it("still creates a genuinely new item, with a generated code", async () => {
    const res = await importStockItems(upload('name,unitCost\n"BRAND NEW WIDGET",7\n'));
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(1);
    expect((await byName("BRAND NEW WIDGET"))?.sku).toBeTruthy();
  });
});
