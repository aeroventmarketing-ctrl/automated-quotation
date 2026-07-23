"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, X, Check, Ban, Trash2, Pencil, Clock, MapPin, CalendarDays, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SCHEDULE_CATEGORIES,
  scheduleCategory,
  SCHEDULE_STATUS_LABEL,
  type ScheduleView,
  type ScheduleStatus,
} from "@/lib/schedule";
import { createSchedule, updateSchedule, deleteSchedule, decideSchedule } from "./schedule-actions";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MS_PH = 8 * 3600 * 1000; // Manila is fixed UTC+8 (no DST)
const pad = (n: number) => String(n).padStart(2, "0");

/** Manila wall-clock parts of an instant (shift +8h, then read UTC parts). */
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

const STATUS_STYLE: Record<ScheduleStatus, string> = {
  APPROVED: "",
  PENDING: "border border-dashed",
  REJECTED: "opacity-55 line-through",
};

type FormState = {
  id?: string;
  title: string;
  category: string;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  location: string;
  details: string;
};

const emptyForm = (date: string): FormState => ({
  title: "", category: "general", date, allDay: true, startTime: "09:00", endTime: "10:00", location: "", details: "",
});

export function ScheduleCalendar({
  schedules,
  canApprove,
}: {
  schedules: ScheduleView[];
  /** Whether the current viewer can approve/reject (Engineer / Admin / Approver). */
  canApprove: boolean;
}) {
  const router = useRouter();
  const today = phTodayParts();
  const [view, setView] = useState<{ y: number; m: number }>({ y: today.y, m: today.m });
  const [form, setForm] = useState<FormState | null>(null);
  const [detail, setDetail] = useState<ScheduleView | null>(null);
  const [dayList, setDayList] = useState<{ key: string; date: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Bucket schedules by their Manila calendar day.
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleView[]>();
    for (const s of schedules) {
      const p = phParts(s.startAt);
      const k = dayKey(p.y, p.m, p.d);
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.startAt.localeCompare(b.startAt) || (a.allDay ? -1 : 1));
    return m;
  }, [schedules]);

  const pendingCount = useMemo(() => schedules.filter((s) => s.status === "PENDING").length, [schedules]);

  // Build the 6×7 grid starting from the Sunday of the first week.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1));
    const startDow = first.getUTCDay();
    const gridStart = new Date(Date.UTC(view.y, view.m, 1 - startDow));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart.getTime() + i * 86400000);
      const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
      return { y, m, day, key: dayKey(y, m, day), inMonth: m === view.m, isToday: y === today.y && m === today.m && day === today.d };
    });
  }, [view, today]);

  function shiftMonth(delta: number) {
    setView((v) => {
      const nm = v.m + delta;
      return { y: v.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
    });
  }

  async function run(fn: () => Promise<void>, close: () => void) {
    setBusy(true); setErr(null);
    try { await fn(); close(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  function openAdd(date: string) { setErr(null); setForm(emptyForm(date)); }
  function openEdit(s: ScheduleView) {
    const p = phParts(s.startAt);
    const e = s.endAt ? phParts(s.endAt) : null;
    setErr(null); setDetail(null);
    setForm({
      id: s.id, title: s.title, category: s.category, date: dayKey(p.y, p.m, p.d), allDay: s.allDay,
      startTime: `${pad(p.hh)}:${pad(p.mm)}`, endTime: e ? `${pad(e.hh)}:${pad(e.mm)}` : "10:00",
      location: s.location ?? "", details: s.details ?? "",
    });
  }

  function submitForm() {
    if (!form) return;
    if (!form.title.trim()) { setErr("Add a title for the schedule."); return; }
    const payload = {
      title: form.title, details: form.details, category: form.category, date: form.date,
      allDay: form.allDay, startTime: form.allDay ? "" : form.startTime, endTime: form.allDay ? "" : form.endTime, location: form.location,
    };
    run(() => (form.id ? updateSchedule(form.id, payload) : createSchedule(payload)), () => setForm(null));
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shiftMonth(-1)} className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => shiftMonth(1)} className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => setView({ y: today.y, m: today.m })} className="ml-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent">Today</button>
        </div>
        <div className="text-lg font-bold tracking-tight">{monthName(view.y, view.m)} <span className="font-normal text-muted-foreground">{view.y}</span></div>
        {canApprove && pendingCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{pendingCount} pending approval</span>
        )}
        <Button size="sm" className="ml-auto h-8" onClick={() => openAdd(dayKey(today.y, today.m, today.d))}>
          <Plus className="mr-1 h-4 w-4" /> Add schedule
        </Button>
      </div>

      {/* Category legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {SCHEDULE_CATEGORIES.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-amber-500" />Pending</span>
      </div>

      {/* Month grid */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, i) => {
            const events = byDay.get(c.key) ?? [];
            const shown = events.slice(0, 3);
            return (
              <button
                type="button"
                key={c.key + i}
                onClick={() => openAdd(c.key)}
                className={`group min-h-[92px] border-b border-r p-1.5 text-left align-top transition-colors last:border-r-0 hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${i % 7 === 6 ? "border-r-0" : ""} ${c.inMonth ? "" : "bg-muted/20 text-muted-foreground/60"}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${c.isToday ? "bg-primary text-primary-foreground" : c.inMonth ? "text-foreground" : ""}`}>{c.day}</span>
                  <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <div className="space-y-1">
                  {shown.map((s) => {
                    const cat = scheduleCategory(s.category);
                    const p = phParts(s.startAt);
                    return (
                      <span
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setDetail(s); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setDetail(s); } }}
                        className={`block cursor-pointer truncate rounded-md px-1.5 py-0.5 text-[11px] leading-tight text-foreground ${STATUS_STYLE[s.status]}`}
                        style={{ background: `${cat.color}1f`, borderColor: s.status === "PENDING" ? "#f59e0b" : "transparent" }}
                        title={s.title}
                      >
                        <span className="mr-1 inline-block h-2 w-2 shrink-0 rounded-full align-middle" style={{ background: cat.color }} />
                        {!s.allDay && <span className="tabular-nums text-muted-foreground">{fmtTime(p.hh, p.mm)} </span>}
                        {s.title}
                      </span>
                    );
                  })}
                  {events.length > 3 && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); setDayList({ key: c.key, date: c.key }); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setDayList({ key: c.key, date: c.key }); } }}
                      className="block cursor-pointer px-1.5 text-[11px] font-medium text-primary hover:underline"
                    >
                      +{events.length - 3} more
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Add / edit modal */}
      {form && (
        <Modal onClose={() => setForm(null)} title={form.id ? "Edit schedule" : "Add schedule"}>
          <div className="space-y-3">
            <Field label="Title">
              <Input value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Site delivery — Project Golden" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {SCHEDULE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[#ed1c24]" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
              All-day
            </label>
            {!form.allDay && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
                <Field label="End"><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field>
              </div>
            )}
            <Field label="Location (optional)"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Plant / Client site" /></Field>
            <Field label="Details (optional)">
              <textarea className="min-h-[70px] w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Notes, attendees, instructions…" />
            </Field>
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
          <Modal onClose={() => setDetail(null)} title={detail.title} accent={cat.color}>
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${cat.color}20`, color: cat.color }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />{cat.label}
                </span>
                <StatusBadge status={detail.status} />
              </div>
              <div className="flex items-start gap-2 text-muted-foreground">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {new Date(Date.UTC(p.y, p.m, p.d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  {!detail.allDay && <span className="ml-1 text-foreground">· {fmtTime(p.hh, p.mm)}{e ? ` – ${fmtTime(e.hh, e.mm)}` : ""}</span>}
                  {detail.allDay && <span className="ml-1">· All-day</span>}
                </span>
              </div>
              {detail.location && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" /> {detail.location}</div>}
              {detail.details && <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-foreground">{detail.details}</p>}
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><User className="h-3.5 w-3.5" /> Added by {detail.createdByName}</div>
              {detail.decidedByName && (
                <div className="text-xs text-muted-foreground">
                  {detail.status === "APPROVED" ? "Approved" : "Rejected"} by {detail.decidedByName}
                  {detail.decisionNote ? ` — ${detail.decisionNote}` : ""}
                </div>
              )}
              {err && <p className="text-xs text-destructive">{err}</p>}
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                {detail.canDecide && detail.status !== "APPROVED" && (
                  <Button size="sm" className="h-8" disabled={busy} onClick={() => run(() => decideSchedule(detail.id, "approve"), () => setDetail(null))}><Check className="mr-1 h-4 w-4" /> Approve</Button>
                )}
                {detail.canDecide && detail.status !== "REJECTED" && (
                  <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => run(() => decideSchedule(detail.id, "reject"), () => setDetail(null))}><Ban className="mr-1 h-4 w-4" /> Reject</Button>
                )}
                {detail.canEdit && <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => openEdit(detail)}><Pencil className="mr-1 h-4 w-4" /> Edit</Button>}
                {detail.canEdit && (
                  <button type="button" disabled={busy} onClick={() => { if (window.confirm("Delete this schedule?")) run(() => deleteSchedule(detail.id), () => setDetail(null)); }} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Day list modal (when a day has more than 3 events) */}
      {dayList && (() => {
        const events = byDay.get(dayList.key) ?? [];
        const [y, m, d] = dayList.date.split("-").map(Number);
        return (
          <Modal onClose={() => setDayList(null)} title={new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })}>
            <div className="space-y-1.5">
              {events.map((s) => {
                const cat = scheduleCategory(s.category);
                const p = phParts(s.startAt);
                return (
                  <button key={s.id} type="button" onClick={() => { setDayList(null); setDetail(s); }} className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent ${STATUS_STYLE[s.status]}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.color }} />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{s.allDay ? "All-day" : fmtTime(p.hh, p.mm)}</span>
                  </button>
                );
              })}
              <Button size="sm" variant="outline" className="mt-1 h-8 w-full" onClick={() => { setDayList(null); openAdd(dayList.date); }}><Plus className="mr-1 h-4 w-4" /> Add on this day</Button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[8vh]" onClick={onClose}>
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
