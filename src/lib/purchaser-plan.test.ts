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
  purchaseDueTone,
  dueCountdown,
  sortPlanBy,
  groupPlan,
  receivedOn,
  purchaseDoneTone,
  doneSummary,
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
    mrfStatus: "Pending", purchaseDue, receivedOn: null, type: null, typeByName: null, typeAt: null, clientDue: null, clientDueByName: null, clientDueAt: null, edits: [],
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

// --- Purchase due date colour ----------------------------------------------------

describe("the Purchase due date colour — the owner's four bands", () => {
  const TODAY = "2026-10-11";
  it.each([
    ["2026-10-10", "overdue"], // yesterday → red
    ["2026-09-01", "overdue"],
    ["2026-10-11", "due3"],    // due today is not late yet → amber
    ["2026-10-14", "due3"],    // 3 days away → amber
    ["2026-10-15", "due7"],    // 4 days away → yellow
    ["2026-10-18", "due7"],    // 7 days away → yellow
    ["2026-10-19", "ontime"],  // 8 days away → green
    ["2026-12-25", "ontime"],
  ])("due %s → %s", (due, tone) => {
    expect(purchaseDueTone(due, TODAY)).toBe(tone);
  });

  it("no due date → no colour", () => {
    expect(purchaseDueTone(null, TODAY)).toBeNull();
  });

  it("counts calendar days across a month end", () => {
    expect(purchaseDueTone("2026-11-03", "2026-10-31")).toBe("due3"); // 3 days
    expect(purchaseDueTone("2026-11-08", "2026-10-31")).toBe("ontime"); // 8 days
  });

  it("says how far off, in words", () => {
    expect(dueCountdown("2026-10-09", TODAY)).toBe("Overdue by 2 days");
    expect(dueCountdown("2026-10-10", TODAY)).toBe("Overdue by 1 day");
    expect(dueCountdown("2026-10-11", TODAY)).toBe("Due today");
    expect(dueCountdown("2026-10-12", TODAY)).toBe("Due in 1 day");
    expect(dueCountdown("2026-10-16", TODAY)).toBe("Due in 5 days");
  });
});

// --- Sort and group --------------------------------------------------------------
describe("sort and group", () => {
  const r = (mrfNo: string, over: Partial<PurchaserPlanRow> = {}): PurchaserPlanRow => ({
    key: mrfNo, quotationId: "q", mrfId: mrfNo, orderNo: "2026 - AFBM00003747A", href: "#", orderedDate: "2026-10-08",
    accountHolder: "May-Ann Asong", mrfNo, mrfStatus: "Pending", purchaseDue: null, receivedOn: null, type: null, typeByName: null, typeAt: null,
    clientDue: null, clientDueByName: null, clientDueAt: null, edits: [], ...over,
  });
  const rows = [
    r("0450", { purchaseDue: "2026-10-20", clientDue: "2026-10-24", mrfStatus: "Budgeted", type: "for_fabrication", accountHolder: "Kurt Calucin" }),
    r("0451", { purchaseDue: null, mrfStatus: "Requested", accountHolder: "Desiree Enigo" }),
    r("0405", { purchaseDue: "2026-10-08", clientDue: "2026-10-09", mrfStatus: "Approved", type: "purchase_to_supplier", orderNo: "2026 - AFBM00003651A", orderedDate: "2026-09-30" }),
  ];
  const order = (rs: PurchaserPlanRow[]) => rs.map((x) => x.mrfNo);

  it("ascending and descending, with blanks last both ways", () => {
    expect(order(sortPlanBy(rows, "purchaseDue", "asc"))).toEqual(["0405", "0450", "0451"]);
    expect(order(sortPlanBy(rows, "purchaseDue", "desc"))).toEqual(["0450", "0405", "0451"]);
  });

  it("status sorts by stage, not alphabet — Requested before Approved", () => {
    expect(order(sortPlanBy(rows, "mrfStatus", "asc"))).toEqual(["0451", "0405", "0450"]);
    expect(order(sortPlanBy(rows, "mrfStatus", "desc"))).toEqual(["0450", "0405", "0451"]);
  });

  it("type sorts as listed, untyped last", () => {
    expect(order(sortPlanBy(rows, "type", "asc"))).toEqual(["0405", "0450", "0451"]);
    expect(order(sortPlanBy(rows, "type", "desc"))).toEqual(["0450", "0405", "0451"]);
  });

  it("text columns sort A–Z / Z–A", () => {
    expect(order(sortPlanBy(rows, "accountHolder", "asc"))).toEqual(["0451", "0450", "0405"]);
    expect(order(sortPlanBy(rows, "orderNo", "desc"))).toEqual(["0450", "0451", "0405"]);
  });

  it("groups dates by month, with 'No date' last", () => {
    const g = groupPlan(rows, "purchaseDue", "purchaseDue", "asc");
    expect(g.map((x) => [x.label, order(x.rows)])).toEqual([["October 2026", ["0405", "0450"]], ["No date", ["0451"]]]);
  });

  it("grouping and sorting on the same column turns the groups around too — but 'No date' stays last", () => {
    const g = groupPlan([...rows, r("0500", { purchaseDue: "2026-11-02" })], "purchaseDue", "purchaseDue", "desc");
    expect(g.map((x) => x.label)).toEqual(["November 2026", "October 2026", "No date"]);
  });

  it("groups by status in stage order, each group sorted by the chosen key", () => {
    const g = groupPlan(rows, "mrfStatus", "orderedDate", "asc");
    expect(g.map((x) => x.label)).toEqual(["Requested", "Approved", "Budgeted"]);
  });

  it("groups by type with the untyped last", () => {
    const g = groupPlan(rows, "type", "purchaseDue", "asc");
    expect(g.map((x) => x.label)).toEqual(["Purchase to supplier", "For fabrication", "No type yet"]);
  });

  it("no grouping is one group holding everything, sorted", () => {
    const g = groupPlan(rows, "none", "clientDue", "asc");
    expect(g).toHaveLength(1);
    expect(order(g[0].rows)).toEqual(["0405", "0450", "0451"]);
  });
});

