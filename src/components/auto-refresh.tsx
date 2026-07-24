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
