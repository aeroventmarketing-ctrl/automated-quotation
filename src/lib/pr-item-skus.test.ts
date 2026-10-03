/**
 * Carrying the catalogue code from the line that knows it to the form that
 * needs it — and NOT one step further.
 *
 * The owner: *"It will be better if products and inventory is referenced by
 * sku."* Two things have to hold at once: purchasing must stop guessing which
 * product a line is, and the supplier's copy of the purchase order must stay
 * free of our internal codes.
 */
import { describe, it, expect } from "vitest";
import { buildSkuIndex } from "./item-sku";
import { skusForLines } from "./pr-item-skus";
import { poLinesFromPRItems, coercePurchaseOrder, issuedFromStockLine } from "./purchase-order";
import { catalogKeyFor, suppliersForDescription, carriersForLines, type CatalogSuppliers, type CatalogSkuKeys } from "./po-catalog";

const VAV6 = 'NENUTEC VARIABLE AIR VOLUME 6" DIAMETER';
const SPEC = "Variable Air Volume · Complete with VAV Actuator & Thermostat · Duct Diameter: 250 mm (10 in)";
const INDEX = buildSkuIndex({
  products: [
    { name: VAV6, sku: "CAT00199" },
    { name: 'NENUTEC VARIABLE AIR VOLUME 10" DIAMETER', sku: "CAT00201" },
  ],
});

describe("recording what a line is, when it is composed", () => {
  it("reads the stored description, not the line a person sees", () => {
    // The MRF holds description and remark apart; this runs on the former.
    expect(skusForLines([{ description: VAV6 }, { description: "SOMETHING UNCATALOGUED" }], INDEX))
      .toEqual(["CAT00199", ""]);
  });

  it("keeps a hole for an unmatched line rather than dropping it", () => {
    // The array is aligned BY INDEX with `items`. A skipped entry would shift
    // every later code onto the wrong line — a silent, total corruption.
    const skus = skusForLines([{ description: "UNKNOWN A" }, { description: VAV6 }], INDEX);
    expect(skus).toHaveLength(2);
    expect(skus[1]).toBe("CAT00199");
  });
});

describe("pairing the codes onto PO lines", () => {
  const items = [
    `1 unit · ${VAV6} (${SPEC})`,
    "2 pc · ISSUED ITEM",
    `3 pc · NENUTEC VARIABLE AIR VOLUME 10" DIAMETER (${SPEC})`,
  ];

  it("pairs by index before the issued-from-stock lines are dropped", () => {
    // Issued lines never become PO lines. Filtering first would hand line 3's
    // code to line 2 — which is why the pairing happens before the filter.
    const issued = issuedFromStockLine(2, "pc", "ISSUED ITEM");
    const lines = poLinesFromPRItems([items[0], issued, items[2]], ["CAT00199", "", "CAT00201"]);
    expect(lines.map((l) => l.sku)).toEqual(["CAT00199", "CAT00201"]);
  });

  it("leaves the code off a line that has none", () => {
    expect(poLinesFromPRItems([items[0]], [""])[0]).not.toHaveProperty("sku");
    expect(poLinesFromPRItems([items[0]])[0]).not.toHaveProperty("sku");
  });
});

describe("resolving by code instead of by text", () => {
  const KEYS = [VAV6.toLowerCase(), 'nenutec variable air volume 10" diameter'];
  const SKU_KEYS: CatalogSkuKeys = { CAT00199: VAV6.toLowerCase(), CAT00201: 'nenutec variable air volume 10" diameter' };

  it("takes the code's answer over the text's", () => {
    // The description here is deliberately misleading — it names the 10" — and
    // the code still decides, because the code was recorded from the real line.
    expect(catalogKeyFor({ description: 'NENUTEC VARIABLE AIR VOLUME 10" DIAMETER', sku: "CAT00199" }, KEYS, SKU_KEYS))
      .toBe(VAV6.toLowerCase());
  });

  it("falls back to the text when there is no code", () => {
    expect(catalogKeyFor({ description: VAV6 }, KEYS, SKU_KEYS)).toBe(VAV6.toLowerCase());
  });

  it("falls back when the code names a product the catalogue no longer holds", () => {
    // A product renamed or removed since the request was raised. Resolving to
    // nothing would be worse than matching on text.
    expect(catalogKeyFor({ description: VAV6, sku: "CAT09999" }, KEYS, SKU_KEYS)).toBe(VAV6.toLowerCase());
  });

  it("finds the supplier of the product the code names", () => {
    const catalog: CatalogSuppliers = {
      [VAV6.toLowerCase()]: [{ id: "sup-ideal", company: "IDEAL CONTROLS INCORPORATED" }],
      'nenutec variable air volume 10" diameter': [{ id: "sup-other", company: "SOMEBODY ELSE" }],
    };
    // Text alone would land on the 10" product and its supplier.
    expect(suppliersForDescription('NENUTEC VARIABLE AIR VOLUME 10" DIAMETER', catalog, { sku: "CAT00199", skuKeys: SKU_KEYS }))
      .toEqual([{ id: "sup-ideal", company: "IDEAL CONTROLS INCORPORATED" }]);
    const lines = [{ description: 'NENUTEC VARIABLE AIR VOLUME 10" DIAMETER', qty: "1", unit: "pc", unitPrice: "", sku: "CAT00199" }];
    expect(carriersForLines(lines, catalog, SKU_KEYS).map((c) => c.company)).toEqual(["IDEAL CONTROLS INCORPORATED"]);
  });
});

/**
 * The guarantee that must survive all of the above: a purchase order is the
 * SUPPLIER'S copy. Our item codes decide the supplier and the price on the way
 * in; they do not travel out on the document.
 */
describe("the code stops at the form", () => {
  it("is dropped when the purchase order is saved", () => {
    const po = coercePurchaseOrder({
      poNumber: "PO-TEST-0001",
      date: "2026-10-03",
      supplier: { company: "IDEAL CONTROLS INCORPORATED", attention: "", address: "" },
      lines: [{ description: VAV6, qty: "1", unit: "pc", unitPrice: "30894", sku: "CAT00199" }],
    })!;
    expect(po.lines[0]).not.toHaveProperty("sku");
    expect(JSON.stringify(po)).not.toContain("CAT00199");
  });
});
