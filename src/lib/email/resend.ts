/**
 * Minimal Resend email sender over the HTTP API (no SDK dependency, works through
 * the outbound proxy). Only used by the automated follow-up scheduler when live
 * sending is enabled. If RESEND_API_KEY is unset, sending is simply unavailable
 * and the scheduler stays in dry-run.
 */

export interface SendEmailAttachment {
  filename: string;
  content: string; // base64-encoded file content
}
export interface SendEmailInput {
  from: string; // "Name <address@your-domain>"
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: SendEmailAttachment[];
}

/** True when a Resend API key is configured (i.e. live sending is possible). */
export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/**
 * Split a recipient field into individual addresses. A single client record can
 * hold several emails in one field (e.g. "a@x.com ; b@y.com , c@z.com"); Resend's
 * `to` rejects such a string, so we split on ; , and newlines and keep the
 * address-looking tokens. A normal single address passes through unchanged.
 */
export function splitRecipients(raw: string): string[] {
  return raw
    .split(/[;,\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

/** Transient failures worth one more try — rate limiting and gateway blips. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one email via Resend. Throws on missing key or a non-2xx response.
 *
 * Rate limiting (HTTP 429) and transient 5xx are retried with a short backoff —
 * the scheduler sends several emails concurrently, so an occasional 429 is
 * expected and should not lose the message. Waits honour `Retry-After` when
 * Resend sends it, and are capped so a run can't stall on retries.
 */
export async function sendEmail(input: SendEmailInput, opts: { retries?: number } = {}): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");

  // A recipient field may hold several addresses in one string (e.g.
  // "a@x.com ; b@y.com"). Split them so Resend gets a valid address array.
  const to = splitRecipients(input.to);
  if (to.length === 0) throw new Error(`No valid recipient address in "${input.to}"`);

  const maxAttempts = Math.max(1, (opts.retries ?? 2) + 1);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { id: data.id ?? "" };
    }

    const body = await res.text().catch(() => "");
    if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 2000) : 300 * 2 ** (attempt - 1);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}
