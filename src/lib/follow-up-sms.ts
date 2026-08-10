/**
 * Content of an automated follow-up SMS — a single short, plain-text message.
 * Pure and testable; no I/O. SMS is deliberately one editable template (not one
 * per nudge like email) because a text should stay short: Semaphore bills one
 * credit per 160-character segment, so brevity is cost. The same {placeholders}
 * as the email templates are supported.
 */

/** Placeholders an admin may drop into the follow-up SMS message. */
export const FOLLOWUP_SMS_PLACEHOLDERS = [
  "{contactName}",
  "{company}",
  "{quoteNumber}",
  "{total}",
  "{salesName}",
  "{quoteUrl}",
] as const;

/**
 * Default SMS copy per nudge — a gentle escalation (reminder → helpful → final
 * courtesy), each kept concise so it fits one 160-char segment. The quote link is
 * intentionally left out of the defaults (a long URL pushes the message onto a
 * second billed segment); an admin can add {quoteUrl} to any nudge. Used when the
 * admin hasn't customized a given nudge.
 */
export const DEFAULT_FOLLOWUP_SMS_TEMPLATES: string[] = [
  "Hi {contactName}, this is {salesName} of Aerovent FBM following up on quotation {quoteNumber} ({total}). Reply here if you'd like to proceed or have any questions. Thank you!",
  "Hi {contactName}, just checking in on your Aerovent quotation {quoteNumber} ({total}). We'd gladly adjust the scope or specs to fit your project - reply anytime. - {salesName}",
  "Hi {contactName}, a final reminder on quotation {quoteNumber} ({total}) before it expires. Reply to proceed or with any questions and we'll take care of it. - {salesName}, Aerovent FBM",
];

/** The first default, kept as a named export for the single-message fallback. */
export const DEFAULT_FOLLOWUP_SMS = DEFAULT_FOLLOWUP_SMS_TEMPLATES[0];

/** The message for a given nudge (1-based). Falls back to the last, then default. */
export function smsTemplateForNudge(templates: string[], nudgeNumber: number): string {
  const list = templates.filter((t) => typeof t === "string");
  const idx = Math.max(1, Math.floor(nudgeNumber || 1)) - 1;
  const pick = list[idx] ?? list[list.length - 1] ?? "";
  return pick.trim() ? pick : (DEFAULT_FOLLOWUP_SMS_TEMPLATES[idx] ?? DEFAULT_FOLLOWUP_SMS);
}

import { firstNameOf } from "@/lib/follow-up-email";

export interface FollowUpSmsInput {
  company: string;
  contactName: string | null;
  quoteNumber: string;
  total: string; // already formatted (e.g. "₱125,000.00")
  salesName: string;
  quoteUrl: string;
  /** The admin-edited message, or the default when blank. */
  template?: string;
}

/**
 * Just the quote-number CODE from a (possibly free-text) quote number, e.g.
 * "2026 - AFBM00002982K - Paintplas - Proposed LIMA Plant" → "2026 - AFBM00002982K".
 * The quote-number field is editable, and staff sometimes append the project name;
 * for SMS we strip that so the message length (and Semaphore segment count) stays
 * predictable. Falls back to the whole trimmed string when no code is recognized.
 */
export function shortQuoteNumber(quoteNumber: string): string {
  const m = quoteNumber.match(/(\d{4})\s*-\s*([A-Za-z]+\d+[A-Za-z]?)/);
  return m ? `${m[1]} - ${m[2]}` : quoteNumber.trim();
}

/** Substitute {placeholders}; known-but-empty → "", unknown left as typed. */
function applyTokens(s: string, tokens: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in tokens ? tokens[k] : `{${k}}`));
}

/** Build the final SMS text for one follow-up. Collapses stray whitespace. */
export function buildFollowUpSms(i: FollowUpSmsInput): string {
  const tokens: Record<string, string> = {
    contactName: i.contactName?.trim() ? firstNameOf(i.contactName) : i.company,
    company: i.company,
    quoteNumber: shortQuoteNumber(i.quoteNumber),
    total: i.total,
    salesName: i.salesName,
    quoteUrl: i.quoteUrl,
  };
  const tpl = (i.template ?? "").trim() || DEFAULT_FOLLOWUP_SMS;
  return applyTokens(tpl, tokens).replace(/[ \t]+/g, " ").trim();
}

/** Segments Semaphore will bill for a message (160 chars each, min 1). */
export function smsSegments(message: string): number {
  return Math.max(1, Math.ceil(message.length / 160));
}
