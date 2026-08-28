/**
 * The catalogue a purchase order prices against, and the price it resolves for
 * a line. One builder serves the PO form (which fills the price in), the save
 * (which refuses an unexplained deviation) and the audit (which reports on it) —
 * so these three can never disagree about what a product costs.
 *
 * Runs against a real Postgres, skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/lib/po-price-catalog
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { buildPoPriceCatalog, cataloguePriceForLine } = await import("./po-price-catalog");

const WINGS = "WINGS COMMERCIAL MILLS & IND'L. SUPPLY";
const BEARING = "PHILIPPINE BEARING CORPORATION";

run("the PO price catalogue", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.product.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.stockItem.deleteMany({});
    await prisma.product.createMany({
      data: [
        { name: "BELT B-50", sku: "B50", unit: "pc", suppliers: [{ company: WINGS, price: 210 }, { company: BEARING, price: 210 }] },
        { name: "ANGLE BAR 6.0mm x 50mm x 50mm", sku: "AB1", unit: "pc", suppliers: [{ company: "TKL STEEL", price: 740 }, { company: "ALLOY MASTER", price: 900 }] },
        { name: "ANLY TIMER AH3NC W/ SOCKET 220V W/ 5 SECS", sku: "T1", unit: "pc", suppliers: [{ company: "JSL ELECTRIC", price: 1030 }] },
      ],
    });
    // Stocked but never given a supplier price — the unit cost is the catalogue.
    await prisma.stockItem.create({ data: { name: 'CUTTING DISC 4"', unit: "pc", unitCost: 29, quantity: 5 } });
  });

  it("prices a line at the chosen supplier's own figure", async () => {
    const c = await buildPoPriceCatalog();
    expect(cataloguePriceForLine("BELT B-50 (JO 2600080)", WINGS, c)).toBe(210);
    expect(cataloguePriceForLine("ANLY TIMER AH3NC W/ SOCKET 220V W/ 5 SECS", "JSL ELECTRIC", c)).toBe(1030);
  });

  it("falls back to the lowest price when the supplier lists none of its own", async () => {
    const c = await buildPoPriceCatalog();
    // A supplier who doesn't carry the angle bar still gets a sane starting
    // figure rather than a blank box.
    expect(cataloguePriceForLine("ANGLE BAR 6.0mm x 50mm x 50mm (JO#2600082)", "SOMEONE ELSE", c)).toBe(740);
  });

  it("uses the inventory unit cost when no supplier price exists at all", async () => {
    const c = await buildPoPriceCatalog();
    expect(cataloguePriceForLine('CUTTING DISC 4" (stock)', "YALE HARDWARE", c)).toBe(29);
  });

  it("has no opinion about a product it does not carry", async () => {
    const c = await buildPoPriceCatalog();
    expect(cataloguePriceForLine("MYSTERY WIDGET XZ9", WINGS, c)).toBeNull();
  });

  it("keeps sizes and ratings apart, so a line is priced from its OWN product", async () => {
    await prisma.product.createMany({
      data: [
        { name: "INDUCTION MOTOR 1 HP, 1PH, 4 POLE FOOT MOUNTED (TECO)", sku: "M1", unit: "pc", suppliers: [{ company: "POWERLINK", price: 12822 }] },
        { name: "INDUCTION MOTOR 2 HP, 1PH, 4 POLE FOOT MOUNTED (TECO)", sku: "M2", unit: "pc", suppliers: [{ company: "POWERLINK", price: 16472 }] },
      ],
    });
    const c = await buildPoPriceCatalog();
    expect(cataloguePriceForLine("INDUCTION MOTOR 2 HP, 1PH, 4 POLE FOOT MOUNTED (TECO) (JOM081)", "POWERLINK", c)).toBe(16472);
    expect(cataloguePriceForLine("INDUCTION MOTOR 1 HP, 1PH, 4 POLE FOOT MOUNTED (TECO) (LA SALLE)", "POWERLINK", c)).toBe(12822);
  });
});
