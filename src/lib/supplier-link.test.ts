import { describe, it, expect } from "vitest";
import { supplierLinkState, weakLinkCount } from "./supplier-link";

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
