import { describe, it, expect } from "vitest";
import { COMPLETED_PAGE, wantsAllCompleted, purchasingOrdersToLoad } from "./completed-page";

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

/**
 * The Purchasing workspace's order chains. The danger in paging these is not the
 * archive falling off the end — that is the point — it is a LIVE order falling
 * off with it, or a live order's own finished requests going missing so its
 * chain renders with a hole in it.
 */
describe("purchasingOrdersToLoad", () => {
  const finished = Array.from({ length: 60 }, (_, i) => `fin${i + 1}`); // newest first

  it("keeps every order with something still moving, at any age", () => {
    const live = ["live1", "live2"];
    const { orderIds } = purchasingOrdersToLoad(live, finished, false);
    for (const id of live) expect(orderIds).toContain(id);
  });

  it("pages only the orders that are entirely finished", () => {
    const { orderIds, finishedShown, finishedTotal } = purchasingOrdersToLoad(["live1"], finished, false);
    expect(finishedTotal).toBe(60);
    expect(finishedShown).toBe(COMPLETED_PAGE);
    expect(orderIds).toHaveLength(1 + COMPLETED_PAGE);
    expect(orderIds).toContain("fin1"); // newest finished kept
    expect(orderIds).not.toContain("fin60"); // oldest paged out
  });

  it("`?completed=all` loads the lot", () => {
    const { orderIds, finishedShown } = purchasingOrdersToLoad(["live1"], finished, true);
    expect(finishedShown).toBe(60);
    expect(orderIds).toHaveLength(61);
    expect(orderIds).toContain("fin60");
  });

  /**
   * An order with three finished POs and one in flight appears in BOTH lists —
   * the live one and the finished one. It must be loaded once, as a live order,
   * and must not be counted as part of the archive: counting it would both
   * inflate the total and let the page limit decide whether a live order's own
   * history is shown.
   */
  it("an order that is both live and finished counts as live, once", () => {
    const { orderIds, finishedTotal, finishedShown } = purchasingOrdersToLoad(
      ["both"],
      ["both", "fin1", "fin2"],
      false,
    );
    expect(orderIds.filter((id) => id === "both")).toHaveLength(1);
    expect(finishedTotal).toBe(2);
    expect(finishedShown).toBe(2);
  });

  it("a duplicate live id is still loaded once", () => {
    const { orderIds } = purchasingOrdersToLoad(["a", "a", "b"], [], false);
    expect(orderIds).toEqual(["a", "b"]);
  });

  it("nothing finished, nothing to show for it", () => {
    const { orderIds, finishedShown, finishedTotal } = purchasingOrdersToLoad(["a"], [], false);
    expect(orderIds).toEqual(["a"]);
    expect(finishedShown).toBe(0);
    expect(finishedTotal).toBe(0);
  });
});
