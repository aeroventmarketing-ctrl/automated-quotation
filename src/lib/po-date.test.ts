import { describe, it, expect } from "vitest";
import type { User } from "@prisma/client";
import { normalisePoDate, poDateYmd, latestPoDateChanges } from "./po-date";
import { canChangePoDate } from "./po-date-access";

const user = (id: string, role = "OTHER") => ({ id, name: id, email: `${id}@t`, role }) as unknown as User;

describe("who may change a PO date", () => {
  // The owner: "build for admin, payment approver role and purchaser role".
  it.each([
    ["admin", user("a", "ADMIN"), {}, true],
    ["payment approver", user("pa"), { pa: ["payment_approver"] }, true],
    ["purchaser", user("pu"), { pu: ["purchaser"] }, true],
    ["accounting", user("ac"), { ac: ["accounting"] }, false],
    ["warehouse", user("wh"), { wh: ["warehouse"] }, false],
    ["sales", user("s", "SALES"), {}, false],
    ["nobody", null, {}, false],
  ] as const)("%s → %s", (_n, u, roles, want) => {
    expect(canChangePoDate(u, roles as never)).toBe(want);
  });
});

describe("the date", () => {
  it("only a real calendar day", () => {
    expect(normalisePoDate("2026-10-26")).toBe("2026-10-26");
    expect(normalisePoDate(" 2026-02-28 ")).toBe("2026-02-28");
    expect(normalisePoDate("2026-02-30")).toBeNull();
    expect(normalisePoDate("10/26/2026")).toBeNull();
    expect(normalisePoDate("")).toBeNull();
  });
  it("the day part of whatever was stored", () => {
    expect(poDateYmd("2026-10-26T03:14:00.000Z")).toBe("2026-10-26");
    expect(poDateYmd("2026-10-26")).toBe("2026-10-26");
    expect(poDateYmd(null)).toBe("");
  });
});

describe("the last change, per request", () => {
  const e = (at: string, meta: unknown, actorName = "Allan Ramos") => ({ actorName, createdAt: at, meta });
  it("the latest wins, and a combined PO's change lands on every member", () => {
    const out = latestPoDateChanges([
      e("2026-10-28T02:00:00Z", { from: "2026-10-27", to: "2026-10-31", reason: "per supplier SI", prIds: ["a", "b"] }, "Rey Gil"),
      e("2026-10-27T02:00:00Z", { from: "2026-10-26", to: "2026-10-27", reason: "typo", prIds: ["a", "b"] }),
      e("2026-10-20T02:00:00Z", { from: "2026-10-01", to: "2026-10-02", reason: "x", prIds: ["c"] }),
    ]);
    expect(out.a).toEqual({ from: "2026-10-27", to: "2026-10-31", reason: "per supplier SI", byName: "Rey Gil", at: "2026-10-28T02:00:00.000Z" });
    expect(out.b.to).toBe("2026-10-31");
    expect(out.c.to).toBe("2026-10-02");
  });
  it("junk entries are skipped", () => {
    expect(latestPoDateChanges([e("2026-10-28T02:00:00Z", null), e("2026-10-28T02:00:00Z", { from: "x", to: "y" })])).toEqual({});
  });
});
