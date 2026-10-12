import { describe, it, expect } from "vitest";
import { formatTin, parseIssuedOn, formatIssuedOn, fieldsFromRead, coerceBir2303, isBir2303Path } from "./bir2303";

describe("TIN & Branch Code", () => {
  it("keeps the owner's sample exactly — a 5-digit head-office branch code", () => {
    expect(formatTin("201-616-609-00000")).toEqual({ ok: true, value: "201-616-609-00000" });
  });
  it("formats bare digits and spaces the way BIR prints them", () => {
    expect(formatTin("20161660900000")).toEqual({ ok: true, value: "201-616-609-00000" });
    expect(formatTin("201 616 609 000")).toEqual({ ok: true, value: "201-616-609-000" });
    expect(formatTin("201616609")).toEqual({ ok: true, value: "201-616-609" });
  });
  it("never pads or trims a branch code — a 4-digit one is refused, not 'fixed'", () => {
    const r = formatTin("201-616-609-0000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/13 digits/);
  });
  it("empty is allowed (clears the TIN)", () => {
    expect(formatTin("  ")).toEqual({ ok: true, value: "" });
  });
});

describe("TIN Issuance Date", () => {
  it("reads the certificate's own wording", () => {
    expect(parseIssuedOn("January 29, 1999")).toBe("1999-01-29");
    expect(parseIssuedOn("Jan 29 1999")).toBe("1999-01-29");
    expect(parseIssuedOn("1999-01-29")).toBe("1999-01-29");
  });
  it("refuses a date that doesn't exist instead of rolling it over", () => {
    expect(parseIssuedOn("February 30, 2020")).toBeNull();
    expect(parseIssuedOn("Smarch 3, 2020")).toBeNull();
    expect(parseIssuedOn("")).toBeNull();
  });
  it("prints back the way the form does", () => {
    expect(formatIssuedOn("1999-01-29")).toBe("January 29, 1999");
    expect(formatIssuedOn("")).toBe("");
  });
});

describe("turning an AI read into form values", () => {
  it("the owner's sample certificate fills all five", () => {
    const { fields, warnings } = fieldsFromRead({
      isBir2303: true,
      tin: "201-616-609-00000",
      taxpayerName: "Gil, Reyjellan Latican",
      tinIssuedOn: "1999-01-29",
      taxpayerType: "Single Proprietorship Only",
      registeredAddress: "7635 Narra Road Bayan-bayanan  San Vicente 4023 San Pedro Laguna Philippines",
      confidence: 0.95,
      warnings: [],
    });
    expect(fields).toEqual({
      tin: "201-616-609-00000",
      taxpayerName: "Gil, Reyjellan Latican",
      tinIssuedOn: "1999-01-29",
      taxpayerType: "Single Proprietorship Only",
      registeredAddress: "7635 Narra Road Bayan-bayanan San Vicente 4023 San Pedro Laguna Philippines",
    });
    expect(warnings).toEqual([]);
  });
  it("a field the code can't stand behind comes back empty, with the reason", () => {
    const { fields, warnings } = fieldsFromRead({ tin: "201-616-60", tinIssuedOn: "sometime in 1999", confidence: 0.4 });
    expect(fields.tin).toBe("");
    expect(fields.tinIssuedOn).toBe("");
    expect(warnings.join(" ")).toMatch(/TIN not filled in/);
    expect(warnings.join(" ")).toMatch(/issuance date not filled in/);
    expect(warnings.join(" ")).toMatch(/isn't clear enough/);
  });
  it("says so when the file isn't a 2303 at all", () => {
    expect(fieldsFromRead({ isBir2303: false }).warnings[0]).toMatch(/doesn't look like a BIR Form 2303/);
  });
});

describe("the stored record", () => {
  it("drops what's malformed instead of throwing", () => {
    expect(coerceBir2303(null)).toBeUndefined();
    expect(coerceBir2303({ tinIssuedOn: "Jan 29" })).toBeUndefined();
    expect(coerceBir2303({ taxpayerName: " Gil ", doc: { path: "customers/c1/bir2303/a.jpg" }, readCounts: { a: 2, b: -1 } })).toEqual({
      taxpayerName: "Gil",
      doc: { path: "customers/c1/bir2303/a.jpg", name: "a.jpg", uploadedAt: "" },
      readCounts: { a: 2 },
    });
  });
  it("a file belongs to its own client's folder only", () => {
    expect(isBir2303Path("c1", "customers/c1/bir2303/x.pdf")).toBe(true);
    expect(isBir2303Path("c1", "customers/c2/bir2303/x.pdf")).toBe(false);
    expect(isBir2303Path("c1", "customers/c1/bir2303/../../sales/x.pdf")).toBe(false);
    expect(isBir2303Path("", "customers//bir2303/x.pdf")).toBe(false);
  });
});
