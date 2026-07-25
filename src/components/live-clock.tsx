"use client";

import { useEffect, useState } from "react";

/** Manila-time parts of an instant (the app runs on Asia/Manila). */
function clockParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return p; // hour, minute, second, dayPeriod, weekday, month, day, year
}

/**
 * A live digital clock bar pinned to the top of the app — persists across every
 * page. Ticks every second and reads Manila time (the timezone the whole ERP
 * runs on). Renders a stable placeholder before mount to avoid hydration drift.
 */
export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const p = now ? clockParts(now) : null;

  return (
    <div className="sticky top-0 z-50 flex h-11 w-full items-center justify-center gap-3 bg-[#2ec4b6] text-slate-900 shadow-sm print:hidden">
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-700 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-700" />
      </span>
      <div className="flex items-baseline gap-1.5 tabular-nums">
        <span className="text-xl font-bold leading-none">{p ? `${p.hour}:${p.minute}` : "--:--"}</span>
        <span className="text-sm font-semibold text-blue-800">{p?.dayPeriod ?? ""}</span>
        <span className="w-8 text-xs font-medium text-slate-700">{p ? `${p.second}s` : ""}</span>
      </div>
      <span className="h-5 w-px bg-slate-900/25" />
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-bold">{p ? `${p.weekday}, ${p.month} ${p.day}` : "—"}</span>
        <span className="text-sm font-semibold text-blue-800">{p?.year ?? ""}</span>
      </div>
    </div>
  );
}
