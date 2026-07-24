"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, X, MapPin } from "lucide-react";

interface Reminder {
  key: string;
  id: string;
  title: string;
  startAt: string;
  remindMinutes: number;
  location: string | null;
  calendar: string | null;
}

const POLL_MS = 60_000;
const DISMISS_KEY = "calendar_reminders_dismissed";
const MS_PH = 8 * 3600 * 1000;

function readDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")); } catch { return new Set(); }
}
function writeDismissed(s: Set<string>) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-300))); } catch { /* ignore */ }
}
function whenLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + MS_PH);
  const hh = d.getUTCHours(), mm = d.getUTCMinutes();
  const now = new Date(Date.now() + MS_PH);
  const sameDay = d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
  const ap = hh < 12 ? "AM" : "PM"; const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const t = `${h12}:${String(mm).padStart(2, "0")} ${ap}`;
  return sameDay ? `Today · ${t}` : `${new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric" })} · ${t}`;
}

/**
 * In-app calendar reminders — a small stack of dismissable cards, bottom-right,
 * shown when an event's reminder time has arrived. Polls the server and remembers
 * dismissed reminders per browser so they don't reappear.
 */
export function CalendarReminders() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/reminders", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { reminders?: Reminder[] };
      setItems(Array.isArray(data.reminders) ? data.reminders : []);
    } catch { /* offline — keep current */ }
  }, []);

  useEffect(() => {
    setDismissed(readDismissed());
    load();
    const iv = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(iv);
  }, [load]);

  function dismiss(key: string) {
    setDismissed((prev) => { const n = new Set(prev); n.add(key); writeDismissed(n); return n; });
  }

  const shown = items.filter((r) => !dismissed.has(r.key)).slice(0, 4);
  if (shown.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2 print:hidden">
      {shown.map((r) => (
        <div key={r.key} className="overflow-hidden rounded-lg border border-amber-300 bg-card shadow-lg dark:border-amber-700">
          <div className="flex items-start gap-2 p-3">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0 animate-approver-blink text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">{r.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{whenLabel(r.startAt)}{r.calendar ? ` · ${r.calendar}` : ""}</p>
              {r.location && <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {r.location}</p>}
              <Link href="/calendar" onClick={() => dismiss(r.key)} className="mt-1 inline-block text-xs font-medium text-primary hover:underline">Open calendar →</Link>
            </div>
            <button type="button" onClick={() => dismiss(r.key)} className="rounded p-0.5 text-muted-foreground hover:bg-accent" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
