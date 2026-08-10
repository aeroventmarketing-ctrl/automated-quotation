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
  /** Independent switch for "constant communication" emails to inquiry clients
   *  who have no quotation sent yet (default false). Shares the dry-run flag. */
  inquiryEnabled: boolean;
  /** Days between each inquiry-client nudge (default 30). */
  inquiryEveryDays: number;
  /** Hard cap on how many inquiry nudges a client will ever receive (default 6). */
  inquiryMaxNudges: number;
  /**
   * Max emails sent in a single run (across quote follow-ups + inquiry check-ins).
   * Lets you throttle for domain warm-up — set 24 to send 24 per run; the rest
   * stay due for the next run. Default 100 (also the hard ceiling).
   */
  maxPerRun: number;
  /**
   * Optional backlog-campaign start (ISO date). When set, every open sent quote
   * becomes due for its first nudge on/after this day (throttled by maxPerRun),
   * instead of only quotes that recently crossed a cadence day. Null = off.
   */
  campaignStartAt: string | null;
}

/** The hard ceiling on emails per run, regardless of the configured value. */
export const FOLLOW_UP_MAX_PER_RUN = 100;

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

  const rawEvery = Math.floor(Number(input?.inquiryEveryDays));
  const inquiryEveryDays = Number.isFinite(rawEvery) && rawEvery > 0 ? rawEvery : 30;
  const rawInqMax = Math.floor(Number(input?.inquiryMaxNudges));
  const inquiryMaxNudges = Number.isFinite(rawInqMax) && rawInqMax >= 1 ? rawInqMax : 6;

  const rawPerRun = Math.floor(Number(input?.maxPerRun));
  const wantPerRun = Number.isFinite(rawPerRun) && rawPerRun >= 1 ? rawPerRun : FOLLOW_UP_MAX_PER_RUN;
  const maxPerRun = Math.min(wantPerRun, FOLLOW_UP_MAX_PER_RUN);

  const rawCampaign = input?.campaignStartAt;
  const campaignStartAt =
    typeof rawCampaign === "string" && !Number.isNaN(Date.parse(rawCampaign)) ? rawCampaign : null;

  return {
    offsetsDays,
    maxNudges,
    enabled: input?.enabled === true, // default OFF
    dryRun: input?.dryRun !== false, // default ON (safe)
    inquiryEnabled: input?.inquiryEnabled === true, // default OFF
    inquiryEveryDays,
    inquiryMaxNudges,
    maxPerRun,
    campaignStartAt,
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
