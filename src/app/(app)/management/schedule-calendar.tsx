"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, X, Check, Ban, Trash2, Pencil, MapPin, CalendarDays, User, Users, Repeat, Bell, Paperclip, MessageSquare, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadLink } from "@/components/upload-link";
import { ApproverHighlight } from "@/components/approver-highlight";
import {
  SCHEDULE_CATEGORIES,
  scheduleCategory,
  SCHEDULE_STATUS_LABEL,
  RECURRENCE_OPTIONS,
  REMINDER_OPTIONS,
  recurrenceLabel,
  reminderLabel,
  RSVP_LABEL,
  type ScheduleView,
  type ScheduleStatus,
} from "@/lib/schedule";
import {
  createSchedule, updateSchedule, deleteSchedule, decideSchedule,
  addScheduleComment, deleteScheduleComment, setScheduleRsvp,
  attachScheduleFile, removeScheduleFile, addCalendarAction, removeCalendarAction,
} from "./schedule-actions";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MS_PH = 8 * 3600 * 1000; // Manila is fixed UTC+8 (no DST)
const DEFAULT_CAL = "General";
const pad = (n: number) => String(n).padStart(2, "0");

function phParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + MS_PH);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
function phTodayParts() {
  const d = new Date(Date.now() + MS_PH);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
function fmtTime(hh: number, mm: number) {
  const ap = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${pad(mm)} ${ap}`;
}
function monthName(y: number, m: number) {
  return new Date(Date.UTC(y, m, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}
const calOf = (s: ScheduleView) => (s.calendar && s.calendar.trim() ? s.calendar : DEFAULT_CAL);
const rowKey = (s: ScheduleView) => s.instanceKey ?? s.id;
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const STATUS_STYLE: Record<ScheduleStatus, string> = {
  APPROVED: "",
  PENDING: "border border-dashed",
  REJECTED: "opacity-55 line-through",
};

type FormState = {
  id?: string;
  title: string; category: string; date: string; allDay: boolean;
  startTime: string; endTime: string; location: string; details: string;
  recurrence: string; recurrenceUntil: string; remindMinutes: number | null;
  calendar: string; attendees: { userId: string; name: string }[];
};

const emptyForm = (date: string, calendar: string): FormState => ({
  title: "", category: "general", date, allDay: true, startTime: "09:00", endTime: "10:00", location: "", details: "",
  recurrence: "", recurrenceUntil: "", remindMinutes: null, calendar, attendees: [],
});

type ViewMode = "month" | "week" | "agenda";

export function ScheduleCalendar({
  schedules,
  canApprove,
  viewerId = "",
  users = [],
  calendars = [DEFAULT_CAL],
  canManageCalendars = false,
}: {
  schedules: ScheduleView[];
  canApprove: boolean;
  viewerId?: string;
  users?: { id: string; name: string }[];
  calendars?: string[];
  canManageCalendars?: boolean;
}) {
  const router = useRouter();
  const today = phTodayParts();
  const [mode, setMode] = useState<ViewMode>("month");
  const [view, setView] = useState<{ y: number; m: number; d: number }>({ y: today.y, m: today.m, d: today.d });
  const [form, setForm] = useState<FormState | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [dayList, setDayList] = useState<{ key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [attSearch, setAttSearch] = useState("");
  const [calName, setCalName] = useState("");
  // Filters — which calendars & categories are visible (all on by default).
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(new Set());
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());

  const allCalendars = useMemo(() => {
    const set = new Map<string, string>();
    for (const c of calendars) set.set(c.toLowerCase(), c);
    for (const s of schedules) { const c = calOf(s); set.set(c.toLowerCase(), c); }
    return [...set.values()];
  }, [calendars, schedules]);

  const visible = useMemo(
    () => schedules.filter((s) => !hiddenCals.has(calOf(s).toLowerCase()) && !hiddenCats.has(s.category)),
    [schedules, hiddenCals, hiddenCats],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleView[]>();
    for (const s of visible) {
      const p = phParts(s.startAt);
      const k = dayKey(p.y, p.m, p.d);
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.startAt.localeCompare(b.startAt) || (a.allDay ? -1 : 1));
    return m;
  }, [visible]);

  const pendingCount = useMemo(() => schedules.filter((s) => s.status === "PENDING").length, [schedules]);
  const detail = useMemo(() => (detailKey ? schedules.find((s) => rowKey(s) === detailKey) ?? null : null), [detailKey, schedules]);

  // Month grid cells.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1));
    const gridStart = new Date(Date.UTC(view.y, view.m, 1 - first.getUTCDay()));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart.getTime() + i * 86400000);
      const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
      return { y, m, day, key: dayKey(y, m, day), inMonth: m === view.m, isToday: y === today.y && m === today.m && day === today.d };
    });
  }, [view, today]);

  // Week days (Sun–Sat of the week containing view).
  const weekDays = useMemo(() => {
    const anchor = new Date(Date.UTC(view.y, view.m, view.d));
    const start = new Date(anchor.getTime() - anchor.getUTCDay() * 86400000);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getTime() + i * 86400000);
      const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
      return { y, m, day, key: dayKey(y, m, day), isToday: y === today.y && m === today.m && day === today.d };
    });
  }, [view, today]);

  // Agenda — upcoming visible events from today, grouped by day.
  const agenda = useMemo(() => {
    const todayKey = dayKey(today.y, today.m, today.d);
    const groups = new Map<string, ScheduleView[]>();
    for (const s of visible) {
      const p = phParts(s.startAt);
      const k = dayKey(p.y, p.m, p.d);
      if (k < todayKey) continue;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 60)
      .map(([k, arr]) => [k, arr.sort((a, b) => a.startAt.localeCompare(b.startAt))] as const);
  }, [visible, today]);

  function shift(delta: number) {
    if (mode === "month") setView((v) => { const nm = v.m + delta; return { y: v.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12, d: 1 }; });
    else if (mode === "week") setView((v) => { const d = new Date(Date.UTC(v.y, v.m, v.d + delta * 7)); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; });
    else setView((v) => { const d = new Date(Date.UTC(v.y, v.m, v.d + delta * 30)); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; });
  }

  async function run(fn: () => Promise<unknown>, close?: () => void) {
    setBusy(true); setErr(null);
    try { await fn(); close?.(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  function openAdd(date: string) { setErr(null); setForm(emptyForm(date, allCalendars[0] ?? DEFAULT_CAL)); }
  function openEdit(s: ScheduleView) {
    const p = phParts(s.startAt);
    const e = s.endAt ? phParts(s.endAt) : null;
    const ru = s.recurrenceUntil ? phParts(s.recurrenceUntil) : null;
    setErr(null); setDetailKey(null);
    setForm({
      id: s.id, title: s.title, category: s.category, date: dayKey(p.y, p.m, p.d), allDay: s.allDay,
      startTime: `${pad(p.hh)}:${pad(p.mm)}`, endTime: e ? `${pad(e.hh)}:${pad(e.mm)}` : "10:00",
      location: s.location ?? "", details: s.details ?? "",
      recurrence: s.recurrence ?? "", recurrenceUntil: ru ? dayKey(ru.y, ru.m, ru.d) : "", remindMinutes: s.remindMinutes ?? null,
      calendar: calOf(s), attendees: s.attendees.map((a) => ({ userId: a.userId, name: a.name })),
    });
  }

  function submitForm() {
    if (!form) return;
    if (!form.title.trim()) { setErr("Add a title for the schedule."); return; }
    const payload = {
      title: form.title, details: form.details, category: form.category, date: form.date,
      allDay: form.allDay, startTime: form.allDay ? "" : form.startTime, endTime: form.allDay ? "" : form.endTime, location: form.location,
      recurrence: form.recurrence as "" | "daily" | "weekly" | "monthly", recurrenceUntil: form.recurrence ? form.recurrenceUntil : "",
      remindMinutes: form.remindMinutes, calendar: form.calendar, attendees: form.attendees,
    };
    run(() => (form.id ? updateSchedule(form.id, payload) : createSchedule(payload)), () => setForm(null));
  }

  async function uploadAttachment(file: File, scheduleId: string) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("scheduleId", scheduleId);
      const res = await fetch("/api/schedule-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await attachScheduleFile(scheduleId, data);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); }
  }

  const myRsvp = detail ? detail.attendees.find((a) => a.userId === viewerId)?.rsvp ?? null : null;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent" aria-label="Previous"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => shift(1)} className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent" aria-label="Next"><ChevronRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => setView({ y: today.y, m: today.m, d: today.d })} className="ml-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent">Today</button>
        </div>
        <div className="text-lg font-bold tracking-tight">
          {mode === "week"
            ? `Week of ${new Date(Date.UTC(weekDays[0].y, weekDays[0].m, weekDays[0].day)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`
            : mode === "agenda" ? "Agenda"
            : <>{monthName(view.y, view.m)} <span className="font-normal text-muted-foreground">{view.y}</span></>}
        </div>
        {canApprove && pendingCount > 0 && (
          <span className="animate-approver-blink inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{pendingCount} pending approval</span>
        )}
        {/* View switcher */}
        <div className="ml-auto inline-flex overflow-hidden rounded-md border text-xs">
          {(["month", "week", "agenda"] as ViewMode[]).map((v) => (
            <button key={v} type="button" onClick={() => setMode(v)} className={`px-2.5 py-1.5 font-medium capitalize ${mode === v ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{v}</button>
          ))}
        </div>
        <Button size="sm" className="h-8" onClick={() => openAdd(dayKey(today.y, today.m, today.d))}><Plus className="mr-1 h-4 w-4" /> Add</Button>
      </div>

      {/* Filters — calendars + categories toggle visibility. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border bg-muted/20 p-2 text-[11px]">
        <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Calendars</span>
        {allCalendars.map((c) => {
          const on = !hiddenCals.has(c.toLowerCase());
          return (
            <span key={c} className="inline-flex items-center gap-1">
              <button type="button" onClick={() => setHiddenCals((s) => { const n = new Set(s); const k = c.toLowerCase(); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                className={`rounded-full px-2 py-0.5 font-medium ${on ? "bg-primary/10 text-primary" : "text-muted-foreground line-through"}`}>{c}</button>
              {canManageCalendars && c.toLowerCase() !== DEFAULT_CAL.toLowerCase() && (
                <button type="button" title="Remove calendar" onClick={() => run(() => removeCalendarAction(c))} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
              )}
            </span>
          );
        })}
        {canManageCalendars && (
          <span className="inline-flex items-center gap-1">
            <input value={calName} onChange={(e) => setCalName(e.target.value)} placeholder="New calendar" className="h-6 w-28 rounded border bg-background px-1.5 text-[11px]" />
            <button type="button" disabled={busy || !calName.trim()} onClick={() => run(() => addCalendarAction(calName), () => setCalName(""))} className="rounded border px-1.5 py-0.5 font-medium hover:bg-accent disabled:opacity-50">Add</button>
          </span>
        )}
        <span className="mx-1 h-4 w-px bg-border" />
        {SCHEDULE_CATEGORIES.map((c) => {
          const on = !hiddenCats.has(c.key);
          return (
            <button key={c.key} type="button" onClick={() => setHiddenCats((s) => { const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })}
              className={`inline-flex items-center gap-1.5 ${on ? "" : "opacity-40 line-through"}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.label}
            </button>
          );
        })}
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-amber-500" />Pending</span>
      </div>

      {/* Month view */}
      {mode === "month" && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((c, i) => {
              const events = byDay.get(c.key) ?? [];
              const shown = events.slice(0, 3);
              return (
                <button type="button" key={c.key + i} onClick={() => openAdd(c.key)}
                  className={`group min-h-[92px] border-b border-r p-1.5 text-left align-top transition-colors last:border-r-0 hover:bg-accent/40 ${i % 7 === 6 ? "border-r-0" : ""} ${c.inMonth ? "" : "bg-muted/20 text-muted-foreground/60"}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${c.isToday ? "bg-primary text-primary-foreground" : c.inMonth ? "text-foreground" : ""}`}>{c.day}</span>
                    <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div className="space-y-1">
                    {shown.map((s) => <EventChip key={rowKey(s)} s={s} onClick={(e) => { e.stopPropagation(); setDetailKey(rowKey(s)); }} />)}
                    {events.length > 3 && (
                      <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setDayList({ key: c.key }); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setDayList({ key: c.key }); } }} className="block cursor-pointer px-1.5 text-[11px] font-medium text-primary hover:underline">+{events.length - 3} more</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Week view */}
      {mode === "week" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {weekDays.map((c) => {
            const events = byDay.get(c.key) ?? [];
            return (
              <div key={c.key} className="rounded-lg border bg-card">
                <button type="button" onClick={() => openAdd(c.key)} className="flex w-full items-center justify-between border-b px-2 py-1.5 text-left hover:bg-accent/40">
                  <span className="text-xs font-semibold">{WEEKDAYS[new Date(Date.UTC(c.y, c.m, c.day)).getUTCDay()]} <span className={`ml-1 ${c.isToday ? "rounded bg-primary px-1 text-primary-foreground" : "text-muted-foreground"}`}>{c.day}</span></span>
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <div className="space-y-1 p-1.5">
                  {events.length === 0 ? <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">—</p>
                    : events.map((s) => <EventChip key={rowKey(s)} s={s} onClick={() => setDetailKey(rowKey(s))} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Agenda view */}
      {mode === "agenda" && (
        <div className="space-y-3">
          {agenda.length === 0 ? <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">No upcoming events.</p>
            : agenda.map(([k, arr]) => {
              const [y, m, d] = k.split("-").map(Number);
              return (
                <div key={k}>
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">{new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })}</div>
                  <div className="space-y-1">
                    {arr.map((s) => {
                      const cat = scheduleCategory(s.category); const p = phParts(s.startAt);
                      return (
                        <button key={rowKey(s)} type="button" onClick={() => setDetailKey(rowKey(s))} className={`flex w-full items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-left text-sm hover:bg-accent ${STATUS_STYLE[s.status]}`}>
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.color }} />
                          <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{s.allDay ? "All-day" : fmtTime(p.hh, p.mm)}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{s.title}{s.recurring && <Repeat className="ml-1 inline h-3 w-3 text-muted-foreground" />}</span>
                          <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{calOf(s)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Add / edit modal */}
      {form && (
        <Modal onClose={() => setForm(null)} title={form.id ? "Edit schedule" : "Add schedule"}>
          <div className="space-y-3">
            <Field label="Title"><Input value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Site delivery — Project Golden" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {SCHEDULE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Calendar">
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.calendar} onChange={(e) => setForm({ ...form, calendar: e.target.value })}>
                  {allCalendars.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Reminder">
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.remindMinutes ?? ""} onChange={(e) => setForm({ ...form, remindMinutes: e.target.value === "" ? null : Number(e.target.value) })}>
                  {REMINDER_OPTIONS.map((o) => <option key={String(o.key)} value={o.key ?? ""}>{o.label}</option>)}
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[#ed1c24]" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} /> All-day
            </label>
            {!form.allDay && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
                <Field label="End"><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Repeat">
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}>
                  {RECURRENCE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </Field>
              {form.recurrence && <Field label="Repeat until (optional)"><Input type="date" value={form.recurrenceUntil} onChange={(e) => setForm({ ...form, recurrenceUntil: e.target.value })} /></Field>}
            </div>
            <Field label="Location (optional)"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Plant / Client site" /></Field>
            {/* Attendees */}
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Attendees</span>
              {form.attendees.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {form.attendees.map((a) => (
                    <span key={a.userId} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">{a.name}
                      <button type="button" onClick={() => setForm({ ...form, attendees: form.attendees.filter((x) => x.userId !== a.userId) })} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <Input value={attSearch} onChange={(e) => setAttSearch(e.target.value)} placeholder="Search people to add…" className="h-8" />
              {attSearch.trim() && (
                <div className="max-h-32 overflow-y-auto rounded-md border">
                  {users.filter((u) => u.name.toLowerCase().includes(attSearch.trim().toLowerCase()) && !form.attendees.some((a) => a.userId === u.id)).slice(0, 8).map((u) => (
                    <button key={u.id} type="button" onClick={() => { setForm({ ...form, attendees: [...form.attendees, { userId: u.id, name: u.name }] }); setAttSearch(""); }} className="block w-full px-2 py-1.5 text-left text-sm hover:bg-accent">{u.name}</button>
                  ))}
                </div>
              )}
            </div>
            <Field label="Details (optional)"><textarea className="min-h-[60px] w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Notes, instructions…" /></Field>
            {!canApprove && <p className="text-[11px] text-muted-foreground">This schedule will be submitted for approval by an Engineer, Admin or Approver.</p>}
            {err && <p className="text-xs text-destructive">{err}</p>}
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" className="h-8" disabled={busy} onClick={submitForm}>{busy ? "Saving…" : form.id ? "Save changes" : "Add schedule"}</Button>
              <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Detail modal */}
      {detail && (() => {
        const cat = scheduleCategory(detail.category);
        const p = phParts(detail.startAt);
        const e = detail.endAt ? phParts(detail.endAt) : null;
        return (
          <Modal onClose={() => { setDetailKey(null); setComment(""); }} title={detail.title} accent={cat.color}>
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${cat.color}20`, color: cat.color }}><span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />{cat.label}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><CalendarDays className="h-3 w-3" /> {calOf(detail)}</span>
                <StatusBadge status={detail.status} />
              </div>
              <div className="flex items-start gap-2 text-muted-foreground">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{new Date(Date.UTC(p.y, p.m, p.d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  {!detail.allDay && <span className="ml-1 text-foreground">· {fmtTime(p.hh, p.mm)}{e ? ` – ${fmtTime(e.hh, e.mm)}` : ""}</span>}
                  {detail.allDay && <span className="ml-1">· All-day</span>}</span>
              </div>
              {detail.recurrence && <div className="flex items-center gap-2 text-muted-foreground"><Repeat className="h-4 w-4" /> {recurrenceLabel(detail.recurrence)}{detail.recurrenceUntil ? ` · until ${new Date(detail.recurrenceUntil).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })}` : ""}</div>}
              {detail.remindMinutes != null && <div className="flex items-center gap-2 text-muted-foreground"><Bell className="h-4 w-4" /> {reminderLabel(detail.remindMinutes)}</div>}
              {detail.location && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" /> {detail.location}</div>}
              {detail.details && <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-foreground">{detail.details}</p>}

              {/* Attendees + RSVP */}
              {(detail.attendees.length > 0) && (
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Users className="h-3.5 w-3.5" /> Attendees</span>
                  <div className="flex flex-wrap gap-1">
                    {detail.attendees.map((a) => (
                      <span key={a.userId} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">{a.name}
                        <span className={`rounded px-1 text-[10px] font-medium ${a.rsvp === "going" ? "bg-emerald-100 text-emerald-700" : a.rsvp === "no" ? "bg-red-100 text-red-700" : a.rsvp === "maybe" ? "bg-amber-100 text-amber-700" : "text-muted-foreground"}`}>{RSVP_LABEL[a.rsvp]}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {viewerId && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Your RSVP:</span>
                  {(["going", "maybe", "no"] as const).map((r) => (
                    <button key={r} type="button" disabled={busy} onClick={() => run(() => setScheduleRsvp(detail.id, r))} className={`rounded-full border px-2 py-0.5 font-medium ${myRsvp === r ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{RSVP_LABEL[r]}</button>
                  ))}
                </div>
              )}

              {/* Attachments */}
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Paperclip className="h-3.5 w-3.5" /> Attachments</span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {detail.attachments.map((f) => (
                    <UploadLink key={f.path} doc={f} base="/api/schedule-uploads" size="xs" onRemove={detail.canEdit ? () => { if (window.confirm(`Remove "${f.name}"?`)) run(() => removeScheduleFile(detail.id, f.path)); } : undefined} />
                  ))}
                  {detail.canEdit && (
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-accent">
                      <Upload className="h-3.5 w-3.5" /> {busy ? "…" : "Add file"}
                      <input type="file" className="hidden" disabled={busy} onChange={(ev) => ev.target.files?.[0] && uploadAttachment(ev.target.files[0], detail.id)} />
                    </label>
                  )}
                  {detail.attachments.length === 0 && !detail.canEdit && <span className="text-xs text-muted-foreground">None</span>}
                </div>
              </div>

              {/* Comments */}
              <div className="space-y-1.5 border-t pt-2">
                <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><MessageSquare className="h-3.5 w-3.5" /> Comments ({detail.comments.length})</span>
                <div className="max-h-40 space-y-1.5 overflow-y-auto">
                  {detail.comments.map((c) => (
                    <div key={c.id} className="rounded-md border bg-muted/20 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">{c.byName}</span>
                        <span className="inline-flex items-center gap-1">{c.at ? fmtWhen(c.at) : ""}
                          {(canApprove || c.byId === viewerId) && <button type="button" onClick={() => run(() => deleteScheduleComment(detail.id, c.id))} className="hover:text-destructive"><Trash2 className="h-3 w-3" /></button>}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{c.text}</p>
                    </div>
                  ))}
                  {detail.comments.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Input value={comment} onChange={(ev) => setComment(ev.target.value)} placeholder="Write a comment…" className="h-8" onKeyDown={(ev) => { if (ev.key === "Enter" && comment.trim()) run(() => addScheduleComment(detail.id, comment), () => setComment("")); }} />
                  <Button size="sm" className="h-8" disabled={busy || !comment.trim()} onClick={() => run(() => addScheduleComment(detail.id, comment), () => setComment(""))}><Send className="h-4 w-4" /></Button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground"><User className="h-3.5 w-3.5" /> Added by {detail.createdByName}</div>
              {detail.decidedByName && <div className="text-xs text-muted-foreground">{detail.status === "APPROVED" ? "Approved" : "Rejected"} by {detail.decidedByName}{detail.decisionNote ? ` — ${detail.decisionNote}` : ""}</div>}
              {detail.status === "PENDING" && <ApproverHighlight role="Engineer / Admin / Approver" detail="to approve this schedule" />}
              {err && <p className="text-xs text-destructive">{err}</p>}
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                {detail.canDecide && detail.status !== "APPROVED" && <Button size="sm" className="h-8" disabled={busy} onClick={() => run(() => decideSchedule(detail.id, "approve"), () => setDetailKey(null))}><Check className="mr-1 h-4 w-4" /> Approve</Button>}
                {detail.canDecide && detail.status !== "REJECTED" && <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => run(() => decideSchedule(detail.id, "reject"), () => setDetailKey(null))}><Ban className="mr-1 h-4 w-4" /> Reject</Button>}
                {detail.canEdit && <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => openEdit(detail)}><Pencil className="mr-1 h-4 w-4" /> Edit</Button>}
                {detail.canEdit && <button type="button" disabled={busy} onClick={() => { if (window.confirm(detail.recurrence ? "Delete this repeating event (whole series)?" : "Delete this schedule?")) run(() => deleteSchedule(detail.id), () => setDetailKey(null)); }} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Day list modal */}
      {dayList && (() => {
        const events = byDay.get(dayList.key) ?? [];
        const [y, m, d] = dayList.key.split("-").map(Number);
        return (
          <Modal onClose={() => setDayList(null)} title={new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })}>
            <div className="space-y-1.5">
              {events.map((s) => { const cat = scheduleCategory(s.category); const p = phParts(s.startAt); return (
                <button key={rowKey(s)} type="button" onClick={() => { setDayList(null); setDetailKey(rowKey(s)); }} className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent ${STATUS_STYLE[s.status]}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.color }} />
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{s.allDay ? "All-day" : fmtTime(p.hh, p.mm)}</span>
                </button>
              ); })}
              <Button size="sm" variant="outline" className="mt-1 h-8 w-full" onClick={() => { setDayList(null); openAdd(dayList.key); }}><Plus className="mr-1 h-4 w-4" /> Add on this day</Button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

function EventChip({ s, onClick }: { s: ScheduleView; onClick: (e: React.MouseEvent) => void }) {
  const cat = scheduleCategory(s.category);
  const p = phParts(s.startAt);
  return (
    <span role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter") onClick(e as unknown as React.MouseEvent); }}
      className={`block cursor-pointer truncate rounded-md px-1.5 py-0.5 text-[11px] leading-tight text-foreground ${STATUS_STYLE[s.status]}`}
      style={{ background: `${cat.color}1f`, borderColor: s.status === "PENDING" ? "#f59e0b" : "transparent" }} title={s.title}>
      <span className="mr-1 inline-block h-2 w-2 shrink-0 rounded-full align-middle" style={{ background: cat.color }} />
      {!s.allDay && <span className="tabular-nums text-muted-foreground">{fmtTime(p.hh, p.mm)} </span>}
      {s.title}
      {s.recurring && <Repeat className="ml-0.5 inline h-2.5 w-2.5 text-muted-foreground" />}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

function StatusBadge({ status }: { status: ScheduleStatus }) {
  const map: Record<ScheduleStatus, string> = {
    APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    REJECTED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>{SCHEDULE_STATUS_LABEL[status]}</span>;
}

function Modal({ title, accent, onClose, children }: { title: string; accent?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[6vh]" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={accent ? { boxShadow: `inset 4px 0 0 ${accent}` } : undefined}>
          <h3 className="text-sm font-bold text-balance">{title}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
