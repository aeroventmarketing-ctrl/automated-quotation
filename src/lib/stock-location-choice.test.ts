import { describe, it, expect } from "vitest";
import { issueLocationChoice } from "./stock-location";

const row = (id: string, location: string, available: number) => ({ id, location, available });

describe("Office / Plant Warehouse: chosen automatically unless both have stock", () => {
  it("only the Plant Warehouse has it → the plant, no dropdown (PULLEY 3 1/2\", 18 pc)", () => {
    const c = issueLocationChoice([row("p", "Plant Warehouse", 18)], "motor");
    expect(c).toEqual({ row: row("p", "Plant Warehouse", 18), choose: false });
  });
  it("an empty Office row no longer hides the plant's stock", () => {
    const c = issueLocationChoice([row("o", "Office", 0), row("p", "Plant Warehouse", 5)], "office");
    expect(c.row?.id).toBe("p");
    expect(c.choose).toBe(false);
  });
  it("only Office has it → Office, no dropdown", () => {
    expect(issueLocationChoice([row("o", "Office", 2), row("p", "Plant Warehouse", 0)], "motor")).toMatchObject({ row: { id: "o" }, choose: false });
  });
  it("both have it → the dropdown, Office by default, the user's pick honoured", () => {
    const rows = [row("o", "Office", 2), row("p", "Plant Warehouse", 5)];
    expect(issueLocationChoice(rows, "motor")).toMatchObject({ row: { id: "o" }, choose: true });
    expect(issueLocationChoice(rows, "motor", "Plant Warehouse")).toMatchObject({ row: { id: "p" }, choose: true });
  });
  it("neither has it → no dropdown; the line reads out of stock", () => {
    expect(issueLocationChoice([row("o", "Office", 0), row("p", "Plant Warehouse", 0)], "motor")).toMatchObject({ row: { id: "o" }, choose: false });
  });
  it("plant-only departments never get Office stock or a dropdown", () => {
    expect(issueLocationChoice([row("o", "Office", 9), row("p", "Plant Warehouse", 0)], "fans")).toMatchObject({ row: { id: "p" }, choose: false });
    expect(issueLocationChoice([row("o", "Office", 9)], "duct")).toEqual({ row: undefined, choose: false });
  });
});
