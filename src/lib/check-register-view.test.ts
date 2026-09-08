import { describe, it, expect } from "vitest";
import {
  searchCheckRows, sortCheckRows, groupCheckRows, DEFAULT_CHECK_SORT,
  buildCheckRegisterView, coerceCheckSort, coerceCheckDir, coerceCheckGroup, coerceCheckTab,
} from "./check-register-view";
import type { CheckWatchRow } from "./check-monitor";

const row = (over: Partial<CheckWatchRow>): CheckWatchRow => ({
  prId: "pr", path: "p", fileName: "c.jpg",
  poDate: "2026-09-01", poNumber: "PO-AFBM20260000638", supplier: "TOZEN PHILIPPINES INC.",
  orderId: null, checkNo: "0000486726", amount: 2160.54,
  clearingYMD: "2026-10-04", originalYMD: null, dateFixedBy: null, moves: 0, lastMoveReason: null,
  daysLeft: 30, dateVerified: true, state: "scheduled", clearedOn: null, clearedByName: null,
  statusLabel: "Check Clearing", form: "PDC", remarks: null,
  ...over,
});

const REGISTER = [
  row({ prId: "a", supplier: "TKL STEEL CORPORATION", poNumber: "PO-…648", checkNo: "0000486723", amount: 28344.64, clearingYMD: "2026-09-10" }),
  row({ prId: "b", supplier: "VIS INDUSTRIAL CORP.", poNumber: "PO-…625", checkNo: "0000486721", amount: 2836.94, clearingYMD: "2026-10-02" }),
  row({ prId: "c", supplier: "TOZEN PHILIPPINES INC.", poNumber: "PO-…638", checkNo: "0000486726", amount: 2160.54, clearingYMD: "2026-10-04" }),
  row({ prId: "d", supplier: "TOZEN PHILIPPINES INC.", poNumber: "PO-…639", checkNo: "0000486731", amount: 2081.25, clearingYMD: "2026-10-04" }),
  row({ prId: "e", supplier: "VIS INDUSTRIAL CORP.", poNumber: "PO-…640", checkNo: "0000486727", amount: 32405.06, clearingYMD: "2026-10-10" }),
  // A PO whose check is not written yet — no number, no date.
  row({ prId: "f", supplier: "WINGS COMMERCIAL MILLS", poNumber: "PO-…552", checkNo: null, amount: 3431.09, clearingYMD: null, daysLeft: null, state: "awaiting", statusLabel: "For Payment", form: "Check" }),
];

/**
 * The owner: *"Make the default arrangement by clearing date, top most is the
 * soonest to clear."*
 */
describe("the default arrangement", () => {
  it("is clearing date, soonest first", () => {
    expect(DEFAULT_CHECK_SORT).toEqual({ key: "clearing", dir: "asc" });
    const sorted = sortCheckRows(REGISTER, DEFAULT_CHECK_SORT.key, DEFAULT_CHECK_SORT.dir);
    expect(sorted.map((r) => r.clearingYMD)).toEqual([
      "2026-09-10", "2026-10-02", "2026-10-04", "2026-10-04", "2026-10-10", null,
    ]);
  });

  /**
   * A row with no date sinks in BOTH directions. Floating the undated ones to
   * the top of a descending sort would bury the dated rows the screen exists to
   * watch.
   */
  it("sinks a row with nothing to sort by, whichever way round", () => {
    for (const dir of ["asc", "desc"] as const) {
      const last = sortCheckRows(REGISTER, "clearing", dir).at(-1);
      expect(last?.state, dir).toBe("awaiting");
    }
  });

  it("reverses cleanly, and ties break on the PO number so the order never wobbles", () => {
    const desc = sortCheckRows(REGISTER, "clearing", "desc");
    expect(desc[0].clearingYMD).toBe("2026-10-10");
    // The two 4-October rows keep a fixed order rather than an arbitrary one.
    const tied = desc.filter((r) => r.clearingYMD === "2026-10-04").map((r) => r.poNumber);
    expect(tied).toEqual([...tied].sort());
    expect(sortCheckRows(REGISTER, "clearing", "desc").map((r) => r.prId))
      .toEqual(sortCheckRows(REGISTER, "clearing", "desc").map((r) => r.prId));
  });

  it("does not mutate what it was given", () => {
    const before = REGISTER.map((r) => r.prId);
    sortCheckRows(REGISTER, "amount", "desc");
    expect(REGISTER.map((r) => r.prId)).toEqual(before);
  });
});

