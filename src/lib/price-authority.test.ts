/**
 * Who may set a catalogue price — the Admin and the Payment Approver, not the
 * Purchaser who spends against it.
 *
 * The point of these is as much what STAYS possible as what is blocked: a
 * Purchaser must still add products and stock items, set suppliers, codes,
 * units and categories, and a Warehouse must still adjust quantities. Locking
 * the whole screen would have stopped people doing their jobs; only the price
 * fields are reserved.
 *
 * Runs against a real Postgres, skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/lib/price-authority
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

/** Flipped per test to stand in for the signed-in user. */
const who = { admin: false, payment_approver: false, purchaser: false, warehouse: false };

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => ({ id: "u1", name: "Tester", role: who.admin ? "ADMIN" : "OTHER", email: "t@test" }),
  isAdmin: () => who.admin,
  hasRole: () => who.admin,
  canApprove: () => who.admin,
}));
vi.mock("@/lib/workflow-roles", () => ({
  getWorkflowRoles: async () => ({}),
  userHasWorkflowRole: (_roles: unknown, _id: string, key: string) => Boolean((who as Record<string, boolean>)[key]),
  WORKFLOW_ROLES: [],
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { canSetCataloguePrice } = await import("./price-authority");
const { createProduct, updateProduct } = await import("@/app/(app)/products/actions");
const { createStockItem, updateStockItemMeta } = await import("@/app/(app)/inventory/actions");

function be(role: "admin" | "payment_approver" | "purchaser" | "warehouse") {
  for (const k of Object.keys(who)) (who as Record<string, boolean>)[k] = false;
  (who as Record<string, boolean>)[role] = true;
}

run("who may set a catalogue price", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await prisma.stockMovement.deleteMany({});
    await prisma.stockItem.deleteMany({});
    await prisma.product.deleteMany({});
  });

  it("recognises the Admin and the Payment Approver, and no one else", async () => {
    be("admin"); expect(await canSetCataloguePrice()).toBe(true);
    be("payment_approver"); expect(await canSetCataloguePrice()).toBe(true);
    be("purchaser"); expect(await canSetCataloguePrice()).toBe(false);
    be("warehouse"); expect(await canSetCataloguePrice()).toBe(false);
  });

  describe("Products — the supplier price a PO defaults to", () => {
    it("lets the Payment Approver set it", async () => {
      be("payment_approver");
      await createProduct({ name: "BELT B-50", unit: "pc", suppliers: [{ supplierId: "", company: "WINGS", price: 210 }] });
      const p = await prisma.product.findFirst({ where: { name: "BELT B-50" } });
      expect((p!.suppliers as { price?: number }[])[0].price).toBe(210);
    });

    it("ignores a price from the Purchaser, but still creates the product", async () => {
      be("purchaser");
      await createProduct({ name: "BELT B-50", unit: "pc", suppliers: [{ supplierId: "", company: "WINGS", price: 128 }] });
      const p = await prisma.product.findFirst({ where: { name: "BELT B-50" } });
      expect(p).toBeTruthy();
      expect((p!.suppliers as { price?: number }[])[0].price).toBeUndefined();
      expect((p!.suppliers as { company: string }[])[0].company).toBe("WINGS");
    });

    it("keeps the approved price when the Purchaser edits something else", async () => {
      be("payment_approver");
      await createProduct({ name: "BELT B-50", unit: "pc", suppliers: [{ supplierId: "", company: "WINGS", price: 210 }] });
      const p = await prisma.product.findFirst({ where: { name: "BELT B-50" } });

      be("purchaser");
      // The Purchaser renames it and adds a supplier code, and tries a new price.
      await updateProduct({
        id: p!.id, name: "BELT B-50 (V-belt)", unit: "pc", note: "for JO 2600080",
        suppliers: [{ supplierId: "", company: "WINGS", code: "WB-50", price: 128 }],
      });
      const after = await prisma.product.findUnique({ where: { id: p!.id } });
      const link = (after!.suppliers as { price?: number; code?: string }[])[0];
      expect(after!.name).toBe("BELT B-50 (V-belt)");   // their edit lands
      expect(link.code).toBe("WB-50");                   // and their code
      expect(link.price).toBe(210);                      // but the price is untouched
    });
  });

  describe("Inventory — unit cost and selling price", () => {
    it("lets the Admin set them", async () => {
      be("admin");
      await createStockItem({ name: "CUTTING DISC 4\"", unit: "pc", quantity: 0, reorderLevel: 0, unitCost: 29, sellPrice: 40 });
      const i = await prisma.stockItem.findFirst({ where: { name: 'CUTTING DISC 4"' } });
      expect(Number(i!.unitCost)).toBe(29);
      expect(Number(i!.sellPrice)).toBe(40);
    });

    it("creates the item unpriced for the Purchaser rather than refusing it", async () => {
      be("purchaser");
      await createStockItem({ name: "CUTTING DISC 4\"", unit: "pc", quantity: 5, reorderLevel: 1, unitCost: 29, sellPrice: 40 });
      const i = await prisma.stockItem.findFirst({ where: { name: 'CUTTING DISC 4"' } });
      expect(i).toBeTruthy();
      expect(Number(i!.quantity)).toBe(5);      // the item and its stock land
      expect(Number(i!.reorderLevel)).toBe(1);
      expect(Number(i!.unitCost)).toBe(0);      // the price does not
      expect(Number(i!.sellPrice)).toBe(0);
    });

    it("keeps the approved price when the Warehouse edits the row", async () => {
      be("admin");
      await createStockItem({ name: "BELT B-50", unit: "pc", quantity: 1, reorderLevel: 0, unitCost: 210, sellPrice: 300 });
      const i = await prisma.stockItem.findFirst({ where: { name: "BELT B-50" } });

      be("warehouse");
      await updateStockItemMeta({
        stockItemId: i!.id, category: "SUPPLIES", location: "Plant Warehouse",
        reorderLevel: 4, unitCost: 128, sellPrice: 150,
      });
      const after = await prisma.stockItem.findUnique({ where: { id: i!.id } });
      expect(after!.location).toBe("Plant Warehouse"); // their edit lands
      expect(Number(after!.reorderLevel)).toBe(4);
      expect(Number(after!.unitCost)).toBe(210);       // the price is untouched
      expect(Number(after!.sellPrice)).toBe(300);
    });
  });
});
