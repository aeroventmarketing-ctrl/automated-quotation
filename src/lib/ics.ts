/**
 * Minimal iCalendar (.ics) parser for importing events (e.g. a TimeTree export).
 * Handles the common VEVENT fields AeroVent's calendar uses: SUMMARY, DTSTART /
 * DTEND (date or date-time, with or without TZID/UTC), DESCRIPTION, LOCATION,
 * URL and a simple RRULE (FREQ + UNTIL). Times are normalized to Manila wall
 * time (the timezone the ERP runs on).
 */

export interface IcsEvent {
  title: string;
  details: string | null;
  location: string | null;
  url: string | null;
  /** Manila calendar date, YYYY-MM-DD. */
  date: string;
  allDay: boolean;
  /** Manila HH:mm when not all-day. */
  startTime: string;
  endTime: string;
  recurrence: "" | "daily" | "weekly" | "monthly";
  /** Manila date YYYY-MM-DD, or "". */
  recurrenceUntil: string;
}

const MS_PH = 8 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Unfold folded lines (RFC 5545: a leading space/tab continues the prior line). */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** Unescape RFC 5545 TEXT (\n \, \; \\). */
function unescapeText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** Manila calendar parts of a parsed instant. */
function phParts(ms: number) {
  const d = new Date(ms + MS_PH);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/**
 * Parse a DTSTART/DTEND value into { ms, dateOnly }. Supports:
 *  - "20260705" (VALUE=DATE, all-day)
 *  - "20260705T090000Z" (UTC)
 *  - "20260705T090000" (floating / with TZID) — treated as Manila wall time
 */
function parseDt(value: string, params: Record<string, string>): { ms: number; dateOnly: boolean } | null {
  const v = value.trim();
  const dateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mm = "00", ss = "00", z] = m;
  if (dateOnly) return { ms: Date.UTC(+y, +mo - 1, +d) - MS_PH, dateOnly: true }; // midnight Manila
  if (z === "Z") return { ms: Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss), dateOnly: false };
  // Floating or TZID — interpret as Manila wall time (best effort).
  return { ms: Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss) - MS_PH, dateOnly: false };
}

function splitProp(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

function rruleOf(value: string): { recurrence: IcsEvent["recurrence"]; until: string } {
  const parts = Object.fromEntries(
    value.split(";").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).toUpperCase(), p.slice(i + 1)]; }),
  );
  const freq = String(parts.FREQ ?? "").toUpperCase();
  const recurrence = freq === "DAILY" ? "daily" : freq === "WEEKLY" ? "weekly" : freq === "MONTHLY" ? "monthly" : "";
  let until = "";
  if (parts.UNTIL) {
    const dt = parseDt(String(parts.UNTIL), {});
    if (dt) { const p = phParts(dt.ms); until = `${p.y}-${pad(p.mo)}-${pad(p.d)}`; }
  }
  return { recurrence, until };
}

/** Parse an .ics document into a list of importable events. */
export function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text);
  const events: IcsEvent[] = [];
  let cur: Partial<{ summary: string; description: string; location: string; url: string; start: { ms: number; dateOnly: boolean }; end: { ms: number; dateOnly: boolean }; rrule: string }> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.summary && cur.start) {
        const s = phParts(cur.start.ms);
        const allDay = cur.start.dateOnly;
        const e = cur.end ? phParts(cur.end.ms) : null;
        const rr = cur.rrule ? rruleOf(cur.rrule) : { recurrence: "" as const, until: "" };
        events.push({
          title: cur.summary.slice(0, 200),
          details: cur.description ? cur.description.slice(0, 4000) : null,
          location: cur.location ?? null,
          url: cur.url ?? null,
          date: `${s.y}-${pad(s.mo)}-${pad(s.d)}`,
          allDay,
          startTime: allDay ? "" : `${pad(s.hh)}:${pad(s.mm)}`,
          endTime: allDay || !e ? "" : `${pad(e.hh)}:${pad(e.mm)}`,
          recurrence: rr.recurrence,
          recurrenceUntil: rr.until,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const prop = splitProp(line);
    if (!prop) continue;
    switch (prop.name) {
      case "SUMMARY": cur.summary = unescapeText(prop.value).trim(); break;
      case "DESCRIPTION": cur.description = unescapeText(prop.value).trim(); break;
      case "LOCATION": cur.location = unescapeText(prop.value).trim() || undefined; break;
      case "URL": cur.url = prop.value.trim() || undefined; break;
      case "DTSTART": { const dt = parseDt(prop.value, prop.params); if (dt) cur.start = dt; break; }
      case "DTEND": { const dt = parseDt(prop.value, prop.params); if (dt) cur.end = dt; break; }
      case "RRULE": cur.rrule = prop.value; break;
    }
  }
  return events;
}
