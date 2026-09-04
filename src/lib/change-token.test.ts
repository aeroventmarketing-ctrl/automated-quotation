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
    for (const s of ["orders", "purchasing", "checks", "requisitions", "cash-requests", "calendar", "my-dashboard"]) {
      expect(isChangeScope(s), s).toBe(true);
    }
    // A page asking for a scope this deployment has not got must be told so,
    // not silently handed someone else's token.
    for (const s of ["", "Orders", "everything", "constructor", "toString", null, undefined]) {
      expect(isChangeScope(s), String(s)).toBe(false);
    }
  });
});
