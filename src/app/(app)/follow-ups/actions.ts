"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { runFollowUps, type FollowUpRunResult } from "@/lib/follow-up-runner";

/**
 * Manually send follow-up emails to a hand-picked set of quotes — the warm-up
 * control. Admin only. Sends immediately to just the selected clients, ignoring
 * the daily scheduler's enabled / dry-run switches (still needs the Resend key +
 * sender configured). Each send is recorded so a nudge is never repeated.
 */
export async function sendSelectedFollowUpsAction(quoteIds: string[]): Promise<FollowUpRunResult> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Only an admin can send follow-ups.");
  const ids = z.array(z.string().min(1)).min(1).parse(quoteIds);
  const result = await runFollowUps({ live: true, onlyQuoteIds: ids, ignoreEnabledDryRun: true });
  revalidatePath("/follow-ups");
  return result;
}
