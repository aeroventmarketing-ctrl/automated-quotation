import { describe, it, expect } from "vitest";
import { tokenFrom, isChangeScope, UNKNOWN_TOKEN } from "./change-token";

/**
 * The token behind *"has anything changed?"* — the question an auto-refreshing
 * page now asks for ~100 bytes instead of re-running its whole query.
 *
 * The owner, after a $512 egress bill: *"is there a way we can restore the
 * previous refresh rate while not consuming so much GB?"*
 */
describe("the change token", () => {
  const at = (iso: string) => new Date(iso);

  it("moves when a row is written", () => {
    const before = tokenFrom([{ n: 1142, at: at("2026-09-04T10:00:00Z") }]);
    const after = tokenFrom([{ n: 1142, at: at("2026-09-04T10:00:01Z") }]);
    expect(after).not.toBe(before);
  });

  /**
   * A deletion moves no `updatedAt` anywhere. Without the count in the token it
   * would be invisible until something else happened to change — a row would
   * vanish from the database and stay on everyone's screen.
   */
  it("moves when a row is DELETED, which no timestamp would show", () => {
    const stamp = at("2026-09-04T10:00:00Z");
    expect(tokenFrom([{ n: 1141, at: stamp }])).not.toBe(tokenFrom([{ n: 1142, at: stamp }]));
  });

  it("stays put when nothing happens — the whole point", () => {
    const parts = [{ n: 1142, at: at("2026-09-04T10:00:00Z") }];
    expect(tokenFrom(parts)).toBe(tokenFrom([{ ...parts[0] }]));
  });

  it("covers every table in a multi-table scope", () => {
    const a = { n: 10, at: at("2026-09-04T10:00:00Z") };
    const b = { n: 20, at: at("2026-09-04T09:00:00Z") };
    const base = tokenFrom([a, b]);
    // A change in EITHER table has to move the token, or one of the two feeds
    // this page reads would go stale without anyone noticing.
    expect(tokenFrom([{ ...a, n: 11 }, b])).not.toBe(base);
    expect(tokenFrom([a, { ...b, at: at("2026-09-04T09:00:01Z") }])).not.toBe(base);
  });

  it("copes with an empty table", () => {
    expect(tokenFrom([{ n: 0, at: null }])).toBe("0:0");
    // …and still notices the first row arriving in it.
    expect(tokenFrom([{ n: 1, at: at("2026-09-04T10:00:00Z") }])).not.toBe("0:0");
  });

  /**
   * The safety property that matters most. A token that silently stopped
   * changing would leave someone staring at a stale screen believing it live —
   * far worse than refreshing too often. `UNKNOWN_TOKEN` must be something no
   * real token can ever equal, so the client can recognise it and fall back.
   */
  it("cannot be mistaken for a real token", () => {
    expect(UNKNOWN_TOKEN).toBe("?");
    for (const parts of [[{ n: 0, at: null }], [{ n: 1, at: at("2026-01-01T00:00:00Z") }], []]) {
      expect(tokenFrom(parts)).not.toBe(UNKNOWN_TOKEN);
    }
  });

  it("knows which scopes exist", () => {
    for (const s of ["orders", "purchasing", "checks", "requisitions", "cash-requests", "calendar", "my-dashboard", "management", "order-detail"]) {
      expect(isChangeScope(s), s).toBe(true);
    }
    // A page asking for a scope this deployment has not got must be told so,
    // not silently handed someone else's token.
    for (const s of ["", "Orders", "everything", "constructor", "toString", null, undefined]) {
      expect(isChangeScope(s), String(s)).toBe(false);
    }
  });
});

/**
 * The approver alarm's scope — the last surface in the app still fetching on a
 * plain timer, and much the most expensive one to fetch.
 *
 * Its answer depends on two tables, and leaving out the second is the bug worth
 * guarding: `AppSetting` holds the notifications on/off switch, the workflow
 * role assignments, the notification baseline and the alerts go-live moment. An
 * admin turning notifications off writes only there, so a scope watching
 * `Quotation` alone would go on ringing sirens at everyone until somebody
 * happened to touch an order.
 */
describe("the approver alarm's scope", () => {
  it("is a scope the server will answer for", () => {
    expect(isChangeScope("approvals")).toBe(true);
  });

  it("moves when an admin changes a setting and no order has been touched", () => {
    const orders = { n: 1142, at: new Date("2026-09-16T10:00:00Z") };
    const before = tokenFrom([orders, { n: 12, at: new Date("2026-09-16T09:00:00Z") }]);
    const after = tokenFrom([orders, { n: 12, at: new Date("2026-09-16T09:30:00Z") }]);
    expect(after).not.toBe(before);
  });

  /** …and an unknown scope still answers UNKNOWN, so the client falls back. */
  it("does not make every string a scope", () => {
    expect(isChangeScope("approval")).toBe(false);
    expect(UNKNOWN_TOKEN).toBe("?");
  });
});

/**
 * One order's token, not the whole order book.
 *
 * The order page shows a single order but watched `max(updatedAt)` across every
 * `Quotation`, so a stage stamped on ANYBODY's order rebuilt EVERY open order
 * page — and a rebuild re-reads the entire stock catalogue (1,046 rows) and the
 * entire product catalogue (1,041 rows). Postgres records those two reads as 44%
 * of all rows leaving the database.
 *
 * `tokenFrom` is the pure half; these pin the SHAPE the keyed counters produce,
 * which is where the two ways to get this wrong live.
 */
describe("an order page watching its own row", () => {
  const at = (iso: string) => new Date(iso);
  /** What `oneQuotation` returns: present = 1, absent = 0. */
  const one = (updatedAt: string | null) => ({ n: updatedAt ? 1 : 0, at: updatedAt ? at(updatedAt) : null });

  it("holds still while a DIFFERENT order is being worked on", () => {
    // Same row, untouched — whatever else happened in the table.
    const mine = one("2026-09-16T10:00:00Z");
    expect(tokenFrom([mine])).toBe(tokenFrom([one("2026-09-16T10:00:00Z")]));
  });

  it("moves the moment this order is stamped", () => {
    expect(tokenFrom([one("2026-09-16T10:00:01Z")])).not.toBe(tokenFrom([one("2026-09-16T10:00:00Z")]));
  });

  /**
   * `n` is 1-or-0 rather than a row count for exactly this: a deleted order
   * moves no `updatedAt` anywhere, and without the flip the page would sit on
   * a dead order for ever instead of re-rendering into its 404.
   */
  it("moves when the order is DELETED, which no timestamp would show", () => {
    expect(tokenFrom([one(null)])).not.toBe(tokenFrom([one("2026-09-16T10:00:00Z")]));
    expect(tokenFrom([one(null)])).toBe("0:0");
  });

  /** The order's own purchase requests still count — Phase 4 lives on this page. */
  it("still moves when this order's purchasing chain moves", () => {
    const mine = one("2026-09-16T10:00:00Z");
    const before = tokenFrom([mine, { n: 3, at: at("2026-09-16T09:00:00Z") }]);
    const after = tokenFrom([mine, { n: 4, at: at("2026-09-16T09:30:00Z") }]);
    expect(after).not.toBe(before);
  });
});
