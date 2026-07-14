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

export function buildFollowUpEmail(i: FollowUpEmailInput): BuiltEmail {
  const greetingName = i.contactName?.trim() || i.company;
  const project = i.projectName?.trim() ? ` for ${i.projectName.trim()}` : "";
  const validity = i.validUntil ? ` It is valid until ${fmtDate(i.validUntil)}.` : "";

  const subject = `Following up on your quotation ${i.quoteNumber}`;

  const text = [
    `Dear ${greetingName},`,
    ``,
    `Thank you for the opportunity to quote your requirement. We're following up on quotation ${i.quoteNumber}${project}, which we sent for your consideration.`,
    ``,
    `Quoted amount: ${money(i.total, i.currency)}.${validity}`,
    ``,
    `You can review the quotation anytime here:`,
    i.quoteUrl,
    ``,
    `If you have any questions or would like to make adjustments, simply reply to this email — we would be glad to assist.`,
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

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2933;max-width:560px">
  <p>Dear ${esc(greetingName)},</p>
  <p>Thank you for the opportunity to quote your requirement. We're following up on quotation
     <strong>${esc(i.quoteNumber)}</strong>${project ? ` for ${esc(i.projectName!.trim())}` : ""},
     which we sent for your consideration.</p>
  <p>Quoted amount: <strong>${esc(money(i.total, i.currency))}</strong>.${
    i.validUntil ? ` It is valid until ${esc(fmtDate(i.validUntil))}.` : ""
  }</p>
  <p style="margin:22px 0">
    <a href="${esc(i.quoteUrl)}" style="background:#0d7a84;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">View your quotation</a>
  </p>
  <p>If you have any questions or would like to make adjustments, simply reply to this email — we would be glad to assist.</p>
  <p>${esc(COMPANY.closing)}</p>
  <p style="margin-bottom:2px">${esc(COMPANY.signoff)}</p>
  <p style="margin-top:0"><strong>${esc(i.salesName)}</strong><br>${esc(COMPANY.signatory)}</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
  <p style="font-size:12px;color:#7d9199">If you'd prefer not to receive follow-ups on this quotation, just reply and let us know and we'll stop.</p>
</div>`;

  return { subject, text, html };
}
