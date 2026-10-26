import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: () => {} }));

const { toQuoteCatalogEntry } = await import("./quote-catalogue");

describe("the cached quotation catalogue", () => {
  it("carries exactly the fields the builder reads, as plain numbers", () => {
    const e = toQuoteCatalogEntry({
      modelCode: "AV1350DIDWCFAB",
      description: "Cabinet Blower-DIDW",
      specs: { bladeDia_in: 13.5, type: "Air Curtain", length_mm: 900, effectiveHeight_m: 3, power_w: 180, airVolume_cmh: 1500, ratings: [1, 2, 3] },
      priceList: [{ basePrice: "22738.00" }],
    });
    expect(e).toEqual({
      modelCode: "AV1350DIDWCFAB", description: "Cabinet Blower-DIDW", basePrice: 22738,
      bladeDia: 13.5, type: "Air Curtain", lengthMm: 900, heightM: 3, powerW: 180, airVolumeCmh: 1500,
    });
    // Survives the data cache unchanged.
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });
  it("an unpriced, spec-less item reads as before", () => {
    expect(toQuoteCatalogEntry({ modelCode: "X", description: null, specs: null, priceList: [] })).toEqual({
      modelCode: "X", description: "", basePrice: 0, bladeDia: null, type: null, lengthMm: null, heightM: null, powerW: null, airVolumeCmh: null,
    });
  });
});
