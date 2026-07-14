/**
 * Minimal Resend email sender over the HTTP API (no SDK dependency, works through
 * the outbound proxy). Only used by the automated follow-up scheduler when live
 * sending is enabled. If RESEND_API_KEY is unset, sending is simply unavailable
 * and the scheduler stays in dry-run.
 */

export interface SendEmailInput {
  from: string; // "Name <address@your-domain>"
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

/** True when a Resend API key is configured (i.e. live sending is possible). */
export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** Send one email via Resend. Throws on missing key or a non-2xx response. */
export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: data.id ?? "" };
}
