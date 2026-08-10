/**
 * Content of an automated follow-up email — subject + plain-text + HTML. Pure and
 * testable; no I/O. The tone is a warm B2B nudge that references the client's own
 * quotation, links to the shareable quote, and always offers an easy opt-out.
 */
import { COMPANY } from "@/lib/config";

export interface FollowUpEmailInput {
  company: string;
  contactName: string | null;
  quoteNumber: string;
  projectName: string | null;
  total: number;
  currency: string;
  validUntil: Date | null;
  quoteUrl: string;
  salesName: string;
  nudgeNumber: number;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

function money(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: 2 }).format(total);
  } catch {
    return `${currency} ${total.toLocaleString()}`;
  }
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(d);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Just the first name from a full contact name ("Juan Dela Cruz" → "Juan"), for a
 * friendlier greeting. Falls back to the whole trimmed string when there's no
 * space. Callers should still handle the empty case (blank name → use company).
 */
export function firstNameOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}

/**
 * Closing + signature used ONLY in the follow-up / check-in emails. Kept local
 * here (not the shared COMPANY constants, which drive the quotation PDF / XLSX)
 * so the email sign-off can differ from the formal quote documents.
 */
const EMAIL_CLOSING =
  "Thank you for giving Aerovent Fans and Blowers Manufacturing the opportunity to submit our proposal. We look forward to assisting you on this or any future project.";
const EMAIL_SIGNOFF = "Best regards,";
const EMAIL_COMPANY = "Aerovent Fans and Blowers Manufacturing";
const EMAIL_TAGLINE = "Engineering Superior Airflow Solutions";

/**
 * The shared HTML signature block (sign-off → name → company → tagline). Kept
 * deliberately plain — no colored buttons or heavy styling — so the email reads
 * like a personal note and lands in the Primary inbox rather than Promotions.
 */
const emailSignatureHtml = (salesName: string) =>
  `<p style="margin:0 0 12px">${esc(EMAIL_CLOSING)}</p>
  <p style="margin:0">${esc(EMAIL_SIGNOFF)}<br>${esc(salesName)}<br>${esc(EMAIL_COMPANY)}<br>${esc(EMAIL_TAGLINE)}</p>`;

/** The shared plain-text signature lines (sign-off → name → company → tagline). */
const emailSignatureText = (salesName: string) => [
  EMAIL_CLOSING,
  ``,
  EMAIL_SIGNOFF,
  salesName,
  EMAIL_COMPANY,
  EMAIL_TAGLINE,
];

export interface InquiryFollowUpInput {
  company: string;
  contactName: string | null;
  salesName: string;
  /** What the client originally enquired about, if recorded. */
  projectName: string | null;
}

/**
 * "Constant communication" email for a client who has an open inquiry but no
 * quotation sent yet — a warm check-in that keeps the relationship alive without
 * referencing a specific quote. Always offers an easy opt-out.
 */