describe("sorting each column", () => {
  it("orders money as money, not as text", () => {
    // "2,836.94" before "28,344.64" only if these are numbers.
    expect(sortCheckRows(REGISTER, "amount", "asc").map((r) => r.amount))
      .toEqual([2081.25, 2160.54, 2836.94, 3431.09, 28344.64, 32405.06]);
  });

  it("orders check numbers by the digits that identify them, not by padding", () => {
    const mixed = [row({ prId: "x", checkNo: "486999" }), row({ prId: "y", checkNo: "0000486100" })];
    expect(sortCheckRows(mixed, "checkNo", "asc").map((r) => r.prId)).toEqual(["y", "x"]);
  });

  it("orders companies alphabetically, ignoring case", () => {
    expect(sortCheckRows(REGISTER, "company", "asc")[0].supplier).toBe("TKL STEEL CORPORATION");
    expect(sortCheckRows(REGISTER, "company", "desc")[0].supplier).toBe("WINGS COMMERCIAL MILLS");
  });

  it("sorts a cleared check by the day it actually cleared", () => {
    const rows = [
      row({ prId: "late", state: "cleared", clearingYMD: "2026-09-01", clearedOn: "2026-09-20" }),
      row({ prId: "early", state: "cleared", clearingYMD: "2026-09-15", clearedOn: "2026-09-02" }),
    ];
    expect(sortCheckRows(rows, "clearing", "asc").map((r) => r.prId)).toEqual(["early", "late"]);
  });
});

describe("the search box", () => {
  const find = (q: string) => searchCheckRows(REGISTER, q).map((r) => r.prId);

  it("finds a check by its number, padded or not", () => {
    // The printed form and the register's form must reach the same row.
    expect(find("0000486726")).toEqual(["c"]);
    expect(find("486726")).toEqual(["c"]);
  });

  it("finds by company, PO number, amount and status", () => {
    expect(find("tozen")).toEqual(["c", "d"]);
    expect(find("648")).toEqual(["a"]);
    expect(find("32405.06")).toEqual(["e"]);
    expect(find("32,405.06")).toEqual(["e"]);
    expect(find("for payment")).toEqual(["f"]);
  });

  it("narrows on every term, rather than widening", () => {
    // "tozen 486731" is one check, not every TOZEN row plus every 486731 row.
    expect(find("tozen 486731")).toEqual(["d"]);
    expect(find("tozen 2026-10-04")).toEqual(["c", "d"]);
  });

  it("ignores case and keeps everything when the box is empty", () => {
    expect(find("TOZEN")).toEqual(find("tozen"));
    expect(searchCheckRows(REGISTER, "   ")).toHaveLength(REGISTER.length);
  });

  it("finds nothing rather than everything when nothing matches", () => {
    expect(find("no such supplier")).toEqual([]);
  });
});

describe("grouping", () => {
  it("keeps one group of everything when off", () => {
    const [g] = groupCheckRows(REGISTER, "none");
    expect(g.rows).toHaveLength(6);
    expect(g.total).toBeCloseTo(71259.52, 2);
  });

  it("groups by company, with what each is worth", () => {
    const groups = groupCheckRows(REGISTER, "company");
    expect(groups.map((g) => g.label)).toEqual([
      "TKL STEEL CORPORATION", "VIS INDUSTRIAL CORP.", "TOZEN PHILIPPINES INC.", "WINGS COMMERCIAL MILLS",
    ]);
    expect(groups[2].total).toBe(4241.79); // 2,160.54 + 2,081.25
  });

  /**
   * Grouping must never fight the sort: groups appear in the order their first
   * row does, so a register sorted by clearing date still leads with whoever
   * clears soonest.
   */
  it("orders groups by their first row, not alphabetically", () => {
    const sorted = sortCheckRows(REGISTER, "clearing", "asc");
    expect(groupCheckRows(sorted, "company")[0].label).toBe("TKL STEEL CORPORATION");
    const desc = sortCheckRows(REGISTER, "clearing", "desc");
    expect(groupCheckRows(desc, "company")[0].label).toBe("VIS INDUSTRIAL CORP.");
  });

  it("groups by clearing month, and gives the undated rows their own group", () => {
    const groups = groupCheckRows(sortCheckRows(REGISTER, "clearing", "asc"), "month");
    expect(groups.map((g) => g.label)).toEqual(["September 2026", "October 2026", "No clearing date"]);
    expect(groups[1].rows).toHaveLength(4);
  });

  it("groups by status", () => {
    const groups = groupCheckRows(REGISTER, "status");
    expect(groups.map((g) => g.label)).toEqual(["Check Clearing", "For Payment"]);
    expect(groups[1].rows.map((r) => r.prId)).toEqual(["f"]);
  });

  it("loses no rows, whatever it groups by", () => {
    for (const by of ["none", "company", "status", "month"] as const) {
      const n = groupCheckRows(REGISTER, by).reduce((s, g) => s + g.rows.length, 0);
      expect(n, by).toBe(REGISTER.length);
    }
  });
});

