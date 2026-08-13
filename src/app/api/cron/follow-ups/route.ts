/**
 * Follow-up scheduler endpoint, triggered hourly by Vercel Cron (see vercel.json).
 *
 * Auth: requires the CRON_SECRET as `Authorization: Bearer <secret>` (Vercel Cron
 * sends this automatically when CRON_SECRET is set) or `?key=<secret>`. When
 * CRON_SECRET is unset the endpoint refuses to run, so it can never be triggered
 * anonymously.
 *
 * The cron fires every hour, but sending is gated by the admin's chosen schedule
 * (daily at a set hour, or every N hours) via `shouldRunScheduler` + a stored
 * `lastRunAt`. Add `?force=1` to bypass the schedule gate for a manual run. The
 * runner still enforces the enabled + dry-run + key guards on top of this.
 */
import { NextRequest, NextResponse } from "next/server";
import { runFollowUps } from "@/lib/follow-up-runner";
import { runMarketingRecurring, runScheduledCampaigns, runAbTests } from "@/lib/marketing-runner";
import { getFollowUpSettings, setFollowUpSettings, shouldRunScheduler } from "@/lib/follow-up-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run unauthenticated
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("key") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const settings = await getFollowUpSettings();
    const now = new Date();
    const force = req.nextUrl.searchParams.get("force") === "1";
    // Scheduled campaigns + A/B test finalizers fire on their own timestamps, so
    // process them every hour — independent of the follow-up schedule gate below.
    const scheduled = await runScheduledCampaigns({ now, live: true });
    const abTests = await runAbTests({ now, live: true });
    const gate = shouldRunScheduler(settings, now);
    if (!force && !gate.run) {
      return NextResponse.json({ skipped: true, reason: gate.reason, schedule: settings.scheduleMode, scheduled, abTests });
    }
    const [followUps, marketing] = await Promise.all([
      runFollowUps({ live: true }),
      runMarketingRecurring({ live: true }),
    ]);
    // Stamp the run so the schedule gate advances (merge to preserve other fields).
    await setFollowUpSettings({ ...settings, lastRunAt: now.toISOString() });
    return NextResponse.json({ ran: true, forced: force, reason: gate.reason, followUps, marketing, scheduled, abTests });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Follow-up run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
