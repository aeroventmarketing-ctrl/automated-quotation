import { describe, it, expect } from "vitest";
import { COMPLETED_PAGE, wantsAllCompleted } from "./completed-page";

/**
 * The three Completed boxes carry only their newest page. Two rules keep that
 * from hiding something someone was sent to look at.
 */
describe("wantsAllCompleted", () => {
  it("a plain page load takes the newest page", () => {
    expect(wantsAllCompleted(undefined)).toBe(false);
    expect(wantsAllCompleted({})).toBe(false);
    expect(wantsAllCompleted({ completed: "" })).toBe(false);
  });

  it("`?completed=all` takes the lot", () => {
    expect(wantsAllCompleted({ completed: "all" })).toBe(true);
  });

  /**
   * The one that matters: a notification deep-links to a specific request, and
   * the row it names may be any age. Loading a page of 25 and landing on an
   * empty box would be a notification that lies.
   */
  it("a deep link takes the lot, whatever the `completed` param says", () => {
    expect(wantsAllCompleted(undefined, "pr_123")).toBe(true);
    expect(wantsAllCompleted({}, "pr_123")).toBe(true);
    expect(wantsAllCompleted({ completed: "" }, "pr_123")).toBe(true);
  });

  it("no deep link means no deep link — an empty id does not expand the archive", () => {
    expect(wantsAllCompleted({}, "")).toBe(false);
    expect(wantsAllCompleted({}, undefined)).toBe(false);
  });

  it("a page is big enough to be worth collapsing and small enough to be worth paging", () => {
    expect(COMPLETED_PAGE).toBeGreaterThanOrEqual(10);
    expect(COMPLETED_PAGE).toBeLessThanOrEqual(50);
  });
});
