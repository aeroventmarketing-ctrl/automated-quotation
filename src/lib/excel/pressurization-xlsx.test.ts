import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildPressurizationWorkbook } from "./pressurization-xlsx";
import { solvePressurization, PRESS_SAMPLE, type PressResult } from "@/lib/hvac/pressurization";

describe("the pressurization calculation sheet", () => {
  it("carries every floor, the fan duty and the flags, as solved", async () => {
    const result = solvePressurization(PRESS_SAMPLE) as PressResult;
    const buf = await buildPressurizationWorkbook({ project: "Office tower — Stair 1", criteria: "EN 12101-6 Class A", input: PRESS_SAMPLE, result, preparedBy: "Elena Cruz", date: "October 14, 2026" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Stair pressurization")!;
    const text: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => text.push(String(c.value ?? ""))));
    const all = text.join(" | ");
    expect(all).toContain("Office tower — Stair 1");
    expect(all).toContain("Prepared by Elena Cruz");
    for (const f of result.rows) expect(text).toContain(f.name + (f.level === PRESS_SAMPLE.fireFloor ? " (fire)" : ""));
    expect(text).toContain(String(result.fanCfm));
    expect(text).toContain(String(result.fanPa));
    expect(all).toContain(`${result.overFloors.join(", ")}: over the`);
    expect(ws.views[0]).toMatchObject({ style: "pageBreakPreview", zoomScale: 120 });
  });
});
