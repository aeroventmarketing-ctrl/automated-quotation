import { createClient } from "./supabase/server";
import { prisma } from "./db";
import type { Role, User } from "@prisma/client";

/**
 * Resolve the currently authenticated app user (joins the Supabase Auth
 * session to our `User` table by email). Returns null when unauthenticated.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const dbUser = await prisma.user.findUnique({
    where: { email: user.email.toLowerCase() },
  });
  return dbUser;
}

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
