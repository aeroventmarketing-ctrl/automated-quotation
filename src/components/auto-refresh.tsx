"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically soft-refreshes the page (re-fetches server components) so a
 * viewer sees approvals/updates made by others without reloading manually — e.g.
 * once an approver presses a button, everyone else watching the same order/queue
 * sees it within a few seconds. router.refresh() keeps client state (form inputs,
 * open panels) — only server data re-renders.
 *
 * Also refreshes immediately when the tab regains focus, and pauses while the tab
 * is hidden to avoid needless traffic.
 *
 * **The interval is a bill.** Every tick re-runs the page's server components,
 * which means re-running its database queries. The default of 8 seconds is 450
 * renders an hour PER OPEN TAB, and it is only safe on a page that reads one
 * record — an order, a quotation being built — where someone is genuinely
 * waiting on a colleague's button.
 *
 * A page that reads a whole table must pass a longer interval. `/orders` on the
 * default was pulling 3.2 MB of quotations every 8 seconds, about 2.1 TB of
 * Supabase egress a month, and enough load to take the app down. The list pages
 * now run at 60–300s; the two detail pages keep the default.
 */
export function AutoRefresh({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const ms = Math.max(4, seconds) * 1000;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    };
    const id = setInterval(tick, ms);
    // Switching back to this tab shows the latest immediately.
    const onFocus = () => {
      if (typeof document !== "undefined" && !document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, seconds]);
  return null;
}
