import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { stampRushXlsx, withRushHeader } from "./rush-stamp";

const R = `&amp;R&amp;"Arial,Bold"&amp;16&amp;KFF0000RUSH ORDER`;

describe("the RUSH print header", () => {
  it("goes after pageSetup when there is no header yet", () => {
    const xml = `<worksheet><sheetData/><pageMargins left="0.5"/><pageSetup paperSize="9"/><drawing r:id="rId1"/></worksheet>`;
    expect(withRushHeader(xml, R)).toBe(`<worksheet><sheetData/><pageMargins left="0.5"/><pageSetup paperSize="9"/><headerFooter><oddHeader>${R}</oddHeader></headerFooter><drawing r:id="rId1"/></worksheet>`);
  });
  it("keeps an existing header's left and centre, replaces its right", () => {
    const xml = `<worksheet><headerFooter><oddHeader>&amp;LAeroVent&amp;CJob Order&amp;Rold</oddHeader><oddFooter>p</oddFooter></headerFooter></worksheet>`;
    expect(withRushHeader(xml, R)).toBe(`<worksheet><headerFooter><oddHeader>&amp;LAeroVent&amp;CJob Order${R}</oddHeader><oddFooter>p</oddFooter></headerFooter></worksheet>`);
  });
  it("fills an empty headerFooter", () => {
    expect(withRushHeader(`<worksheet><headerFooter/></worksheet>`, R)).toBe(`<worksheet><headerFooter><oddHeader>${R}</oddHeader></headerFooter></worksheet>`);
  });
  it("a real workbook reads back with the stamp and its cells intact", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("JO");
    ws.getCell("A1").value = "JOB ORDER";
    ws.getCell("B2").value = { formula: "1+1" };
    const stamped = await stampRushXlsx(Buffer.from(await wb.xlsx.writeBuffer()) as unknown as Buffer, "RUSH ORDER — due Nov 8, 2026");
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(stamped as unknown as ArrayBuffer);
    const s = back.getWorksheet("JO")!;
    expect(s.headerFooter.oddHeader).toContain("RUSH ORDER — due Nov 8, 2026");
    expect(s.getCell("A1").value).toBe("JOB ORDER");
    expect((s.getCell("B2").value as { formula: string }).formula).toBe("1+1");
  });
  it("only the named sheet when asked — the PO, not the 2307", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Purchase Order").getCell("A1").value = "PO";
    wb.addWorksheet("2307-JSL").getCell("A1").value = "BIR";
    const stamped = await stampRushXlsx(Buffer.from(await wb.xlsx.writeBuffer()) as unknown as Buffer, "RUSH ORDER", { sheetName: /^Purchase Order$/ });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(stamped as unknown as ArrayBuffer);
    expect(back.getWorksheet("Purchase Order")!.headerFooter?.oddHeader).toContain("RUSH ORDER");
    expect(back.getWorksheet("2307-JSL")!.headerFooter?.oddHeader ?? "").not.toContain("RUSH");
  });
  it("an unreadable file comes back unchanged", async () => {
    const junk = Buffer.from("not a zip");
    expect(await stampRushXlsx(junk, "RUSH")).toBe(junk);
  });
});
