/**
 * One-click unsubscribe for marketing emails. Each email carries a link
 *   {appUrl}/unsubscribe?c=<customerId>&t=<token>
 * where the token is an HMAC of the customer id under a server secret, so the
 * link can't be forged for an arbitrary client — only the emailed recipient can
 * opt themselves out. The public /unsubscribe page verifies the token and sets
 * the client's opt-out flag in the accounts registry (the same flag automated
 * follow-ups and campaigns already honour).
 */
import { createHmac } from "crypto";
import { config } from "@/lib/config";

// A stable server secret. CRON_SECRET is already a deployed secret; fall back to
// the Resend key, then a constant (links still work, just less unforgeable) so
// the feature degrades gracefully in local/dev without extra config.
function secret(): string {
  return process.env.CRON_SECRET || process.env.RESEND_API_KEY || "afbm-marketing-unsubscribe";
}

/** The unsubscribe token for a customer id. */
export function unsubscribeToken(customerId: string): string {
  return createHmac("sha256", secret()).update(`unsub:${customerId}`).digest("hex").slice(0, 32);
}

/** Constant-time-ish check that a token matches a customer id. */
export function verifyUnsubscribe(customerId: string, token: string): boolean {
  if (!customerId || !token) return false;
  const expected = unsubscribeToken(customerId);
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/** The full unsubscribe URL for a customer (absolute, uses the app URL). */
export function unsubscribeUrl(customerId: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}/unsubscribe?c=${encodeURIComponent(customerId)}&t=${unsubscribeToken(customerId)}`;
}
