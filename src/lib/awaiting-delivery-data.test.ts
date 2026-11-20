/**
 * Bought stock added at Cash & Check Released, held until the Warehouseman's
 * Receive — against a real Postgres (skipped unless TEST_DATABASE_URL is set):
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/lib/awaiting-delivery-data
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }));
process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { addAwaitingAtCashRelease, confirmAwaitingOnReceive, reverseAwaiting } = await import("./awaiting-delivery-data");
const { applyStockChange } = await import("./inventory");

const PO = {
  poNumber: "PO-TEST0001",
  supplier: { company: "TKL STEEL" },
  lines: [
    { description: 'MS PLATE 3/16" (4.0mm)', qty: "10", unit: "pc", unitPrice: "3800", sku: "CON000755" },
    { description: "NO CODE", qty: "1", unit: "pc", unitPrice: "1" },
  ],
};
const pr = { id: "pr-1", kind: "order", dept: "fans", quotationId: null, items: ['10 pc · MS PLATE 3/16" (4.0mm)', "1 pc · NO CODE"], itemSkus: ["CON000755", ""], po: PO };
const qty = async () => Number((await prisma.stockItem.findUnique({ where: { id: "plate" } }))!.quantity);
const holds = () => prisma.stockReservation.findMany({ where: { active: true } });

run("bought stock: in at cash release, usable at Receive", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await prisma.stockReservation.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.stockItem.deleteMany({});
    await prisma.stockItem.create({ data: { id: "plate", sku: "CON000755", name: 'MS PLATE 3/16" (4.0mm)', unit: "pc", quantity: 3, location: "Plant Warehouse" } });
  });

  it("adds the line to on hand at cash release, held — and only once if pressed again", async () => {
    await prisma.$transaction((tx) => addAwaitingAtCashRelease(tx, pr, [pr], "Rey Gil"));
    await prisma.$transaction((tx) => addAwaitingAtCashRelease(tx, pr, [pr], "Rey Gil"));
    expect(await qty()).toBe(13);
    const h = await holds();
    expect(h).toHaveLength(1);
    expect(Number(h[0].qty)).toBe(10);
    expect(h[0].forRef).toBe("PO-TEST0001 · awaiting delivery confirmation");
  });

  it("nothing can be issued out of the held part — only the 3 that were already there", async () => {
    await prisma.$transaction((tx) => addAwaitingAtCashRelease(tx, pr, [pr], "Rey Gil"));
    await expect(prisma.$transaction((tx) => applyStockChange(tx, { stockItemId: "plate", kind: "ISSUE", qty: 4, reason: "MRF #1" }, "WH"))).rejects.toThrow(/Only 3 pc .* usable — 10 pc not usable yet/);
    await prisma.$transaction((tx) => applyStockChange(tx, { stockItemId: "plate", kind: "ISSUE", qty: 3, reason: "MRF #1" }, "WH"));
    expect(await qty()).toBe(10);
  });

  it("Receive confirms instead of adding again; a short delivery keeps the rest held", async () => {
    await prisma.$transaction((tx) => addAwaitingAtCashRelease(tx, pr, [pr], "Rey Gil"));
    const adds = await prisma.$transaction((tx) => confirmAwaitingOnReceive(tx, "PO-TEST0001", [{ stockItemId: "plate", qty: 8 }], "Warehouse Wil"));
    expect(adds).toEqual([]);
    expect(await qty()).toBe(13);
    const h = await holds();
    expect(Number(h[0].qty)).toBe(2);
    expect(h[0].note).toMatch(/Short delivery: 8 received by Warehouse Wil/);
  });

  it("rolled back / cancelled: the held stock comes back out", async () => {
    await prisma.$transaction((tx) => addAwaitingAtCashRelease(tx, pr, [pr], "Rey Gil"));
    await prisma.$transaction((tx) => reverseAwaiting(tx, "PO-TEST0001", "Admin", "cancelled"));
    expect(await qty()).toBe(3);
    expect(await holds()).toHaveLength(0);
  });
});
