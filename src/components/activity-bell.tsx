"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";

interface Activity {
  id: string;
  action: string;
  category: string;
  summary: string;
  entity: string | null;
  entityId: string | null;
  href: string | null;
  actorName: string;
  createdAt: string;
}

const POLL_MS = 30_000; // re-check for new activity every 30s
const SEEN_KEY = "activity_seen_at"; // localStorage: ISO of the newest item the user has seen

// A small coloured dot per category so the feed scans quickly.
const CAT_COLOR: Record<string, string> = {
  order: "#2a78d6",
  schedule: "#7c5cff",
  cash: "#c98a00",
  purchase: "#1baf7a",
  inventory: "#0ea5b7",
  quotation: "#e87ba4",
  commission: "#4a3aa7",
  admin: "#64748b",
  general: "#94a3b8",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/**
 * Notification bell showing recent system activity (approvals, stage changes,
 * lifecycle events). The unread count is items newer than the last time the
 * user opened the panel (tracked in localStorage, per browser).
 */
export function ActivityBell() {
  const [items, setItems] = useState<Activity[]>([]);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string>("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { activity?: Activity[] };
      setItems(Array.isArray(data.activity) ? data.activity : []);
    } catch {
      /* offline / transient — keep the last list */
    }
  }, []);

  useEffect(() => {
    setSeenAt(localStorage.getItem(SEEN_KEY) ?? "");
    load();
    const iv = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(iv);
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const unread = seenAt ? items.filter((i) => i.createdAt > seenAt).length : items.length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items.length > 0) {
      // Mark the newest item as seen.
      const newest = items[0].createdAt;
      localStorage.setItem(SEEN_KEY, newest);
      setSeenAt(newest);
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border bg-card shadow-lg sm:w-96">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Activity</span>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="divide-y">
                {items.map((it) => {
                  const dot = CAT_COLOR[it.category] ?? CAT_COLOR.general;
                  const isNew = seenAt ? it.createdAt > seenAt : false;
                  const body = (
                    <div className="flex gap-2.5 px-3 py-2.5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{it.summary}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {it.actorName} · {timeAgo(it.createdAt)}
                        </p>
                      </div>
                      {isNew && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
                    </div>
                  );
                  return (
                    <li key={it.id} className="transition-colors hover:bg-accent">
                      {it.href ? (
                        <Link href={it.href} onClick={() => setOpen(false)} className="block">{body}</Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
