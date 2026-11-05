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
  it("a department the order doesn't touch, and stages outside Phase 2, have nothing", () => {
    expect(jobOrderTasks(wf(), none)).toEqual([]);
    expect(jobOrderTasks(wf({ stage: "docs_checked" }), { ...none, fans: true })).toEqual([]);
    expect(jobOrderTasks(wf({ stage: "production_finished" }), { ...none, fans: true })).toEqual([]);
  });
});
