import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { changeToken, isChangeScope, UNKNOWN_TOKEN } from "@/lib/change-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Has anything changed?" — the cheapest question in the app.
 *
 * `AutoRefresh` polls this instead of re-rendering its page on a timer. The
 * answer is a few dozen bytes; the page it saves re-running was megabytes. See
 * `lib/change-token` for why the token is shaped the way it is.
 *
 * Signed-in only, but no role gate: the token is a row count and a timestamp —
 * it discloses nothing a viewer could not learn by looking at the page they are
 * already on, and gating it per role would mean maintaining a second copy of
 * every page's permissions here.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope");
  // An unknown scope answers UNKNOWN rather than erroring: a client asking for a
  // scope this deployment has not got should fall back to its timer, not break.
  const v = isChangeScope(scope) ? await changeToken(scope) : UNKNOWN_TOKEN;

  return NextResponse.json({ v }, { headers: { "Cache-Control": "no-store" } });
}
