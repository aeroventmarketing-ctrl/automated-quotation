import { describe, it, expect } from "vitest";
import { jobOrderTasks } from "./job-order-tasks";

const none = { fans: false, duct: false, accessories: false, motor: false };
const wf = (over: Record<string, unknown> = {}) => ({
  stage: "released", jobOrders: {}, approvals: { payment_cleared: { byName: "Rey Gil", at: "2026-11-04T08:58:00.000Z" } },
  fansJobOrders: [], ductJobOrders: [], accessoriesJobOrders: [], motorJobOrders: [], ...over,
}) as never;
const approved = { approvedByName: "JayR Basal", approvedAt: "2026-11-05T01:00:00.000Z" };
const pending = { approvedByName: "", approvedAt: "" };

// The owner: notify the Engineer and the admin "if they must create a job order,
// approve job order or issue job order".
describe("one task per department — its earliest outstanding step", () => {
  it("create: the quotation needs the department, no job order yet", () => {
    expect(jobOrderTasks(wf(), { ...none, fans: true })).toEqual([
      { dept: "fans", step: "create", action: "Create Fans & Blower job order", since: "2026-11-04T08:58:00.000Z" },
    ]);
  });
  it("approve: a job order not approved yet (screenshot 2 — ACCE-JO2600104)", () => {
    expect(jobOrderTasks(wf({ accessoriesJobOrders: [pending] }), { ...none, accessories: true }).map((t) => t.action)).toEqual(["Approve Accessories job order"]);
  });
  it("issue: every job order approved, department not issued yet", () => {
    const t = jobOrderTasks(wf({ motorJobOrders: [approved] }), { ...none, motor: true });
    expect(t).toEqual([{ dept: "motor", step: "issue", action: "Issue Motor Controller job order", since: approved.approvedAt }]);
  });
  it("nothing once issued with every job order approved (screenshot 1 — Motor Controller)", () => {
    expect(jobOrderTasks(wf({ stage: "in_production", jobOrders: { motor: { status: "issued" } }, motorJobOrders: [approved] }), { ...none, motor: true })).toEqual([]);
  });
  it("an added job order that isn't approved still asks, even after issue", () => {
    const t = jobOrderTasks(wf({ stage: "producing", jobOrders: { fans: { status: "in_production" } }, fansJobOrders: [approved, pending] }), { ...none, fans: true });
    expect(t.map((x) => x.step)).toEqual(["approve"]);
  });
  it("several departments, each on its own step", () => {
    const t = jobOrderTasks(wf({ ductJobOrders: [approved], accessoriesJobOrders: [pending] }), { fans: true, duct: true, accessories: true, motor: false });
    expect(t.map((x) => x.action)).toEqual(["Create Fans & Blower job order", "Issue Duct job order", "Approve Accessories job order"]);
  });
  it("create even when the department was issued without a document — until its production is finished", () => {
    // The owner: "Create duct job order is showing but create motor controller job order and
    // create fans and blowers job order is not" — those two had been issued first.
    const t = jobOrderTasks(
      wf({ stage: "in_production", jobOrders: { fans: { status: "issued" }, motor: { status: "in_production" }, accessories: { status: "finished" } } }),
      { fans: true, duct: true, accessories: true, motor: true },
    );
    expect(t.map((x) => x.action)).toEqual(["Create Fans & Blower job order", "Create Duct job order", "Create Motor Controller job order"]);
  });
  it("a department the order doesn't touch, and stages outside Phase 2, have nothing", () => {
    expect(jobOrderTasks(wf(), none)).toEqual([]);
    expect(jobOrderTasks(wf({ stage: "docs_checked" }), { ...none, fans: true })).toEqual([]);
    expect(jobOrderTasks(wf({ stage: "production_finished" }), { ...none, fans: true })).toEqual([]);
  });
});

describe("the department head is told their job order is issued", async () => {
  const { issuedJobOrderNotices } = await import("./job-order-tasks");
  const issued = (at = "2026-11-07T02:00:00.000Z") => ({ status: "issued", issuedAt: at, issuedByName: "JayR Basal" });
  it("awaiting the Plant Manager, then ready to start; gone once started", () => {
    expect(issuedJobOrderNotices(wf({ stage: "in_production", jobOrders: { fans: issued() } }))).toEqual([
      { dept: "fans", role: "prod_head_fans", action: "Fans & Blower job order issued — awaiting Plant Manager to receive", since: "2026-11-07T02:00:00.000Z" },
    ]);
    expect(issuedJobOrderNotices(wf({ stage: "jo_received", jobOrders: { fans: issued() } }))[0].action).toBe("Fans & Blower job order issued — start production");
    expect(issuedJobOrderNotices(wf({ stage: "producing", jobOrders: { fans: { ...issued(), status: "in_production" } } }))).toEqual([]);
  });
  it("a top-up issued while production is underway is told too", () => {
    const t = issuedJobOrderNotices(wf({ stage: "producing", jobOrders: { fans: { ...issued(), status: "in_production" }, motor: issued() } }));
    expect(t.map((x) => [x.role, x.action])).toEqual([["prod_head_motor", "Motor Controller job order issued"]]);
  });
  it("nothing outside Phase 2", () => {
    expect(issuedJobOrderNotices(wf({ stage: "production_finished", jobOrders: { fans: issued() } }))).toEqual([]);
  });
});
