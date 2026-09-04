"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { UNKNOWN_TOKEN, type ChangeScope } from "@/lib/change-token";

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
 * ## `watch` — ask before you fetch
 *
 * **Every tick without `watch` re-runs the page's database queries.** At the
 * default of 8 seconds that is 450 renders an hour PER OPEN TAB, of which
 * perhaps five return different data. `/orders` was paying 3.2 MB for each of
 * the other 445 — about 2.1 TB of Supabase egress a month, and enough load to
 * take the whole app down.
 *
 * Pass `watch` and the tick becomes a question instead: a ~100-byte poll of
 * `/api/changes`, and the expensive refresh only when the answer moves. That is
 * FASTER than the plain timer, not slower — a colleague's change shows up within
 * one poll of being made, rather than whenever the next scheduled render lands —
 * and it costs a fraction of it.
 *
 * So: a page that reads a whole table should pass `watch`. A page without one
 * should carry an interval long enough to pay for.
 *
 * If the poll fails, or the server cannot compute a token, this falls back to
 * refreshing on the timer exactly as it did before. A watcher that silently
 * stopped refreshing would leave someone staring at a stale screen believing it
 * live, which is worse than refreshing too often.
 */
export function AutoRefresh({ seconds = 8, watch }: { seconds?: number; watch?: ChangeScope }) {
  const router = useRouter();
  // The last token seen. `undefined` = nothing seen yet, so the first poll
  // records the current state rather than treating it as a change.
  const seen = useRef<string | undefined>(undefined);

  useEffect(() => {
    const ms = Math.max(4, seconds) * 1000;
    const hidden = () => typeof document !== "undefined" && document.hidden;

    /** Plain behaviour: re-render on the timer. */
    const tickAlways = () => {
      if (hidden()) return;
      router.refresh();
    };

    /** Watched behaviour: ask first, refresh only on news. */
    const tickWatched = async () => {
      if (hidden()) return;
      try {
        const res = await fetch(`/api/changes?scope=${watch}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const { v } = (await res.json()) as { v?: string };
        // No token to compare — the server said so. Behave as an unwatched page.
        if (!v || v === UNKNOWN_TOKEN) { router.refresh(); return; }
        const first = seen.current === undefined;
        const changed = !first && v !== seen.current;
        seen.current = v;
        if (changed) router.refresh();
      } catch {
        // The poll itself failed. Refresh rather than risk a frozen screen.
        router.refresh();
      }
    };

    const tick = watch ? tickWatched : tickAlways;
    const id = setInterval(tick, ms);

    // Switching back to this tab shows the latest immediately — unconditionally,
    // because someone who has been away wants certainty, not a token comparison.
    const onFocus = () => {
      if (hidden()) return;
      seen.current = undefined; // re-baseline: the page is about to be current
      router.refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, seconds, watch]);
  return null;
}
