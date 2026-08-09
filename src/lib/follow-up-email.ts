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
  const greetingName = i.contactName?.trim() || i.company;
  const about = i.projectName?.trim() ? ` regarding ${i.projectName.trim()}` : "";

  const subject = `Just checking in from ${COMPANY.name}`;

  const text = [
    `Dear ${greetingName},`,
    ``,
    `We wanted to check in and see how things are going${about}. We'd be glad to help you move forward whenever you're ready — whether that's preparing a quotation, answering technical questions, or discussing options for your project.`,
    ``,
    `If there's anything we can assist with, simply reply to this email and we'll get right back to you.`,
    ``,
    COMPANY.closing,
    ``,
    COMPANY.signoff,
    i.salesName,
    COMPANY.signatory,
    ``,
    `—`,
    `If you'd prefer not to receive these check-ins, just reply and let us know and we'll stop.`,
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2933;max-width:560px">
  <p>Dear ${esc(greetingName)},</p>
  <p>We wanted to check in and see how things are going${about ? ` regarding ${esc(i.projectName!.trim())}` : ""}. We'd be glad to help you move forward whenever you're ready — whether that's preparing a quotation, answering technical questions, or discussing options for your project.</p>
  <p>If there's anything we can assist with, simply reply to this email and we'll get right back to you.</p>
  <p>${esc(COMPANY.closing)}</p>
  <p style="margin-bottom:2px">${esc(COMPANY.signoff)}</p>
  <p style="margin-top:0"><strong>${esc(i.salesName)}</strong><br>${esc(COMPANY.signatory)}</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
  <p style="font-size:12px;color:#7d9199">If you'd prefer not to receive these check-ins, just reply and let us know and we'll stop.</p>
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
    contactName: i.contactName?.trim() || i.company,
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
    COMPANY.closing,
    ``,
    COMPANY.signoff,
    i.salesName,
    COMPANY.signatory,
    ``,
    `—`,
    `If you'd prefer not to receive follow-ups on this quotation, just reply and let us know and we'll stop.`,
  ].join("\n");

  const bodyHtml = paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n  ");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2933;max-width:560px">
  ${bodyHtml}
  <p style="margin:22px 0">
    <a href="${esc(i.quoteUrl)}" style="background:#0d7a84;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">View your quotation</a>
  </p>
  <p>${esc(COMPANY.closing)}</p>
  <p style="margin-bottom:2px">${esc(COMPANY.signoff)}</p>
  <p style="margin-top:0"><strong>${esc(i.salesName)}</strong><br>${esc(COMPANY.signatory)}</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
  <p style="font-size:12px;color:#7d9199">If you'd prefer not to receive follow-ups on this quotation, just reply and let us know and we'll stop.</p>
</div>`;

  return { subject, text, html };
}
