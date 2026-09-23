import { NextRequest, NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
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
  /**
   * `hasSession`, not `getCurrentUser` — this route never read the user.
   *
   * It asked for one purely to null-check it, and paid for five `auth` queries,
   * a `User` row and a transaction round trip to do so. On the busiest endpoint
   * in the app, polled every eight seconds by every open tab, that was most of
   * the 34% of all database calls that auth accounted for.
   *
   * "Signed in" is the right bar: the answer is a row count and a timestamp, as
   * the note above says, so WHO is asking has never changed it.
   */
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope");
  /**
   * The one record the page is showing, for a scope built around one — the order
   * page sends its order id, so it watches that row instead of every order.
   *
   * Length-capped rather than validated: it reaches Prisma only as a `where`
   * value, never as SQL, and a scope that does not want a key ignores it. The cap
   * is there so a long query string cannot be used to make the server do work.
   */
  const raw = req.nextUrl.searchParams.get("id");
  const key = raw && raw.length <= 64 ? raw : undefined;
  // An unknown scope answers UNKNOWN rather than erroring: a client asking for a
  // scope this deployment has not got should fall back to its timer, not break.
  const v = isChangeScope(scope) ? await changeToken(scope, key) : UNKNOWN_TOKEN;

  return NextResponse.json({ v }, { headers: { "Cache-Control": "no-store" } });
}
