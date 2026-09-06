import { describe, it, expect } from "vitest";
import { buildSkuIndex, skuFor, normalizeItemName, EMPTY_SKU_INDEX } from "./item-sku";
import { coercePurchaseOrder, type PurchaseOrder } from "./purchase-order";
import { renderPurchaseOrderHtml } from "./po-html";

const STOCK = [
  { name: 'G.I. BOLT 3/8"Ø x 1" length', sku: "10001" },
  { name: "COTTON GLOVES W/ RUBBER", sku: "10002" },
  { name: "SHARED ITEM", sku: "10003" },
  // An item nobody ever gave a code to.
  { name: "MISC CONSUMABLE", sku: null },
];
const PRODUCTS = [
  { name: 'DRILL BIT 3/16" COBALT', sku: "PRD10044" },
  { name: "SHARED ITEM", sku: "PRD10045" },
  { name: "NO CODE YET", sku: "" },
];
const INDEX = buildSkuIndex({ stock: STOCK, products: PRODUCTS });

/**
 * The owner: *"Show the sku number at the right side of the item. Show it in
 * mrf, requisition, PO or anywhere it can show."*
 *
 * Those documents keep their items as free text, so the code has to be looked up
 * by name — the same join the MRF form already makes when it validates a
 * description against the catalogue.
 */
describe("finding an item's code", () => {
  it("finds it in the warehouse and in the product list", () => {
    expect(skuFor('G.I. BOLT 3/8"Ø x 1" length', INDEX)).toBe("10001");
    expect(skuFor('DRILL BIT 3/16" COBALT', INDEX)).toBe("PRD10044");
  });

  /**
   * Stock wins. They are different series — `10001` on the bin and the barcode,
   * `PRD10001` in the product list — and a person reading an MRF line is on
   * their way to a shelf.
   */
  it("prefers the warehouse's code where an item is in both", () => {
    expect(skuFor("SHARED ITEM", INDEX)).toBe("10003");
    // The precedence belongs to the function, not to how a caller happened to
    // write the object — so no call site can flip it by reordering two keys.
    expect(skuFor("SHARED ITEM", buildSkuIndex({ products: PRODUCTS, stock: STOCK }))).toBe("10003");
    // With only the catalogue to hand, the catalogue's code is the answer.
    expect(skuFor("SHARED ITEM", buildSkuIndex({ products: PRODUCTS }))).toBe("PRD10045");
  });

  it("ignores the differences between two typings of the same item", () => {
    expect(skuFor('  g.i. bolt 3/8"Ø   x 1" LENGTH ', INDEX)).toBe("10001");
    expect(normalizeItemName("  A  B  ")).toBe("a b");
  });

  /**
   * The inch marks and the punctuation ARE the item: a 3/8" bolt is not a 3/8
   * bolt. Normalising them away would hand back a confident wrong code.
   */
  it("does not normalise away anything that distinguishes two items", () => {
    expect(skuFor('G.I. BOLT 3/8Ø x 1 length', INDEX)).toBeNull();
    expect(skuFor("GI BOLT", INDEX)).toBeNull();
  });

  /**
   * Null, never a placeholder. A line with no code is one somebody typed by
   * hand, and "—" on every such row would train the eye past the real codes.
   */
  it("says nothing rather than something for an item it doesn't know", () => {
    expect(skuFor("A THING NOBODY STOCKS", INDEX)).toBeNull();
    expect(skuFor("MISC CONSUMABLE", INDEX)).toBeNull(); // in stock, but has no code
    expect(skuFor("NO CODE YET", INDEX)).toBeNull(); // blank is not a code
    expect(skuFor("", INDEX)).toBeNull();
    expect(skuFor(null, INDEX)).toBeNull();
    expect(skuFor(undefined, INDEX)).toBeNull();
  });

  it("copes with a page that has no catalogue to hand", () => {
    expect(skuFor("SHARED ITEM", EMPTY_SKU_INDEX)).toBeNull();
    expect(buildSkuIndex({}).size).toBe(0);
    expect(skuFor("SHARED ITEM", buildSkuIndex({ stock: [], products: [] }))).toBeNull();
  });
});

/**
 * *"Do not show the sku to downloaded excel or csv file for submission to
 * supplier."*
 *
 * The guarantee is structural rather than a filter somebody has to remember: the
 * supplier's copy is built from `POLine`, `POLine` has no code on it, and
 * `coercePurchaseOrder` drops every field it does not name. So there is nothing
 * to strip — a code can only reach a supplier by first being written INTO the
 * description, which is the one thing this design never does.
 *
 * Asserted here rather than left to the shape of the type, because a type is not
 * a promise once someone adds a field to it.
 */
describe("the supplier's copy", () => {
  const po: PurchaseOrder = coercePurchaseOrder({
    poNumber: "PO-AFBM20260000661",
    date: "2026-09-05",
    supplier: { company: "YALE HARDWARE CORPORATION", attention: "", address: "" },
    // Somebody adds a code to a PO line — by hand, by a future edit, by mistake.
    lines: [{ description: 'DRILL BIT 3/16" COBALT', qty: "1", unit: "pc", unitPrice: "180", sku: "PRD10044" }],
    createdByName: "Allan Ramos",
  })!;

  it("has nowhere to keep an item code, so one cannot be smuggled onto it", () => {
    expect(po.lines[0]).not.toHaveProperty("sku");
    expect(JSON.stringify(po)).not.toContain("PRD10044");
  });

  it("prints the description and nothing that looks like a code", () => {
    const html = renderPurchaseOrderHtml(po);
    expect(html).toContain('DRILL BIT 3/16&quot; COBALT');
    expect(html).not.toContain("PRD10044");
    expect(html).not.toMatch(/SKU/i);
  });

  /**
   * The reason the guarantee holds: the code is rendered BESIDE the description,
   * never inside it. If it were ever appended to the text, every export would
   * carry it and no test of the export would notice.
   */
  it("keeps the code out of the text the export reads", () => {
    const desc = 'DRILL BIT 3/16" COBALT';
    expect(skuFor(desc, INDEX)).toBe("PRD10044");
    expect(desc).not.toContain("PRD10044"); // the lookup key is untouched by the answer
  });
});
