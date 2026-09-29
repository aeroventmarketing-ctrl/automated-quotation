import { describe, it, expect } from "vitest";
import { supplierLinkState, weakLinkCount, planSupplierWiring } from "./supplier-link";

/**
 * The three states a product's supplier link can be in, and the one that is
 * easy to get wrong: an id that no supplier answers to any more.
 */
describe("supplierLinkState", () => {
  const registry = [
    { id: "sup-ideal", company: "IDEAL CONTROLS INCORPORATED" },
    { id: "sup-zenith", company: "ZENITH UNITED ELECTRIC CORP." },
  ];

  it("calls a link wired by id linked, even when the name has since changed", () => {
    // This is the whole point: the registry says INCORPORATED, the product still
    // says the old name, and the link is sound because the id carries it.
    expect(supplierLinkState({ supplierId: "sup-ideal", company: "IDEAL CONTROLS" }, registry)).toBe("linked");
  });

  it("calls a link with no id name-only when the name is registered", () => {
    expect(supplierLinkState({ supplierId: "", company: "IDEAL CONTROLS INCORPORATED" }, registry)).toBe("name-only");
    // Case and stray spacing are not identity.
    expect(supplierLinkState({ supplierId: "", company: "  ideal controls incorporated " }, registry)).toBe("name-only");
  });

  it("calls a link unregistered when neither the id nor the name is in the list", () => {
    expect(supplierLinkState({ supplierId: "", company: "GOLDEN PACIFIC INC" }, registry)).toBe("unregistered");
  });

  /**
   * A DEAD id — the supplier it pointed at was deleted. The id must not be
   * trusted just because it is there; what matters is whether anything answers
   * to it.
   */
  it("does not treat an id nobody answers to as a link", () => {
    expect(supplierLinkState({ supplierId: "sup-deleted", company: "IDEAL CONTROLS INCORPORATED" }, registry)).toBe("name-only");
    expect(supplierLinkState({ supplierId: "sup-deleted", company: "GOLDEN PACIFIC INC" }, registry)).toBe("unregistered");
  });

  it("treats a blank or whitespace id as no id at all", () => {
    for (const supplierId of ["", "   "]) {
      expect(supplierLinkState({ supplierId, company: "ZENITH UNITED ELECTRIC CORP." }, registry)).toBe("name-only");
    }
  });

  it("reports nothing weak when every link is wired, and counts the rest", () => {
    expect(weakLinkCount([{ supplierId: "sup-ideal", company: "X" }], registry)).toBe(0);
    expect(
      weakLinkCount(
        [
          { supplierId: "sup-ideal", company: "IDEAL CONTROLS" },
          { supplierId: "", company: "ZENITH UNITED ELECTRIC CORP." },
          { supplierId: "", company: "GOLDEN PACIFIC INC" },
        ],
        registry,
      ),
    ).toBe(2);
  });

  /** An empty registry makes everything unregistered — never "linked". */
  it("never calls anything linked against an empty supplier list", () => {
    expect(supplierLinkState({ supplierId: "sup-ideal", company: "IDEAL CONTROLS" }, [])).toBe("unregistered");
  });
});

/**
 * The bulk backfill. It runs over the whole catalogue in one press, so what it
 * DOESN'T touch matters more than what it does.
 */
describe("planSupplierWiring", () => {
  const registry = [
    { id: "sup-ideal", company: "IDEAL CONTROLS INCORPORATED" },
    { id: "sup-zenith", company: "ZENITH UNITED ELECTRIC CORP." },
  ];
  const product = (id: string, suppliers: { supplierId: string; company: string; price?: number }[]) => ({ id, suppliers });

  it("wires a name-only link and leaves everything else on it alone", () => {
    const plan = planSupplierWiring(
      [product("p1", [{ supplierId: "", company: "ideal controls incorporated", price: 31894 }])],
      registry,
    );
    expect(plan.wired).toBe(1);
    expect(plan.updates).toEqual([
      // The id filled in, the name adopted from the registry, the price untouched.
      { id: "p1", suppliers: [{ supplierId: "sup-ideal", company: "IDEAL CONTROLS INCORPORATED", price: 31894 }] },
    ]);
  });

  it("does not rewrite a product that has nothing to gain", () => {
    const plan = planSupplierWiring(
      [product("p1", [{ supplierId: "sup-ideal", company: "IDEAL CONTROLS INCORPORATED" }])],
      registry,
    );
    expect(plan).toEqual({ updates: [], wired: 0, unmatched: 0, ambiguous: 0, leftoverProducts: 0 });
  });

  it("leaves a company that is not in the supplier list for a human", () => {
    const plan = planSupplierWiring([product("p1", [{ supplierId: "", company: "JOEL LATERO SHOP" }])], registry);
    expect(plan.updates).toEqual([]);
    expect({ wired: plan.wired, unmatched: plan.unmatched, leftoverProducts: plan.leftoverProducts })
      .toEqual({ wired: 0, unmatched: 1, leftoverProducts: 1 });
  });

  /** A tie is not resolved by picking the first row. */
  it("refuses to guess when two suppliers share a company name", () => {
    const twins = [
      { id: "sup-a", company: "TWIN TRADING" },
      { id: "sup-b", company: "Twin Trading" },
    ];
    const plan = planSupplierWiring([product("p1", [{ supplierId: "", company: "TWIN TRADING" }])], twins);
    expect(plan.updates).toEqual([]);
    expect({ wired: plan.wired, ambiguous: plan.ambiguous }).toEqual({ wired: 0, ambiguous: 1 });
  });

  it("repairs a dead id rather than trusting it", () => {
    const plan = planSupplierWiring(
      [product("p1", [{ supplierId: "sup-deleted", company: "ZENITH UNITED ELECTRIC CORP." }])],
      registry,
    );
    expect(plan.updates[0].suppliers[0].supplierId).toBe("sup-zenith");
  });

  it("writes the whole link list, wiring what it can and keeping the rest", () => {
    const plan = planSupplierWiring(
      [product("p1", [
        { supplierId: "", company: "IDEAL CONTROLS INCORPORATED" },
        { supplierId: "", company: "JOEL LATERO SHOP" },
      ])],
      registry,
    );
    expect(plan.updates[0].suppliers).toEqual([
      { supplierId: "sup-ideal", company: "IDEAL CONTROLS INCORPORATED" },
      { supplierId: "", company: "JOEL LATERO SHOP" },
    ]);
    expect({ wired: plan.wired, unmatched: plan.unmatched }).toEqual({ wired: 1, unmatched: 1 });
  });

  it("is a no-op the second time it runs", () => {
    const products = [product("p1", [{ supplierId: "", company: "IDEAL CONTROLS INCORPORATED" }])];
    const once = planSupplierWiring(products, registry);
    const twice = planSupplierWiring(once.updates, registry);
    expect(twice.updates).toEqual([]);
    expect(twice.wired).toBe(0);
  });
});