// --- After the purchase: where the MRF really is, and how the purchase went -----
describe("a purchase received into stock no longer reads 'Completed'", () => {
  // The owner: "how do we know … that the MRF is completed?" — it wasn't; only
  // the purchase was. The MRF is done only when the department confirms receipt.
  const done = pr("COMPLETED");
  it("not yet released by the Warehouse", () => {
    expect(planMrfStatus("purchasing", [done])).toBe("Received in stock · awaiting release");
  });
  it("partly released", () => {
    expect(planMrfStatus("partial", [done])).toBe("Partly released");
  });
  it("released, waiting for the department to confirm", () => {
    expect(planMrfStatus("issued", [done])).toBe("Released · awaiting confirmation");
  });
  it("a split MRF is only 'received' when the request furthest behind is", () => {
    expect(planMrfStatus("purchasing", [done, pr("PURCHASED", { mrfId: null })])).toBe("Budgeted");
  });
});

describe("when the purchase was received — the Warehouse's Receive & Add Stock", () => {
  // The owner: "Better reference for this is when warehouseman press the button
  // Receive & Add to stock."
  it("is the Manila day Receive & Add Stock was pressed", () => {
    expect(receivedOn([pr("COMPLETED", { receivedAt: "2026-09-09T23:30:00Z" })])).toBe("2026-09-10");
  });
  it("is null while the request isn't completed — bought is not received", () => {
    expect(receivedOn([pr("PURCHASED", { receivedAt: null })])).toBeNull();
    expect(receivedOn([pr("PLANT_APPROVED", { receivedAt: null })])).toBeNull();
  });
  it("ignores a stale timestamp on a request that isn't completed", () => {
    expect(receivedOn([pr("RECEIVED", { receivedAt: "2026-09-10T02:00:00Z" })])).toBeNull();
  });
  it("for a split MRF, waits for the LAST piece to be received", () => {
    expect(receivedOn([pr("COMPLETED", { receivedAt: "2026-09-08T02:00:00Z" }), pr("PURCHASED")])).toBeNull();
    expect(receivedOn([pr("COMPLETED", { receivedAt: "2026-09-08T02:00:00Z" }), pr("COMPLETED", { receivedAt: "2026-09-12T02:00:00Z" })])).toBe("2026-09-12");
  });
  it("ignores rejected and cancelled siblings", () => {
    expect(receivedOn([pr("CANCELLED"), pr("COMPLETED", { receivedAt: "2026-09-08T02:00:00Z" })])).toBe("2026-09-08");
  });
});

describe("on time or late, once received", () => {
  it("on or before the due date → on time", () => {
    expect(purchaseDoneTone("2026-09-10", "2026-09-10")).toBe("ontime");
    expect(purchaseDoneTone("2026-09-10", "2026-09-08")).toBe("ontime");
    expect(doneSummary("2026-09-10", "2026-09-08")).toBe("on time");
  });
  it("after it → late, by how many days", () => {
    expect(purchaseDoneTone("2026-09-08", "2026-09-10")).toBe("late");
    expect(doneSummary("2026-09-08", "2026-09-10")).toBe("2 days late");
    expect(doneSummary("2026-09-08", "2026-09-09")).toBe("1 day late");
  });
  it("no due date → nothing to be late against", () => {
    expect(purchaseDoneTone(null, "2026-09-10")).toBe("ontime");
  });
});
