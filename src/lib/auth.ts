import { cache } from "react";
import { createClient } from "./supabase/server";
import { prisma } from "./db";
import type { Role, User } from "@prisma/client";

/**
 * Resolve the currently authenticated app user (joins the Supabase Auth
 * session to our `User` table by email). Returns null when unauthenticated.
 *
 * **Memoised for one request**, and this is the cheapest large saving in the
 * app. Answering "who is this?" costs SIX queries: `supabase.auth.getUser()`
 * makes GoTrue read `sessions`, `users`, `identities`, `mfa_factors` and
 * `mfa_amr_claims`, and then this reads our own `User` row. There are 293 call
 * sites — a layout, its page, several components and any action it triggers all
 * ask independently — so a single render asked three to five times over.
 *
 * Measured on 12 September: **111,448 auth validations in 33 hours**, about
 * 81,000 a day, for ~7.8 GB of buffer traffic.
 *
 * Safe against the read-then-write trap that `buildCommissionsFresh` exists for.
 * The only write near a user's identity is `upsertUser`, which authenticates the
 * ADMIN first and then edits somebody else's record; the list that page renders
 * is read fresh from `prisma.user.findMany` either way. An admin editing their
 * OWN role would see it take effect on their next navigation rather than in the
 * action's re-render, which is the safer direction — nobody locks themselves out
 * halfway through their own request.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<User | null> {
  const email = await sessionEmail();
  if (!email) return null;

  const dbUser = await prisma.user.findUnique({ where: { email } });
  return dbUser;
});

/**
 * The signed-in user's email, from the JWT — verified, not merely decoded.
 *
 * ## Why this is not `getUser()`
 *
 * `supabase.auth.getUser()` sends the token to the Auth server on **every
 * call**, and the Auth server answers by reading five tables in this same
 * database: `sessions`, `users`, `identities`, `mfa_factors`, `mfa_amr_claims`.
 *
 * Measured on 23 September over 4.7 days: **421,580 validations, 2.1 million
 * queries — 34% of every database call the system made.** The app's own data
 * queries were 20%. Two places asked on each request (this and the middleware),
 * and `/api/changes` polling every eight seconds per open tab drove most of it.
 *
 * `getClaims()` verifies the JWT's signature **locally** with WebCrypto against
 * the project's JWKS, which is cached — no round trip, no queries. It is a safe
 * swap rather than a gamble: if the project still signs with a symmetric secret,
 * `getClaims()` falls back to exactly the server call `getUser()` makes, so the
 * worst case is today's behaviour.
 *
 * ## The trade-off, stated plainly
 *
 * A locally-verified token is trusted until it EXPIRES. Revoking a session in
 * Supabase Auth no longer takes effect instantly — it takes effect within the
 * access token's lifetime (one hour by default).
 *
 * That is acceptable here because Supabase Auth is not this app's gate: every
 * request still looks up the `User` row by email, so deleting or disabling
 * somebody in AeroERP locks them out on their very next request, as it always
 * did. The window applies only to a ban applied in the Supabase dashboard while
 * the app's own record is left in place.
 */
async function sessionEmail(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const email = data.claims?.email;
  return typeof email === "string" && email ? email.toLowerCase() : null;
}

/**
 * Is there a valid session? — without loading who it belongs to.
 *
 * For routes that need "signed in" and nothing else. `/api/changes` is the whole
 * reason this exists: it is the busiest endpoint in the app, it asked
 * `getCurrentUser()` purely to null-check it, and it never read the user it was
 * given — paying five auth queries, a `User` row and a transaction round trip,
 * every eight seconds, per open tab.
 */
export const hasSession = cache(async function hasSession(): Promise<boolean> {
  return (await sessionEmail()) !== null;
});

export function hasRole(user: User | null, ...roles: Role[]): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}

export function canApprove(user: User | null): boolean {
  return hasRole(user, "ENGINEER", "ADMIN");
}

export function isAdmin(user: User | null): boolean {
  return hasRole(user, "ADMIN");
}
