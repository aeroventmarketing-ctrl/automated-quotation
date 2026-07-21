/**
 * Short-lived signed token that unlocks the admin-password-gated RFQ AI import.
 * An admin enters their credentials; on success the server sets this token as an
 * httpOnly cookie, and the /api/ai/extract endpoint honours it (so a non-admin
 * can use the panel once an admin has unlocked it). HMAC-signed with a server
 * secret and expiring, so it can't be forged or replayed indefinitely.
 */
import crypto from "crypto";

export const RFQ_UNLOCK_COOKIE = "rfq_ai_unlock";
export const RFQ_UNLOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

function secret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET || "rfq-ai-unlock-fallback";
}
function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** A fresh unlock token (expiry + signature). */
export function makeUnlockToken(): string {
  const exp = String(Date.now() + RFQ_UNLOCK_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

/** True if the token is well-formed, correctly signed, and not expired. */
export function isUnlockTokenValid(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(exp);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expMs = Number(exp);
  return Number.isFinite(expMs) && expMs > Date.now();
}
