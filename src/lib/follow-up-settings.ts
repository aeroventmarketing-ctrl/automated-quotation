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
   * stay due for the next run. **0 = no limit** (send every due client this run).
   * Default 100.
   */
  maxPerRun: number;
  /**
   * Optional backlog-campaign start (ISO date). When set, every open sent quote
   * becomes due for its first nudge on/after this day (throttled by maxPerRun),
   * instead of only quotes that recently crossed a cadence day. Null = off.
   */
  campaignStartAt: string | null;
  /**
   * When the scheduler sends. "daily" = once a day at `sendHour` (Manila);
   * "interval" = every `intervalHours` hours. The hourly Vercel cron gates on
   * these (needs a plan that runs the cron hourly to honour anything but daily).
   */
  scheduleMode: "daily" | "interval";
  /** Hour of day (0–23, Asia/Manila) for the daily send. Default 9 (9 AM). */
  sendHour: number;
  /** Hours between sends for interval mode (1–24). Default 24. */
  intervalHours: number;
  /** Internal: when the scheduler last actually ran (ISO). Set by the cron. */
  lastRunAt: string | null;
  /**
   * SMS follow-up (Semaphore) — an independent channel that texts due clients who
   * have a phone number, on the same cadence as email but tracked separately.
   * Leaves the email flow untouched.
   */
  /** Master switch for automated SMS (default false). */
  smsEnabled: boolean;
  /** When true, compute + log but never text (default true — safe). */
  smsDryRun: boolean;
  /** Max texts sent in a single run (default 24, hard ceiling FOLLOW_UP_MAX_PER_RUN). */
  smsMaxPerRun: number;
  /** Per-nudge SMS messages (with {placeholders}), one per nudge like the emails.
   *  A blank entry falls back to that nudge's built-in default. */
  smsTemplates: string[];
}

/** Safe default emails-per-run when unset or invalid (0 = no limit is allowed). */
export const FOLLOW_UP_DEFAULT_PER_RUN = 100;
/** Hard ceiling on SMS per run — texts are billed per message, so this stays capped. */
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

  // Emails per run: 0 = no limit (send every due client this run); any positive
  // number throttles. No hard ceiling — an invalid value falls back to the safe
  // default, not unlimited.
  const rawPerRun = Math.floor(Number(input?.maxPerRun));
  const maxPerRun = Number.isFinite(rawPerRun) && rawPerRun >= 0 ? rawPerRun : FOLLOW_UP_DEFAULT_PER_RUN;

  const rawCampaign = input?.campaignStartAt;
  const campaignStartAt =
    typeof rawCampaign === "string" && !Number.isNaN(Date.parse(rawCampaign)) ? rawCampaign : null;

  const scheduleMode = input?.scheduleMode === "interval" ? "interval" : "daily";
  const rawHour = Math.floor(Number(input?.sendHour));
  const sendHour = Number.isFinite(rawHour) && rawHour >= 0 && rawHour <= 23 ? rawHour : 9;
  const rawInterval = Math.floor(Number(input?.intervalHours));
  const intervalHours = Number.isFinite(rawInterval) && rawInterval >= 1 && rawInterval <= 24 ? rawInterval : 24;
  const rawLastRun = input?.lastRunAt;
  const lastRunAt = typeof rawLastRun === "string" && !Number.isNaN(Date.parse(rawLastRun)) ? rawLastRun : null;

  const rawSmsPerRun = Math.floor(Number(input?.smsMaxPerRun));
  const wantSmsPerRun = Number.isFinite(rawSmsPerRun) && rawSmsPerRun >= 1 ? rawSmsPerRun : 24;
  const smsMaxPerRun = Math.min(wantSmsPerRun, FOLLOW_UP_MAX_PER_RUN);
  // Per-nudge SMS messages. Migrate a legacy single `smsTemplate` string into the
  // first slot so nothing an admin already typed is lost.
  const legacySms = (input as { smsTemplate?: unknown } | null | undefined)?.smsTemplate;
  const smsTemplates = Array.isArray(input?.smsTemplates)
    ? input!.smsTemplates.map((t) => (typeof t === "string" ? t : ""))
    : typeof legacySms === "string" && legacySms.trim()
      ? [legacySms]
      : [];

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
    scheduleMode,
    sendHour,
    intervalHours,
    lastRunAt,
    smsEnabled: input?.smsEnabled === true, // default OFF
    smsDryRun: input?.smsDryRun !== false, // default ON (safe)
    smsMaxPerRun,
    smsTemplates,
  };
}

const MANILA_OFFSET_MS = 8 * 3_600_000; // Asia/Manila is UTC+8, no DST.

/** 12-hour label for an hour-of-day, e.g. 9 → "9:00 AM", 13 → "1:00 PM". */
export function hourLabel(h: number): string {
  const hr = ((h % 24) + 24) % 24;
  const ampm = hr < 12 ? "AM" : "PM";
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${h12}:00 ${ampm}`;
}

/** Human description of when the scheduler sends (for the UI + banners). */
export function scheduleLabel(s: FollowUpConfig): string {
  return s.scheduleMode === "interval"
    ? `every ${s.intervalHours} hour${s.intervalHours === 1 ? "" : "s"}`
    : `daily at ${hourLabel(s.sendHour)} (Manila)`;
}

/**
 * Should the hourly scheduler actually run right now? Gates on the configured
 * schedule + last run so the cron can fire hourly but only send on cadence.
 */
export function shouldRunScheduler(s: FollowUpConfig, now: Date): { run: boolean; reason: string } {
  const lastRun = s.lastRunAt ? new Date(s.lastRunAt) : null;
  if (s.scheduleMode === "interval") {
    const elapsedH = lastRun ? (now.getTime() - lastRun.getTime()) / 3_600_000 : Infinity;
    if (elapsedH >= s.intervalHours - 0.02) return { run: true, reason: `every ${s.intervalHours}h — due` };
    return { run: false, reason: `every ${s.intervalHours}h — ${Math.max(0, s.intervalHours - elapsedH).toFixed(1)}h to go` };
  }
  // daily at sendHour (Manila), at most once per Manila day
  const manila = new Date(now.getTime() + MANILA_OFFSET_MS);
  const manilaHour = manila.getUTCHours();
  const manilaDate = manila.toISOString().slice(0, 10);
  const lastManilaDate = lastRun ? new Date(lastRun.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10) : null;
  if (lastManilaDate === manilaDate) return { run: false, reason: "already ran today" };
  if (manilaHour < s.sendHour) return { run: false, reason: `before ${hourLabel(s.sendHour)} Manila` };
  return { run: true, reason: `daily ${hourLabel(s.sendHour)} reached` };
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