export function buildInquiryFollowUpEmail(i: InquiryFollowUpInput): BuiltEmail {
  const greetingName = i.contactName?.trim() ? firstNameOf(i.contactName) : i.company;
  const about = i.projectName?.trim() ? ` regarding ${i.projectName.trim()}` : "";

  const subject = `Just checking in from ${COMPANY.name}`;

  const text = [
    `Dear ${greetingName},`,
    ``,
    `We wanted to check in and see how things are going${about}. We'd be glad to help you move forward whenever you're ready — whether that's preparing a quotation, answering technical questions, or discussing options for your project.`,
    ``,
    `If there's anything we can assist with, simply reply to this email and we'll get right back to you.`,
    ``,
    ...emailSignatureText(i.salesName),
    ``,
    `—`,
    `If you'd prefer not to receive these check-ins, just reply and let us know and we'll stop.`,
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">
  <p style="margin:0 0 12px">Dear ${esc(greetingName)},</p>
  <p style="margin:0 0 12px">We wanted to check in and see how things are going${about ? ` regarding ${esc(i.projectName!.trim())}` : ""}. We'd be glad to help you move forward whenever you're ready — whether that's preparing a quotation, answering technical questions, or discussing options for your project.</p>
  <p style="margin:0 0 12px">If there's anything we can assist with, simply reply to this email and we'll get right back to you.</p>
  ${emailSignatureHtml(i.salesName)}
  <p style="margin:16px 0 0;font-size:12px;color:#888">If you'd prefer not to receive these check-ins, just reply and let us know and we'll stop.</p>
</div>`;

  return { subject, text, html };
}

/**
 * A per-nudge message: the admin-editable subject + body for one follow-up in the
 * cadence (nudge 1, 2, 3 …). The branded shell — greeting, the "View your
 * quotation" button, the signature and the opt-out line — is added automatically
 * around this body, so every nudge keeps a consistent design while the wording
 * changes. Both fields may use the {placeholders} below.
 */
export interface FollowUpTemplate {
  subject: string;
  body: string;
}

/** Placeholders an admin may drop into a nudge's subject or body. */
export const FOLLOWUP_PLACEHOLDERS = [
  "{contactName}",
  "{company}",
  "{quoteNumber}",
  "{projectName}",
  "{total}",
  "{validUntil}",
  "{salesName}",
] as const;

/**
 * Default copy per nudge — a gentle escalation: friendly reminder → helpful /
 * value → courteous final nudge before the quote expires. Used when the admin
 * hasn't customized a given nudge.
 */
export const DEFAULT_FOLLOWUP_TEMPLATES: FollowUpTemplate[] = [
  {
    subject: "Following up on your quotation {quoteNumber}",
    body:
      "Dear {contactName},\n\n" +
      "Thank you for the opportunity to quote your requirement. We're following up on quotation {quoteNumber}, which we sent for your consideration.\n\n" +
      "Quoted amount: {total}.\n\n" +
      "If you have any questions or would like to make adjustments, simply reply to this email — we would be glad to assist.",
  },
  {
    subject: "Still here to help with quotation {quoteNumber}",
    body:
      "Dear {contactName},\n\n" +
      "We wanted to check in again on quotation {quoteNumber} ({total}). If the scope, specifications, or budget need adjusting, we'd be glad to revise it to fit your project.\n\n" +
      "Just reply with any questions — we're happy to help you move forward.",
  },
  {
    subject: "Your quotation {quoteNumber} — before it expires",
    body:
      "Dear {contactName},\n\n" +
      "A gentle final reminder on quotation {quoteNumber} ({total}). If you'd like to proceed or discuss options, simply reply and we'll take care of the rest.\n\n" +
      "We value the opportunity and would be glad to assist whenever you're ready.",
  },
];

/** The template for a given nudge (1-based). Falls back to the last available. */
export function templateForNudge(templates: FollowUpTemplate[], nudgeNumber: number): FollowUpTemplate {
  const list = templates.length ? templates : DEFAULT_FOLLOWUP_TEMPLATES;
  const idx = Math.max(1, Math.floor(nudgeNumber || 1)) - 1;
  return list[idx] ?? list[list.length - 1] ?? DEFAULT_FOLLOWUP_TEMPLATES[0];
}

/** Substitute {placeholders}; known-but-empty → "", unknown left as typed. */
function applyTokens(s: string, tokens: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in tokens ? tokens[k] : `{${k}}`));
}

export function buildFollowUpEmail(i: FollowUpEmailInput & { template?: FollowUpTemplate }): BuiltEmail {
  const tokens: Record<string, string> = {
    contactName: i.contactName?.trim() ? firstNameOf(i.contactName) : i.company,
    company: i.company,
    quoteNumber: i.quoteNumber,
    projectName: i.projectName?.trim() || "",
    total: money(i.total, i.currency),
    validUntil: i.validUntil ? fmtDate(i.validUntil) : "",
    salesName: i.salesName,
  };

  const tpl = i.template ?? templateForNudge(DEFAULT_FOLLOWUP_TEMPLATES, i.nudgeNumber);
  const subject =
    applyTokens(tpl.subject, tokens).trim() || applyTokens(DEFAULT_FOLLOWUP_TEMPLATES[0].subject, tokens);
  const bodyText =
    applyTokens(tpl.body, tokens).trim() || applyTokens(DEFAULT_FOLLOWUP_TEMPLATES[0].body, tokens);
  const paragraphs = bodyText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const text = [
    bodyText,
    ``,
    `You can review the quotation anytime here:`,
    i.quoteUrl,
    ``,
    ...emailSignatureText(i.salesName),
    ``,
    `—`,
    `If you'd prefer not to receive follow-ups on this quotation, just reply and let us know and we'll stop.`,
  ].join("\n");

  // Plain, personal formatting (no colored CTA button, minimal styling) so Gmail
  // treats it as a 1-to-1 message and delivers it to Primary, not Promotions.
  const bodyHtml = paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n  ");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">
  ${bodyHtml}
  <p style="margin:0 0 12px">You can view your quotation here: <a href="${esc(i.quoteUrl)}">${esc(i.quoteUrl)}</a></p>
  ${emailSignatureHtml(i.salesName)}
  <p style="margin:16px 0 0;font-size:12px;color:#888">If you'd prefer not to receive follow-ups on this quotation, just reply and let us know and we'll stop.</p>
</div>`;

  return { subject, text, html };
}
