import { describe, it, expect } from "vitest";
import { officeCostLookup, isModelCodeToken, windVentSupplierCost, type OfficeCostEntry } from "./department-pnl";

const entry = (name: string, unitCost: number, sku: string | null = null): OfficeCostEntry => ({ name, sku, unitCost, vatInclusive: true });

describe("a rating or size is not a model code", () => {
  it.each(["220v", "60hz", "3ph", "1hp", "5hp", "12in", "200x300", "12", "500", "380vac"])("%s", (t) => {
    expect(isModelCodeToken(t)).toBe(false);
  });
  it.each(["25nsb", "30aas", "dc500", "va1200"])("%s is", (t) => {
    expect(isModelCodeToken(t)).toBe(true);
  });
});

describe("Office cost matching", () => {
  // The owner's P&L: Office sales −₱16.1M. A line saying "220V" or "12" took the
  // cost of an unrelated product that also said "220V" / "12".
  const lookup = officeCostLookup([
    entry("Dust Collector DC500 220V 60Hz", 300_000),
    entry("Booster Pump 12", 45_000),
    entry("KDK Wall Mount Fan 30AAS", 2_100),
    entry("AlphaAir Duct Canvass Connector", 850),
    entry("Spring Isolator", 400, "ISO-SP-40"),
  ]);

  it("a shared voltage no longer pulls in an unrelated product's cost", () => {
    expect(lookup("KDK Exhaust Fan 220V 60Hz")).toBeNull();
  });
  it("a shared bare number no longer either", () => {
    expect(lookup("Roof Ventilator 12 inch")).toBeNull();
  });
  it("the real model code still prices the line, and says so", () => {
    expect(lookup("KDK Wall Fan 30AAS 220V")).toMatchObject({ unitCost: 2_100, product: "KDK Wall Mount Fan 30AAS", by: "model", via: "30aas" });
    expect(lookup("Dust collector DC500")).toMatchObject({ unitCost: 300_000, by: "model", via: "dc500" });
  });
  it("a product with only numbers, no model code, needs every word of its name — numbers included", () => {
    expect(lookup("Booster Pump 12")).toMatchObject({ unitCost: 45_000, by: "name" });
    expect(lookup("Booster Pump 15")).toBeNull();
  });
  it("name and SKU matches are unchanged", () => {
    expect(lookup("Duct Canvass Connector - AlphaAir")).toMatchObject({ unitCost: 850, by: "name" });
    expect(lookup("Isolator ISO-SP-40 foot mounted")).toMatchObject({ unitCost: 400, by: "sku" });
  });
});

describe("roof-ventilator grid", () => {
  it("names itself as the source", () => {
    expect(windVentSupplierCost({ type: "Wind Driven Roof Ventilator", size: "24", material: "Galvanized Iron" })).toMatchObject({ unitCost: 8_000, by: "grid" });
  });
});
