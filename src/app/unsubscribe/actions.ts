"use server";

import { redirect } from "next/navigation";
import { updateAccountsRegistry } from "@/lib/account";
import { verifyUnsubscribe } from "@/lib/marketing-unsubscribe";

/**
 * Public (no-auth) opt-out. Guarded solely by the HMAC token in the link, so only
 * the emailed recipient can opt their own client record out. Sets the same
 * `optOutFollowUp` flag that campaigns and automated follow-ups already honour.
 */
export async function confirmUnsubscribe(formData: FormData): Promise<void> {
  const c = String(formData.get("c") ?? "");
  const t = String(formData.get("t") ?? "");
  if (!verifyUnsubscribe(c, t)) redirect(`/unsubscribe?c=${encodeURIComponent(c)}&t=${encodeURIComponent(t)}&error=1`);

  // One client's flag, onto whatever the registry says at this moment. A client
  // clicking unsubscribe mid-send must not be erased by the run that mailed
  // them, and must not erase its record either.
  await updateAccountsRegistry((accounts) => {
    const existing = accounts[c];
    accounts[c] = { ...existing, history: existing?.history ?? [], optOutFollowUp: true };
  });

  redirect(`/unsubscribe?c=${encodeURIComponent(c)}&t=${encodeURIComponent(t)}&done=1`);
}
