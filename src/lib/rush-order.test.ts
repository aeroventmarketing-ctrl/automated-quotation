import { describe, it, expect } from "vitest";
import {
  readRush, isRushActive, canRequestRush, canDecideRush, applyRushStep,
  rushDaysLeft, rushLabel, rushWaitAlarm, rushWaitText, rushFirst, type OrderRush,
} from "./rush-order";

const ctx = { byName: "May-Ann Asong", at: "2026-11-05T02:00:00.000Z", hasClientDue: true, closed: false };
const as = (byName: string, at = "2026-11-05T03:00:00.000Z") => ({ ...ctx, byName, at });
const ok = (r: OrderRush | string): OrderRush => {
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe("who", () => {
  it("the Sales in-charge requests; the Payment Approver or an admin decides", () => {
    expect(canRequestRush({ userId: "s1", preparedById: "s1" })).toBe(true);
    expect(canRequestRush({ userId: "s2", preparedById: "s1" })).toBe(false);
    expect(canRequestRush({ userId: null, preparedById: "s1" })).toBe(false);
    expect(canDecideRush({ admin: true, paymentApprover: false })).toBe(true);
    expect(canDecideRush({ admin: false, paymentApprover: true })).toBe(true);
    expect(canDecideRush({ admin: false, paymentApprover: false })).toBe(false);
  });
});

describe("request → approve / decline; mark; remove", () => {
  it("Sales requests with a reason → requested; the Payment Approver approves → active", () => {
    const req = ok(applyRushStep(null, { kind: "request", reason: "Plant shutdown Nov 15" }, ctx));
    expect(req).toMatchObject({ state: "requested", reason: "Plant shutdown Nov 15", requestedByName: "May-Ann Asong" });
    const on = ok(applyRushStep(req, { kind: "approve", note: "" }, as("Rey Gil")));
    expect(on).toMatchObject({ state: "active", decidedByName: "Rey Gil" });
    expect(on.history.map((h) => h.action)).toEqual(["approved", "requested"]);
  });
  it("declined, then asked again", () => {
    const req = ok(applyRushStep(null, { kind: "request", reason: "x" }, ctx));
    const no = ok(applyRushStep(req, { kind: "decline", note: "Not justified" }, as("Rey Gil")));
    expect(no.state).toBe("declined");
    expect(ok(applyRushStep(no, { kind: "request", reason: "Client called again" }, ctx)).state).toBe("requested");
  });
  it("marked directly, then removed with a reason", () => {
    const on = ok(applyRushStep(null, { kind: "mark", reason: "CEO request" }, as("Admin")));
    expect(on).toMatchObject({ state: "active", decidedByName: "Admin" });
    expect(applyRushStep(on, { kind: "remove", note: "" }, as("Admin"))).toBe("Say why the rush is over.");
    expect(ok(applyRushStep(on, { kind: "remove", note: "Client moved the date" }, as("Admin"))).state).toBe("removed");
  });
  it("refusals", () => {
    expect(applyRushStep(null, { kind: "request", reason: "" }, ctx)).toBe("Say why this order is a rush.");
    expect(applyRushStep(null, { kind: "request", reason: "x" }, { ...ctx, hasClientDue: false })).toMatch(/Client Due Date/);
    expect(applyRushStep(null, { kind: "request", reason: "x" }, { ...ctx, closed: true })).toBe("This order is closed.");
    expect(applyRushStep(null, { kind: "approve", note: "" }, ctx)).toMatch(/no RUSH request/);
    expect(applyRushStep(null, { kind: "remove", note: "x" }, ctx)).toMatch(/isn't a RUSH/);
    const req = ok(applyRushStep(null, { kind: "request", reason: "x" }, ctx));
    expect(applyRushStep(req, { kind: "request", reason: "again" }, ctx)).toMatch(/already been requested/);
    const on = ok(applyRushStep(req, { kind: "approve", note: "" }, ctx));
    expect(applyRushStep(on, { kind: "mark", reason: "x" }, ctx)).toMatch(/already a RUSH/);
  });
});

describe("stored and read back", () => {
  it("round-trips; junk reads as no rush", () => {
    const on = ok(applyRushStep(null, { kind: "mark", reason: "CEO request" }, ctx));
    expect(readRush({ rush: JSON.parse(JSON.stringify(on)) })).toEqual(on);
    expect(isRushActive({ rush: on })).toBe(true);
    expect(readRush({ rush: { state: "weird" } })).toBeNull();
    expect(readRush(null)).toBeNull();
    expect(isRushActive({})).toBe(false);
  });
});

describe("seeing it", () => {
  it("days left to the client due date", () => {
    expect(rushDaysLeft("2026-11-08", "2026-11-05")).toBe(3);
    expect(rushLabel(3)).toBe("RUSH · 3d left");
    expect(rushLabel(0)).toBe("RUSH · due today");
    expect(rushLabel(-2)).toBe("RUSH · 2d overdue");
    expect(rushLabel(rushDaysLeft(null, "2026-11-05"))).toBe("RUSH");
  });
  it("the 4-hour alarm", () => {
    const now = Date.parse("2026-11-05T10:00:00.000Z");
    expect(rushWaitAlarm("2026-11-05T07:00:00.000Z", now)).toBeNull(); // 3h
    expect(rushWaitAlarm("2026-11-05T06:00:00.000Z", now)).toBe(4);
    expect(rushWaitText(5)).toBe("Waiting 5h — RUSH");
    expect(rushWaitText(50)).toBe("Waiting 2d — RUSH");
    expect(rushWaitAlarm(undefined, now)).toBeNull();
  });
  it("rush first, each group in its own order", () => {
    expect(rushFirst([1, 2, 3, 4, 5], (n) => n % 2 === 0)).toEqual([2, 4, 1, 3, 5]);
  });
});

describe("the printed stamp", () => {
  const on = { state: "active", reason: "x", requestedByName: "", requestedAt: "", decidedByName: "", decidedAt: "", history: [] };
  it("names the client due date", async () => {
    const { rushStampText } = await import("./rush-order");
    expect(rushStampText({ rush: on, clientDue: { date: "2026-11-08" } })).toBe("RUSH ORDER — due Nov 8, 2026");
    expect(rushStampText({ rush: on })).toBe("RUSH ORDER");
    expect(rushStampText({ rush: on, workflow: { stage: "closed" } })).toBeNull();
    expect(rushStampText({ rush: { ...on, state: "requested" } })).toBeNull();
    expect(rushStampText({})).toBeNull();
  });
});
