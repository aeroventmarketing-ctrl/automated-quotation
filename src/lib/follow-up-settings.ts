/**
 * Admin-configurable follow-up config: the cadence (days after send + max nudges)
 * plus the delivery switches. Stored in the AppSetting key/value table (no
 * migration), read by the follow-up engine, the "Follow-ups due" page, and the
 * scheduler. Falls back to safe defaults when unset.
 *
 * Delivery is OFF and in DRY-RUN by default: automated emails only go out once an
 * admin both enables sending AND turns off dry-run (and a Resend key is present).
 * All input is normalized so a bad value can never break the engine.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FOLLOW_UP_DEFAULTS, type FollowUpSettings } from "@/lib/follow-up";

export const FOLLOW_UP_SETTINGS_KEY = "follow_up_settings";

export interface FollowUpConfig extends FollowUpSettings {
  /** Master switch for automated sending (default false). */
  enabled: boolean;
  /** When true, compute + log but never send (default true). */
  dryRun: boolean;
}

export function normalizeFollowUpConfig(
  input: Partial<FollowUpConfig> | null | undefined,
): FollowUpConfig {
  const rawOffsets = Array.isArray(input?.offsetsDays) ? input!.offsetsDays : [];
  const cleaned = Array.from(
    new Set(rawOffsets.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0)),
  ).sort((a, b) => a - b);
  const offsetsDays = cleaned.length ? cleaned : [...FOLLOW_UP_DEFAULTS.offsetsDays];

  const rawMax = Math.floor(Number(input?.maxNudges));
  const wantMax = Number.isFinite(rawMax) && rawMax >= 1 ? rawMax : FOLLOW_UP_DEFAULTS.maxNudges;
  const maxNudges = Math.min(wantMax, offsetsDays.length);

  return {
    offsetsDays,
    maxNudges,
    enabled: input?.enabled === true, // default OFF
    dryRun: input?.dryRun !== false, // default ON (safe)
  };
}

/** The active follow-up config (defaults when never configured). */
export async function getFollowUpSettings(): Promise<FollowUpConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: FOLLOW_UP_SETTINGS_KEY } });
  return normalizeFollowUpConfig(row?.value as Partial<FollowUpConfig> | null);
}

/** Persist the follow-up config (returns the normalized value that was stored). */
export async function setFollowUpSettings(input: Partial<FollowUpConfig>): Promise<FollowUpConfig> {
  const d = normalizeFollowUpConfig(input);
  await prisma.appSetting.upsert({
    where: { key: FOLLOW_UP_SETTINGS_KEY },
    create: { key: FOLLOW_UP_SETTINGS_KEY, value: d as unknown as Prisma.InputJsonValue },
    update: { value: d as unknown as Prisma.InputJsonValue },
  });
  return d;
}
