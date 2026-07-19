"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically soft-refreshes the page (re-fetches server components) so a
 * viewer sees approvals/updates made by others without reloading manually.
 * router.refresh() keeps client state (form inputs, etc.) — only server data
 * re-renders. Pauses while the tab is hidden to avoid needless traffic.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    }, Math.max(5, seconds) * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
