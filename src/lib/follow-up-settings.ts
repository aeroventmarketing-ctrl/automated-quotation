/**
 * Admin-configurable follow-up cadence. Stored in the AppSetting key/value table
 * (no migration), read by the follow-up engine and the "Follow-ups due" page.
 * Falls back to FOLLOW_UP_DEFAULTS when unset. All input is normalized so a bad
 * value can never break the engine (offsets: positive, deduped, ascending;
 * maxNudges: at least 1 and never more than the number of cadence days).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FOLLOW_UP_DEFAULTS, type FollowUpSettings } from "@/lib/follow-up";

export const FOLLOW_UP_SETTINGS_KEY = "follow_up_settings";

export function normalizeFollowUpSettings(
  input: Partial<FollowUpSettings> | null | undefined,
): FollowUpSettings {
  const rawOffsets = Array.isArray(input?.offsetsDays) ? input!.offsetsDays : [];
  const cleaned = Array.from(
    new Set(rawOffsets.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0)),
  ).sort((a, b) => a - b);
  const offsetsDays = cleaned.length ? cleaned : [...FOLLOW_UP_DEFAULTS.offsetsDays];

  const rawMax = Math.floor(Number(input?.maxNudges));
  const wantMax = Number.isFinite(rawMax) && rawMax >= 1 ? rawMax : FOLLOW_UP_DEFAULTS.maxNudges;
  const maxNudges = Math.min(wantMax, offsetsDays.length);

  return { offsetsDays, maxNudges };
}

/** The active follow-up cadence (defaults when never configured). */
export async function getFollowUpSettings(): Promise<FollowUpSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: FOLLOW_UP_SETTINGS_KEY } });
  return normalizeFollowUpSettings(row?.value as Partial<FollowUpSettings> | null);
}

/** Persist the follow-up cadence (returns the normalized value that was stored). */
export async function setFollowUpSettings(input: Partial<FollowUpSettings>): Promise<FollowUpSettings> {
  const d = normalizeFollowUpSettings(input);
  await prisma.appSetting.upsert({
    where: { key: FOLLOW_UP_SETTINGS_KEY },
    create: { key: FOLLOW_UP_SETTINGS_KEY, value: d as unknown as Prisma.InputJsonValue },
    update: { value: d as unknown as Prisma.InputJsonValue },
  });
  return d;
}
