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
 * Default SMS copy — a concise, personal nudge that fits one 160-char segment.
 * The quote link is intentionally left out of the default (a long URL pushes the
 * message onto a second billed segment); an admin can add {quoteUrl} if they want
 * to include it.
 */
export const DEFAULT_FOLLOWUP_SMS =
  "Hi {contactName}, this is {salesName} of Aerovent FBM following up on quotation {quoteNumber} ({total}). Reply here if you'd like to proceed or have any questions. Thank you!";

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

/** Substitute {placeholders}; known-but-empty → "", unknown left as typed. */
function applyTokens(s: string, tokens: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in tokens ? tokens[k] : `{${k}}`));
}

/** Build the final SMS text for one follow-up. Collapses stray whitespace. */
export function buildFollowUpSms(i: FollowUpSmsInput): string {
  const tokens: Record<string, string> = {
    contactName: i.contactName?.trim() || i.company,
    company: i.company,
    quoteNumber: i.quoteNumber,
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