/**
 * The owner: *"add an option to download in excel file and pdf file."*
 *
 * A download of "the register" is useless if it is not the register on screen,
 * so the export rebuilds the view from the URL through these same functions.
 * What is asserted here is that the rebuild really is the same arrangement.
 */
describe("rebuilding the view for a download", () => {
  it("defaults to exactly what the screen opens with", () => {
    const v = buildCheckRegisterView(REGISTER);
    expect(v.tab).toBe("open");
    expect(v.groups).toHaveLength(1);
    expect(v.groups[0].rows.map((r) => r.prId))
      .toEqual(sortCheckRows(REGISTER, DEFAULT_CHECK_SORT.key, DEFAULT_CHECK_SORT.dir).map((r) => r.prId));
  });

  it("splits the two tabs the way the screen does", () => {
    const rows = [...REGISTER, row({ prId: "done", state: "cleared", clearedOn: "2026-09-01" })];
    expect(buildCheckRegisterView(rows, { tab: "open" }).count).toBe(REGISTER.length);
    const cleared = buildCheckRegisterView(rows, { tab: "cleared" });
    expect(cleared.count).toBe(1);
    expect(cleared.groups[0].rows[0].prId).toBe("done");
  });

  it("applies the search, the sort and the grouping together", () => {
    const v = buildCheckRegisterView(REGISTER, { query: "tozen", sort: "amount", dir: "desc", group: "company" });
    expect(v.count).toBe(2);
    expect(v.groups.map((g) => g.label)).toEqual(["TOZEN PHILIPPINES INC."]);
    expect(v.groups[0].rows.map((r) => r.amount)).toEqual([2160.54, 2081.25]);
    expect(v.total).toBeCloseTo(4241.79, 2);
  });

  /**
   * A printed page that silently omits half the register is worse than one that
   * says what it left out — so the arrangement, and any search, is on the page.
   */
  it("describes itself, search included", () => {
    const v = buildCheckRegisterView(REGISTER, { query: " tozen ", sort: "amount", dir: "desc", group: "company" });
    expect(v.caption).toContain("Checks still to clear");
    expect(v.caption).toContain("2 rows");
    expect(v.caption).toContain("sorted by Amount descending");
    expect(v.caption).toContain("grouped by Company");
    expect(v.caption).toContain('matching "tozen"');
    // …and says nothing about a search nobody made.
    expect(buildCheckRegisterView(REGISTER).caption).not.toContain("matching");
    expect(buildCheckRegisterView(REGISTER, { tab: "cleared" }).caption).toContain("Cleared checks");
  });

  it("counts one row as one row", () => {
    expect(buildCheckRegisterView(REGISTER, { query: "486726" }).caption).toContain("1 row ");
  });
});

/**
 * Everything in the URL is a stranger's string. Each coercer falls back to what
 * the screen itself opens with, so a mangled link downloads the default register
 * rather than an empty file or an error.
 */
describe("reading the view back off a URL", () => {
  it("takes the values it knows", () => {
    expect(coerceCheckSort("amount")).toBe("amount");
    expect(coerceCheckDir("desc")).toBe("desc");
    expect(coerceCheckGroup("month")).toBe("month");
    expect(coerceCheckTab("cleared")).toBe("cleared");
  });

  it("falls back to the screen's own defaults for anything else", () => {
    for (const junk of ["", "nonsense", null, undefined, "__proto__", "constructor"]) {
      expect(coerceCheckSort(junk), String(junk)).toBe(DEFAULT_CHECK_SORT.key);
      expect(coerceCheckDir(junk), String(junk)).toBe(DEFAULT_CHECK_SORT.dir);
      expect(coerceCheckGroup(junk), String(junk)).toBe("none");
      expect(coerceCheckTab(junk), String(junk)).toBe("open");
    }
  });
});
