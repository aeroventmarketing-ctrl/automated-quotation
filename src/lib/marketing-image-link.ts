/**
 * Public marketing-image link.
 *
 * Campaign emails must load their images from our own (sending) domain rather
 * than raw Supabase Storage URLs: mail providers — notably Gmail — treat images
 * hosted off the sending domain as a mild spam signal (Resend flags this under
 * "Host images on the sending domain"). So instead of embedding a long-lived
 * Supabase signed URL, we embed {appUrl}/api/marketing-image?p=<path>&t=<token>,
 * an HMAC of the storage path under a server secret (same scheme as the RFQ /
 * unsubscribe links). The public route verifies the token and 302-redirects to a
 * freshly-signed URL — so the raw signed URL never appears in the email and the
 * images load from our own domain (a subdomain of the sending domain).
 *
 * The token and path go in the URL *path* (…/api/marketing-image/<token>/<path>),
 * not the query string: an `&` between query params gets HTML-escaped to `&amp;`
 * in the email body, which mail clients then mis-parse (the token param arrives as
 * `amp;t`), so the token would be dropped and every image 404s. A path URL has no
 * `&` to escape.
 */
import { createHmac } from "crypto";
import { config } from "@/lib/config";

/** The public base path the marketing image proxy lives at. */
export const MARKETING_IMAGE_PATH = "/api/marketing-image";

function secret(): string {
  return process.env.CRON_SECRET || process.env.RESEND_API_KEY || "afbm-marketing-image";
}

/** The access token for a stored marketing image path. */
export function marketingImageToken(path: string): string {
  return createHmac("sha256", secret()).update(`img:${path}`).digest("hex").slice(0, 32);
}

/** Constant-time-ish check that a token matches an image path. */
export function verifyMarketingImageToken(path: string, token: string): boolean {
  if (!path || !token) return false;
  const expected = marketingImageToken(path);
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/**
 * The absolute, on-our-domain URL a mail client loads to fetch a stored
 * marketing image: …/api/marketing-image/<token>/<path> (path segments, no query
 * string — see the note above). Redirects to a short-lived signed Supabase URL at
 * fetch time; the token is permanent, so the link keeps working for emails opened
 * weeks later.
 */
export function marketingImageUrl(path: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${base}${MARKETING_IMAGE_PATH}/${marketingImageToken(path)}/${encodedPath}`;
}
