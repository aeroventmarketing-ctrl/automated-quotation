/**
 * Public "Request a Quotation / upload your RFQ" link.
 *
 * The marketing CTA can point at the public {appUrl}/rfq page. When it does, each
 * emailed recipient's link carries ?c=<customerId>&t=<token> — an HMAC of the
 * customer id under a server secret (same scheme as the unsubscribe link) — so the
 * public form can pre-fill the client's company/email and attribute the RFQ to
 * their existing client record, and the token can't be forged for another client.
 * The page and the /api/rfq handler work fine WITHOUT a token too (a blank form).
 */
import { createHmac } from "crypto";
import { config } from "@/lib/config";

/** The public path the RFQ intake form lives at. */
export const RFQ_PATH = "/rfq";

function secret(): string {
  return process.env.CRON_SECRET || process.env.RESEND_API_KEY || "afbm-rfq-prefill";
}

/** The prefill token for a customer id. */
export function rfqToken(customerId: string): string {
  return createHmac("sha256", secret()).update(`rfq:${customerId}`).digest("hex").slice(0, 32);
}

/** Constant-time-ish check that a token matches a customer id. */
export function verifyRfqToken(customerId: string, token: string): boolean {
  if (!customerId || !token) return false;
  const expected = rfqToken(customerId);
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/** The full RFQ URL for a customer (absolute, uses the app URL). */
export function rfqUrl(customerId: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}${RFQ_PATH}?c=${encodeURIComponent(customerId)}&t=${rfqToken(customerId)}`;
}

/**
 * If `url` points at our RFQ intake page (its path ends with /rfq), append the
 * recipient's prefill token so the form knows who it is. Any OTHER url is returned
 * unchanged — we never leak the customer id / token to an arbitrary external link.
 */
export function appendRfqPrefill(url: string, prefill?: { customerId: string; token: string }): string {
  if (!url || !prefill?.customerId) return url;
  // Parse against a base so relative CTA urls (e.g. "/rfq") also work.
  let u: URL;
  try {
    u = new URL(url, config.appUrl);
  } catch {
    return url;
  }
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  if (path !== RFQ_PATH && !path.endsWith(RFQ_PATH)) return url;
  u.searchParams.set("c", prefill.customerId);
  u.searchParams.set("t", prefill.token);
  // Preserve a relative CTA as relative (don't force it onto the app origin).
  return /^https?:\/\//i.test(url) ? u.toString() : `${u.pathname}${u.search}`;
}
