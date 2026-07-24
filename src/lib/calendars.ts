/**
 * Named calendars for the Team Calendar (TimeTree-style multiple calendars).
 * Each event may belong to a named calendar; viewers can toggle calendars on/off.
 * Stored as a simple list in the AppSetting key/value table (no migration).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const CALENDARS_KEY = "calendars";
export const DEFAULT_CALENDAR = "General";

const clean = (s: string) => s.trim().slice(0, 40);

/** The named calendars, always including the default "General". */
export async function getCalendars(): Promise<string[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: CALENDARS_KEY } });
  const raw = (row?.value as { names?: unknown } | null)?.names;
  const names = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.trim() !== "").map(clean) : [];
  const set = [DEFAULT_CALENDAR, ...names];
  return [...new Map(set.map((n) => [n.toLowerCase(), n])).values()];
}

async function writeCalendars(names: string[]): Promise<void> {
  const list = [...new Map(names.map((n) => [clean(n).toLowerCase(), clean(n)])).values()].filter((n) => n && n.toLowerCase() !== DEFAULT_CALENDAR.toLowerCase());
  await prisma.appSetting.upsert({
    where: { key: CALENDARS_KEY },
    create: { key: CALENDARS_KEY, value: { names: list } as Prisma.InputJsonValue },
    update: { value: { names: list } as Prisma.InputJsonValue },
  });
}

export async function addCalendar(name: string): Promise<string[]> {
  const n = clean(name);
  if (!n) throw new Error("Enter a calendar name.");
  const cur = await getCalendars();
  await writeCalendars([...cur, n]);
  return getCalendars();
}

export async function removeCalendar(name: string): Promise<string[]> {
  const n = clean(name);
  if (n.toLowerCase() === DEFAULT_CALENDAR.toLowerCase()) throw new Error("The default calendar can't be removed.");
  const cur = await getCalendars();
  await writeCalendars(cur.filter((c) => c.toLowerCase() !== n.toLowerCase()));
  return getCalendars();
}

/** Normalise an event's calendar to a known one (default when blank/unknown). */
export function normalizeCalendar(value: string | null | undefined, known: string[]): string {
  const v = (value ?? "").trim();
  const hit = known.find((k) => k.toLowerCase() === v.toLowerCase());
  return hit ?? DEFAULT_CALENDAR;
}
