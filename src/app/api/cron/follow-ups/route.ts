/**
 * Daily follow-up scheduler endpoint, triggered by Vercel Cron (see vercel.json).
 *
 * Auth: requires the CRON_SECRET as `Authorization: Bearer <secret>` (Vercel Cron
 * sends this automatically when CRON_SECRET is set) or `?key=<secret>`. When
 * CRON_SECRET is unset the endpoint refuses to run, so it can never be triggered
 * anonymously. It asks the runner for a live send; the runner still enforces the
 * enabled + dry-run + key guards, so nothing goes out until an admin turns it on.
 */
import { NextRequest, NextResponse } from "next/server";
import { runFollowUps } from "@/lib/follow-up-runner";

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
    const result = await runFollowUps({ live: true });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Follow-up run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
