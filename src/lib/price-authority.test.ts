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
const { createProduct, updateProduct, importProducts, removeUnsourcedProducts } =
  await import("@/app/(app)/products/actions");
const { createStockItem, updateStockItemMeta, importStockItems, removeStockItems, mergeDuplicateStockItems } =
  await import("@/app/(app)/inventory/actions");

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

  // The Payment Approver holds the final approval on every catalogue change, so
  // the screens have to actually show them what they are signing. They were shut
  // out of Inventory entirely and saw no prices anywhere — reported as "payment
  // approver cannot approve in the inventory".
  it("lets the Payment Approver SEE prices, not just set them", async () => {
    const { canViewPrices } = await import("./price-visibility");
    const user = (role: string) => ({ id: "u1", name: "Rey Gil", role }) as unknown as import("@prisma/client").User;
    const NONE = {} as Parameters<typeof canViewPrices>[1]; // the role map is mocked above

    be("payment_approver");
    expect(canViewPrices(user("OTHER"), NONE)).toBe(true);
    expect(canViewPrices(user("SALES"), NONE)).toBe(false);   // Sales never, whatever else they hold

    be("warehouse");
    expect(canViewPrices(user("OTHER"), NONE)).toBe(false);   // and this list did not widen
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

    // This used to park the Purchaser's new product for approval. The owner has
    // since had the Add-product button hidden from them, so there is nothing to
    // park — it is refused outright, and neither a product nor a queued change
    // is left behind. Their EDIT is still parked; that is the test below.
    it("refuses the Purchaser's new product rather than parking it", async () => {
      be("purchaser");
      const r = await createProduct({ name: "BELT B-50", unit: "pc", suppliers: [{ supplierId: "", company: "WINGS", price: 128 }] });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toMatch(/Admin or the Payment Approver/i);
      expect(await prisma.product.findFirst({ where: { name: "BELT B-50" } })).toBeNull();
      expect(await prisma.productChange.count()).toBe(0);
    });

    it("refuses the Purchaser's Remove no-supplier items, and keeps the products", async () => {
      be("payment_approver");
      await createProduct({ name: "ORPHAN WIDGET", unit: "pc", suppliers: [] });

      be("purchaser");
      await expect(removeUnsourcedProducts()).rejects.toThrow(/Admin or the Payment Approver/i);
      expect(await prisma.product.count({ where: { active: true } })).toBe(1);

      // …and the price owner still can.
      be("payment_approver");
      expect(await removeUnsourcedProducts()).toEqual({ removed: 1 });
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

    // Was the Purchaser, who no longer adds stock items at all (the owner had
    // that button hidden). The Warehouse is now the non-owner who can create
    // one, so it carries the same point: the item lands, the price does not.
    it("creates the item unpriced for the Warehouse rather than refusing it", async () => {
      be("warehouse");
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

  /**
   * The three buttons the owner had hidden from the Purchaser — Add stock item,
   * Merge duplicates, Delete selected. Hidden on the screen AND refused by the
   * action: a button that is merely invisible is theatre, and the next person to
   * wire up a form would silently undo the rule.
   */
  describe("Buttons the Purchaser no longer has on Inventory", () => {
    it("refuses the Purchaser's Add stock item, Merge duplicates and Delete selected", async () => {
      be("admin");
      await createStockItem({ name: "BELT B-50", unit: "pc", quantity: 1, reorderLevel: 0, unitCost: 210, sellPrice: 300 });
      const id = (await prisma.stockItem.findFirst({ where: { name: "BELT B-50" } }))!.id;

      be("purchaser");
      await expect(createStockItem({ name: "NEW ITEM", unit: "pc", quantity: 0, reorderLevel: 0, unitCost: 0, sellPrice: 0 }))
        .rejects.toThrow(/Warehouse or an admin/i);
      await expect(mergeDuplicateStockItems()).rejects.toThrow(/Warehouse or an admin/i);
      await expect(removeStockItems([id])).rejects.toThrow(/admin/i);

      // Nothing moved: the item is still there and still active.
      expect(await prisma.stockItem.count({ where: { active: true } })).toBe(1);
      expect((await prisma.stockItem.findUnique({ where: { id } }))!.active).toBe(true);
    });

    it("still lets the Warehouse add an item, and the admin delete one", async () => {
      be("warehouse");
      await createStockItem({ name: "GI SHEET 24GA", unit: "sheet", quantity: 2, reorderLevel: 0, unitCost: 0, sellPrice: 0 });
      const id = (await prisma.stockItem.findFirst({ where: { name: "GI SHEET 24GA" } }))!.id;

      be("admin");
      expect(await removeStockItems([id])).toEqual({ removed: 1 });
      expect((await prisma.stockItem.findUnique({ where: { id } }))!.active).toBe(false);
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
