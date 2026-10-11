/**
 * The Purchaser Plan's columns, as the owner ruled them:
 * open MRFs only · MRF status = the Purchasing tab name · purchase due date from
 * Purchasing · Type = "Purchase to supplier" / "For fabrication".
 */
import { describe, it, expect } from "vitest";
import {
  isPlanOpenMrf,
  planMrfStatus,
  purchasingTabName,
  earliestPurchaseDue,
  normaliseDueDate,
  sortPlanRows,
  isPlanType,
  planTypeLabel,
  planEditChange,
  planEditValue,
  type PlanPr,
  type PurchaserPlanRow,
} from "./purchaser-plan";

const pr = (status: PlanPr["status"], over: Partial<PlanPr> = {}): PlanPr => ({ status, kind: "order", mrfId: "m1", ...over });

describe("which MRFs are on the plan", () => {
  it.each(["requested", "issued", "purchasing", "partial"])("%s → on it", (s) => expect(isPlanOpenMrf(s)).toBe(true));
  it.each(["completed", "cancelled"])("%s → off it", (s) => expect(isPlanOpenMrf(s)).toBe(false));
});

describe("MRF status — the Purchasing tab it sits in", () => {
  it("a request awaiting approval is Pending", () => {
    expect(purchasingTabName(pr("PENDING_APPROVAL"))).toBe("Pending");
  });

  it("a Plant-Manager-approved MRF still awaiting the Approver is Pending — as the workspace shows it", () => {
    // Status reads APPROVED; the tab says Pending until approve_po is in.
    expect(purchasingTabName(pr("APPROVED", { mrfId: "m1", chainLog: {} }))).toBe("Pending");
    expect(purchasingTabName(pr("APPROVED", { mrfId: "m1", chainLog: { approve_po: { byName: "Rey Gil" } } }))).toBe("Approved");
  });

  it("voucher prepared is still Approved; signed onward is Budgeted", () => {
    expect(purchasingTabName(pr("VOUCHER_READY", { mrfId: null }))).toBe("Approved");
    expect(purchasingTabName(pr("VOUCHER_SIGNED", { mrfId: null }))).toBe("Budgeted");
    expect(purchasingTabName(pr("PURCHASED", { mrfId: null }))).toBe("Budgeted");
  });

  it("received into stock is Completed; the off-chain ones say so", () => {
    expect(purchasingTabName(pr("COMPLETED"))).toBe("Completed");
    expect(purchasingTabName(pr("REJECTED"))).toBe("Rejected");
    expect(purchasingTabName(pr("CANCELLED"))).toBe("Cancelled");
  });

  it("split requests: the one furthest BEHIND speaks for the MRF", () => {
    const behind = pr("PENDING_APPROVAL");
    const ahead = pr("PURCHASED", { mrfId: null });
    expect(planMrfStatus("purchasing", [ahead, behind])).toBe("Pending");
  });

  it("a rejected sibling doesn't drown out a live one", () => {
    expect(planMrfStatus("purchasing", [pr("REJECTED"), pr("VOUCHER_SIGNED", { mrfId: null })])).toBe("Budgeted");
  });

  it("…but speaks when nothing live is left", () => {
    expect(planMrfStatus("purchasing", [pr("CANCELLED")])).toBe("Cancelled");
  });

  it("an MRF that never reached Purchasing says where it is", () => {
    expect(planMrfStatus("requested", [])).toBe("Requested");
    expect(planMrfStatus("issued", [])).toBe("Issued from stock");
    expect(planMrfStatus("partial", [])).toBe("Partly issued");
  });
});

describe("purchase due date", () => {
  it("is the earliest across the MRF's requests, as a Manila day", () => {
    const due = earliestPurchaseDue([
      pr("APPROVED", { purchaseDueAt: "2026-10-20T00:00:00+08:00" }),
      pr("APPROVED", { purchaseDueAt: "2026-10-13T00:00:00+08:00" }),
      pr("APPROVED", { purchaseDueAt: null }),
    ]);
    expect(due).toBe("2026-10-13");
  });

  it("uses the Manila calendar — 23:30 UTC is already the next day in Manila", () => {
    expect(earliestPurchaseDue([pr("APPROVED", { purchaseDueAt: "2026-10-12T23:30:00Z" })])).toBe("2026-10-13");
  });

  it("is blank when none was set", () => {
    expect(earliestPurchaseDue([pr("APPROVED")])).toBeNull();
    expect(earliestPurchaseDue([])).toBeNull();
  });
});

describe("client due date as typed", () => {
  it("accepts a real day, refuses anything else", () => {
    expect(normaliseDueDate("2026-10-24")).toBe("2026-10-24");
    expect(normaliseDueDate("2026-02-30")).toBeNull();
    expect(normaliseDueDate("Oct 24")).toBeNull();
    expect(normaliseDueDate("")).toBeNull();
  });
});

describe("Type", () => {
  it("is one of the owner's two", () => {
    expect(isPlanType("purchase_to_supplier")).toBe(true);
    expect(isPlanType("for_fabrication")).toBe(true);
    expect(isPlanType("something else")).toBe(false);
    expect(planTypeLabel("for_fabrication")).toBe("For fabrication");
  });
});

describe("default order — purchase due date, soonest first", () => {
  const row = (mrfNo: string, purchaseDue: string | null, orderedDate: string | null): PurchaserPlanRow => ({
    key: mrfNo, quotationId: "q", mrfId: mrfNo, orderNo: "o", href: "#", orderedDate, accountHolder: "x", mrfNo,
    mrfStatus: "Pending", purchaseDue, type: null, typeByName: null, typeAt: null, clientDue: null, clientDueByName: null, clientDueAt: null, edits: [],
  });

  it("dated rows first, soonest first; undated last, by order date", () => {
    const out = sortPlanRows([
      row("0453", null, "2026-10-01"),
      row("0450", "2026-10-20", "2026-10-08"),
      row("0405", "2026-10-08", "2026-09-30"),
      row("0451", null, "2026-09-15"),
    ]);
    expect(out.map((r) => r.mrfNo)).toEqual(["0405", "0450", "0451", "0453"]);
  });
});

describe("the edit trail — how each change reads", () => {
  it("names the Type by its label", () => {
    expect(planEditChange({ field: "type", from: "", to: "for_fabrication" })).toBe("— → For fabrication");
    expect(planEditChange({ field: "type", from: "for_fabrication", to: "purchase_to_supplier" })).toBe("For fabrication → Purchase to supplier");
  });

  it("spells the dates out, and shows a cleared one as —", () => {
    expect(planEditChange({ field: "clientDue", from: "2026-10-24", to: "2026-10-30" })).toBe("Oct 24, 2026 → Oct 30, 2026");
    expect(planEditChange({ field: "clientDue", from: "2026-10-24", to: "" })).toBe("Oct 24, 2026 → —");
  });

  it("never shifts a date by a day, whatever the viewer's timezone", () => {
    // Formatted from the calendar day itself, not from a midnight instant.
    expect(planEditValue("clientDue", "2026-01-01")).toBe("Jan 1, 2026");
  });
});
