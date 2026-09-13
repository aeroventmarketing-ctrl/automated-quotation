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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const dbUser = await prisma.user.findUnique({
    where: { email: user.email.toLowerCase() },
  });
  return dbUser;
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
