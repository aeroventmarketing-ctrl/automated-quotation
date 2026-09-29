import { describe, it, expect } from "vitest";
import { SUPPLIER_COLUMNS, mapSupplierHeaders, parseYesNo, coerceSuppliers, isPricedSupplierName, derivedSupplierId } from "./suppliers";

/**
 * The supplier import's header matcher, and the one trap in it.
 *
 * `remarks` matches the aliases "terms" and "payment terms" with a `contains`
 * fallback. A "Gives Terms (yes/no)" column contains "terms", so on the obvious
 * ordering Remarks eats it: the import reports success, and every supplier
 * silently reads "Cash". That is exactly the failure mode the check-photo
 * reminder is built on, so it is pinned here rather than left to be noticed.
 */
describe("mapSupplierHeaders", () => {
  const TEMPLATE = SUPPLIER_COLUMNS.map((c) => c.label);

  it("maps our own downloaded template, every column to itself", () => {
    const cols = mapSupplierHeaders(TEMPLATE);
    SUPPLIER_COLUMNS.forEach((c, i) => {
      expect(cols[c.key as keyof typeof cols], `${c.label} → ${c.key}`).toBe(i);
    });
  });

  it("does not let Remarks swallow the Gives Terms column", () => {
    const cols = mapSupplierHeaders(["Company Name", "Gives Terms (yes/no)", "Remarks"]);
    expect(cols.terms).toBe(1);
    expect(cols.remarks).toBe(2);
  });

  it("still reads a free-text 'Payment Terms' column as Remarks", () => {
    // The customer's own files use this header for the PO remark. It must NOT be
    // read as the yes/no flag.
    const cols = mapSupplierHeaders(["Company Name", "Payment Terms"]);
    expect(cols.remarks).toBe(1);
    expect(cols.terms).toBeUndefined();
  });

  it("leaves both flags unset when the file has neither column", () => {
    const cols = mapSupplierHeaders(["Company", "Contact Person", "Notes"]);
    expect(cols.ewt).toBeUndefined();
    expect(cols.terms).toBeUndefined();
    expect(cols.company).toBe(0);
    expect(cols.remarks).toBe(2);
  });

  it("accepts the header a person is likely to type by hand", () => {
    const cols = mapSupplierHeaders(["Supplier", "EWT", "Gives us terms"]);
    expect(cols.company).toBe(0);
    expect(cols.ewt).toBe(1);
    expect(cols.terms).toBe(2);
  });
});

describe("parseYesNo", () => {
  it("reads yes-ish and no-ish cells", () => {
    for (const v of [true, "yes", "Y", "TRUE", "1", "with terms"]) expect(parseYesNo(v)).toBe(true);
    for (const v of [false, "no", "N", "false", "0", "cash", "no terms"]) expect(parseYesNo(v)).toBe(false);
  });

  it("returns undefined for a blank or unreadable cell, so a partial import preserves the flag", () => {
    for (const v of ["", "   ", null, undefined, "maybe"]) expect(parseYesNo(v)).toBeUndefined();
  });
});

describe("coerceSuppliers", () => {
  /**
   * The id is now a LINK, not a label: products store `supplierId` and the PO
   * picker resolves by it. So an id that changes between two reads of the same
   * unchanged record is not untidy — it is a link that stops resolving.
   */
  it("gives a supplier with no stored id the same id on every read", () => {
    const stored = { list: [{ company: "IDEAL CONTROLS INCORPORATED" }] };
    const [first] = coerceSuppliers(stored);
    const [second] = coerceSuppliers(stored);
    expect(first.id).toBe(second.id);
    expect(first.id).toBe(derivedSupplierId("IDEAL CONTROLS INCORPORATED"));
    // Derived, so it can never be mistaken for — or collide with — a real one.
    expect(first.id.startsWith("name:")).toBe(true);
  });

  it("keeps a stored id, and does not derive over a blank one twice differently", () => {
    const [kept] = coerceSuppliers({ list: [{ id: "sup-1", company: "ACME" }] });
    expect(kept.id).toBe("sup-1");
    // A blank / whitespace id is "none stored", not an id of its own.
    for (const id of ["", "   "]) {
      expect(coerceSuppliers({ list: [{ id, company: "ACME" }] })[0].id).toBe(derivedSupplierId("ACME"));
    }
  });

  it("derives the same id for the same company however it is typed", () => {
    // Casing and surrounding space are not identity; the registry is one list
    // and two rows differing only in those are the same supplier to a link.
    expect(derivedSupplierId("  Acme Steel  ")).toBe(derivedSupplierId("ACME STEEL"));
  });

  it("defaults `terms` to false on records saved before the flag existed", () => {
    const [s] = coerceSuppliers({ list: [{ id: "a", company: "ACME" }] });
    expect(s.terms).toBe(false);
    expect(s.ewt).toBe(false);
  });

  it("keeps a stored terms flag", () => {
    const [s] = coerceSuppliers({ list: [{ id: "a", company: "ACME", terms: true }] });
    expect(s.terms).toBe(true);
  });
});

/**
 * Which rows are junk, and — more importantly — which only LOOK like junk.
 *
 * A supplier row showing nothing but dashes across Address, TIN, ZIP, Bank,
 * Account and Remarks is **not** an empty row. `rememberSupplier` creates
 * exactly that shape every time a purchaser issues a PO to a new supplier: the
 * company name is filled in and nothing else is known yet. Those rows are the
 * suppliers real POs were issued to, and deleting them would take the directory
 * with it. The sparse ones are pinned here because a wide table scrolled
 * sideways hides the Company column and makes them look blank.
 */
describe("supplier rows that only look empty", () => {
  it("keeps a supplier that has a name and nothing else", () => {
    // The shape `rememberSupplier` writes when a PO is issued to a new supplier.
    const [s] = coerceSuppliers({ list: [{ id: "a", company: "NAME ONLY SUPPLIER" }] });
    expect(s.company).toBe("NAME ONLY SUPPLIER");
    expect([s.address, s.tin, s.zip, s.bankName, s.accountNumber, s.remarks]).toEqual(["", "", "", "", "", ""]);
    expect(isPricedSupplierName(s.company)).toBe(false);
  });

  it("drops a row with no company name at all, on read", () => {
    // The name is the supplier's identity, so a nameless row is unreachable —
    // and never reaches the UI, the PO picker, or getSuppliers() to begin with.
    expect(coerceSuppliers({ list: [{ id: "a", company: "" }, { id: "b", company: "   " }] })).toEqual([]);
  });

  it("flags only genuine import junk as invalid", () => {
    // A product export's "Suppliers" cell imported as a company name.
    expect(isPricedSupplierName("RITE PRODUCTS INC. \u20b18078.02")).toBe(true);
    expect(isPricedSupplierName("A \u20b11; B \u20b12")).toBe(true);
    // …and never a real company, however sparse its record.
    for (const name of ["NAME ONLY SUPPLIER", "TOZEN PHILIPPINES INC.", "J & J HARDWARE", "3M"]) {
      expect(isPricedSupplierName(name), name).toBe(false);
    }
  });
});
