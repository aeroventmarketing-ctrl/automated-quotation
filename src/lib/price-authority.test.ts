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
const { createProduct, updateProduct, importProducts } = await import("@/app/(app)/products/actions");
const { createStockItem, updateStockItemMeta, importStockItems } = await import("@/app/(app)/inventory/actions");

/** A CSV upload, as the import panel submits it. */
function upload(csv: string): FormData {
  const f = new FormData();
  f.set("file", new File([csv], "catalogue.csv", { type: "text/csv" }));
  return f;
}

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
    await prisma.productChange.deleteMany({});
    await prisma.product.deleteMany({});
  });

  it("recognises the Admin and the Payment Approver, and no one else", async () => {
    be("admin"); expect(await canSetCataloguePrice()).toBe(true);
    be("payment_approver"); expect(await canSetCataloguePrice()).toBe(true);
    be("purchaser"); expect(await canSetCataloguePrice()).toBe(false);
    be("warehouse"); expect(await canSetCataloguePrice()).toBe(false);
  });

  describe("Products — the supplier price a PO defaults to", () => {
    it("lets the Payment Approver set it, straight through", async () => {
      be("payment_approver");
      const r = await createProduct({ name: "BELT B-50", unit: "pc", suppliers: [{ supplierId: "", company: "WINGS", price: 210 }] });
      expect(r).toEqual({ ok: true, applied: true });
      const p = await prisma.product.findFirst({ where: { name: "BELT B-50" } });
      expect((p!.suppliers as { price?: number }[])[0].price).toBe(210);
    });

    // The Purchaser's save no longer half-lands with the price quietly dropped:
    // the whole proposal is parked until the price owner confirms it.
    it("parks the Purchaser's new product instead of creating it", async () => {
      be("purchaser");
      const r = await createProduct({ name: "BELT B-50", unit: "pc", suppliers: [{ supplierId: "", company: "WINGS", price: 128 }] });
      expect(r.ok).toBe(true);
      expect(r.ok && r.applied).toBe(false);
      expect(await prisma.product.findFirst({ where: { name: "BELT B-50" } })).toBeNull();
      const parked = await prisma.productChange.findFirst({ where: { status: "PENDING" } });
      expect(parked!.kind).toBe("CREATE");
      // Parked WHOLE — the price they typed is what the owner will be shown.
      expect(((parked!.payload as { suppliers: { price?: number }[] }).suppliers)[0].price).toBe(128);
    });

    it("leaves the live product untouched while the Purchaser's edit waits", async () => {
      be("payment_approver");
      await createProduct({ name: "BELT B-50", unit: "pc", suppliers: [{ supplierId: "", company: "WINGS", price: 210 }] });
      const p = await prisma.product.findFirst({ where: { name: "BELT B-50" } });

      be("purchaser");
      // The Purchaser renames it, adds a supplier code, and proposes a new price.
      await updateProduct({
        id: p!.id, name: "BELT B-50 (V-belt)", unit: "pc", note: "for JO 2600080",
        suppliers: [{ supplierId: "", company: "WINGS", code: "WB-50", price: 128 }],
      });
      const after = await prisma.product.findUnique({ where: { id: p!.id } });
      expect(after!.name).toBe("BELT B-50");                            // nothing has moved
      expect((after!.suppliers as { price?: number }[])[0].price).toBe(210);
      expect(await prisma.productChange.count({ where: { status: "PENDING" } })).toBe(1);
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

  // A spreadsheet is the catalogue in bulk: one upload writes every price at
  // once. Hiding the button is not the control — these call the action directly,
  // which is what a replayed request does.
  describe("Files — the catalogue as a CSV / Excel upload", () => {
    const STOCK_CSV = "name,unit,quantity,unitCost,sellPrice\nBELT B-50,pc,4,210,300\n";
    const PRODUCT_CSV = "name,unit,supplier,price\nBELT B-50,pc,WINGS,210\n";

    it("refuses the Purchaser's upload on both screens, and says why", async () => {
      be("purchaser");
      const inv = await importStockItems(upload(STOCK_CSV));
      expect(inv).toMatchObject({ created: 0, updated: 0 });
      expect(inv.errors[0]).toMatch(/Admin or the Payment Approver/i);
      expect(await prisma.stockItem.count()).toBe(0);

      const prod = await importProducts(upload(PRODUCT_CSV));
      expect(prod).toMatchObject({ created: 0, updated: 0 });
      expect(prod.errors[0]).toMatch(/Admin or the Payment Approver/i);
      expect(await prisma.product.count()).toBe(0);
    });

    it("refuses the Warehouse's upload too", async () => {
      be("warehouse");
      expect((await importStockItems(upload(STOCK_CSV))).errors[0]).toMatch(/Admin or the Payment Approver/i);
      expect(await prisma.stockItem.count()).toBe(0);
    });

    it("lets the Payment Approver upload, prices and all", async () => {
      be("payment_approver");
      expect(await importStockItems(upload(STOCK_CSV))).toMatchObject({ created: 1, errors: [] });
      const i = await prisma.stockItem.findFirst({ where: { name: "BELT B-50" } });
      expect(Number(i!.unitCost)).toBe(210);
      expect(Number(i!.sellPrice)).toBe(300);

      expect(await importProducts(upload(PRODUCT_CSV))).toMatchObject({ created: 1 });
      const p = await prisma.product.findFirst({ where: { name: "BELT B-50" } });
      expect((p!.suppliers as { price?: number }[])[0].price).toBe(210);
    });
  });
});
