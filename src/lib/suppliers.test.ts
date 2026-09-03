import { describe, it, expect } from "vitest";
import { SUPPLIER_COLUMNS, mapSupplierHeaders, parseYesNo, coerceSuppliers } from "./suppliers";

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
