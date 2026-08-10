/**
 * Minimal Semaphore SMS sender over the HTTP API (semaphore.co, a Philippine SMS
 * gateway). No SDK dependency, works through the outbound proxy. Only used by the
 * automated follow-up scheduler when live SMS sending is enabled. If
 * SEMAPHORE_API_KEY is unset, SMS is simply unavailable and the scheduler stays
 * in dry-run for the SMS channel.
 */
import { config } from "@/lib/config";

const API_BASE = "https://api.semaphore.co/api/v4";

/** True when a Semaphore API key is configured (i.e. live SMS is possible). */
export function smsConfigured(): boolean {
  return !!process.env.SEMAPHORE_API_KEY;
}

/**
 * Normalize a raw phone string to a Philippine mobile in local 11-digit form
 * (`09XXXXXXXXX`) — the format Semaphore accepts. Handles +63 / 63 / 9-prefixed
 * inputs and strips spaces, dashes and parentheses. Returns null when the input
 * is not a valid PH mobile number (landlines, garbage, empty).
 */
export function normalizePhMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("63") && d.length === 12) d = "0" + d.slice(2); // 639XXXXXXXXX → 09XXXXXXXXX
  else if (d.startsWith("9") && d.length === 10) d = "0" + d; // 9XXXXXXXXX → 09XXXXXXXXX
  return /^09\d{9}$/.test(d) ? d : null;
}

export interface SendSmsInput {
  to: string; // one PH mobile (09XXXXXXXXX) — normalize with normalizePhMobile first
  message: string;
}

/**
 * Send one SMS via Semaphore. Throws on missing key or a non-2xx / error
 * response. Returns the first message id Semaphore assigns.
 */
export async function sendSms(input: SendSmsInput): Promise<{ id: string }> {
  const key = process.env.SEMAPHORE_API_KEY;
  if (!key) throw new Error("SEMAPHORE_API_KEY is not set");

  const body = new URLSearchParams({ apikey: key, number: input.to, message: input.message });
  if (config.semaphoreSenderName) body.set("sendername", config.semaphoreSenderName);

  const res = await fetch(`${API_BASE}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const raw = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Semaphore ${res.status}: ${raw.slice(0, 300)}`);

  // Success is a JSON array of queued messages; an object with error keys means
  // a validation failure (bad number, unregistered sender, no credits, …).
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Semaphore: unexpected response ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    const msg = typeof parsed === "object" && parsed ? JSON.stringify(parsed).slice(0, 300) : String(parsed);
    throw new Error(`Semaphore error: ${msg}`);
  }
  const first = parsed[0] as { message_id?: number | string } | undefined;
  return { id: first?.message_id != null ? String(first.message_id) : "" };
}

/**
 * The Semaphore account's remaining SMS credit balance (and account name), for
 * display in Admin. Returns null when unconfigured or the call fails, so the UI
 * can degrade quietly.
 */
export async function getSemaphoreBalance(): Promise<{ balance: number; accountName: string } | null> {
  const key = process.env.SEMAPHORE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${API_BASE}/account?apikey=${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { credit_balance?: number | string; account_name?: string };
    const balance = Number(data.credit_balance);
    return { balance: Number.isFinite(balance) ? balance : 0, accountName: data.account_name ?? "" };
  } catch {
    return null;
  }
}
