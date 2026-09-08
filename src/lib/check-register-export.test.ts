import { describe, it, expect } from "vitest";
import { CHECK_EXPORT_HEADERS, checkRegisterRow, checkRegisterTextRow, checkExportFileName } from "./check-register-export";
import type { CheckWatchRow } from "./check-monitor";

const row = (over: Partial<CheckWatchRow> = {}): CheckWatchRow => ({
  prId: "pr", path: "p", fileName: "c.jpg",
  poDate: "2026-09-01", poNumber: "PO-AFBM20260000609", supplier: "GOLDEN PACIFIC INC",
  orderId: null, checkNo: "0000486718", amount: 2695.71,
  clearingYMD: "2026-10-02", originalYMD: null, dateFixedBy: null, moves: 0, lastMoveReason: null,
  daysLeft: 24, dateVerified: true, state: "scheduled", clearedOn: null, clearedByName: null,
  statusLabel: "Check Clearing", form: "PDC", remarks: null,
  ...over,
});

/**
 * The owner: *"add an option to download in excel file and pdf file."* Two
 * formats, one row shape — otherwise the spreadsheet and the PDF drift into
 * disagreeing about the same register.
 */
describe("a register row, flattened for a file", () => {
  it("has a cell for every column, in the screen's order", () => {
    const cells = checkRegisterRow(row());
    expect(cells).toHaveLength(CHECK_EXPORT_HEADERS.length);
    expect(cells).toEqual([
      "2026-09-01", "GOLDEN PACIFIC INC", "PO-AFBM20260000609", "0000486718",
      2695.71, "2026-10-02", "PDC", "Check Clearing", "",
    ]);
  });

  /** The amount stays a NUMBER, or a spreadsheet cannot total the column. */
  it("keeps money as money for Excel, and as text for the PDF", () => {
    expect(checkRegisterRow(row())[4]).toBe(2695.71);
    expect(checkRegisterTextRow(row())[4]).toBe("2,695.71");
    // A check with no amount read is blank, not zero.
    expect(checkRegisterRow(row({ amount: null }))[4]).toBeNull();
    expect(checkRegisterTextRow(row({ amount: null }))[4]).toBe("");
  });

  it("shows a cleared check by the day it actually cleared", () => {
    const cells = checkRegisterRow(row({ state: "cleared", clearedOn: "2026-09-20", clearedByName: "Admin Ana" }));
    expect(cells[5]).toBe("2026-09-20");
    expect(String(cells[8])).toContain("cleared by Admin Ana");
  });

  /**
   * The notes the screen prints UNDER the date have nowhere to go in a fixed
   * grid, so they join the Remarks column — where they read as sentences.
   */
  it("carries the date's own notes into Remarks", () => {
    const cells = checkRegisterRow(row({
      remarks: "Correct date", originalYMD: "2026-07-12", moves: 2, dateFixedBy: "Rey Gil", dateVerified: false,
    }));
    const remarks = String(cells[8]);
    expect(remarks).toContain("Correct date");
    expect(remarks).toContain("moved from 2026-07-12 · 2 times");
    expect(remarks).toContain("date corrected by Rey Gil");
    expect(remarks).toContain("clearing date unconfirmed");
  });

  /**
   * A date column holds a date or nothing. A stored "not-a-date" — which a
   * hostile row really does carry — is not information, and printing it just
   * moves the confusion onto paper.
   */
  it("prints nothing for a value that is not a calendar day", () => {
    for (const bad of ["not-a-date", "", "2026-13-01", "2026-02-31", "01/10/2026"]) {
      expect(checkRegisterRow(row({ clearingYMD: bad }))[5], bad).toBe("");
    }
    expect(checkRegisterRow(row({ poDate: null }))[0]).toBe("");
  });

  it("names the file so four of them in a folder can be told apart", () => {
    expect(checkExportFileName("open", "2026-09-08", "xlsx")).toBe("check-register-to-clear-2026-09-08.xlsx");
    expect(checkExportFileName("cleared", "2026-09-08", "pdf")).toBe("check-register-cleared-2026-09-08.pdf");
  });
});
