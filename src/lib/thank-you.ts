/**
 * "Thank you" messages — a one-shot email + SMS sent to a client when their
 * inquiry is marked WON (order confirmed) or LOST (didn't push through). Separate
 * from the recurring follow-up nudges: it fires once on the Won/Lost transition,
 * never repeats (idempotency stamp on the accounts registry), respects the same
 * per-client opt-out, and is gated by its own enable + dry-run switches plus the
 * shared Resend / Semaphore configuration.
 *
 * Config lives in the AppSetting key `thank_you_settings` (no migration), like the
 * follow-up settings. Both channels degrade safely to "no send" when unconfigured
 * or in dry-run, and every send is best-effort — a failure never blocks the Won/
 * Lost status change that triggered it.
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { firstNameOf, type BuiltEmail } from "@/lib/follow-up-email";
import { getAccountsRegistry, saveAccountsRegistry, type ConversationEntry } from "@/lib/account";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { sendSms, smsConfigured, normalizePhMobile } from "@/lib/sms/semaphore";

export const THANK_YOU_SETTINGS_KEY = "thank_you_settings";

export type ThankYouOutcome = "won" | "lost";

export interface ThankYouSide {
  enabled: boolean;
  subject: string; // email subject
  body: string; // email body (branded shell added automatically)
  sms: string; // SMS text
}

export interface ThankYouConfig {
  /** When true, compute + log but never actually send (default true — safe). */
  dryRun: boolean;
  won: ThankYouSide;
  lost: ThankYouSide;
}

/** Placeholders an admin may drop into a thank-you subject / body / SMS. */
export const THANK_YOU_PLACEHOLDERS = [
  "{contactName}",
  "{company}",
  "{quoteNumber}",
  "{total}",
  "{salesName}",
  "{quoteUrl}",
] as const;

export const DEFAULT_THANK_YOU: ThankYouConfig = {
  dryRun: true,
  won: {
    enabled: false,
    subject: "Thank you for your order — Aerovent Fans and Blowers Manufacturing",
    body:
      "Dear {contactName},\n\n" +
      "Thank you for choosing Aerovent Fans and Blowers Manufacturing. We're delighted to be working with {company} on this order (quotation {quoteNumber}, {total}).\n\n" +
      "Our team will be in touch as we move your order into production. If you have any questions along the way, simply reply to this email — we're always glad to help.\n\n" +
      "We truly appreciate your trust and look forward to serving you.",
    sms:
      "Hi {contactName}, thank you for your order with Aerovent FBM (quotation {quoteNumber}, {total})! We're glad to work with you and will keep you posted. - {salesName}",
  },
  lost: {
    enabled: false,
    subject: "Thank you from Aerovent Fans and Blowers Manufacturing",
    body:
      "Dear {contactName},\n\n" +
      "Thank you for giving Aerovent Fans and Blowers Manufacturing the opportunity to quote your requirement (quotation {quoteNumber}).\n\n" +
      "While this one didn't push through, we genuinely appreciate the chance to be considered, and we'd be glad to assist on any future project — whether that's revisiting the scope, specifications, or budget.\n\n" +
      "Please keep us in mind. We're always here to help.",
    sms:
      "Hi {contactName}, thank you for considering Aerovent FBM for {quoteNumber}. We'd be glad to help on any future project — just reach out anytime. - {salesName}",
  },
};

function coerceSide(v: unknown, d: ThankYouSide): ThankYouSide {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    subject: typeof o.subject === "string" ? o.subject : d.subject,
    body: typeof o.body === "string" ? o.body : d.body,
    sms: typeof o.sms === "string" ? o.sms : d.sms,
  };
}

export function normalizeThankYou(input: Partial<ThankYouConfig> | null | undefined): ThankYouConfig {
  return {
    dryRun: input?.dryRun !== false, // default ON (safe)
    won: coerceSide(input?.won, DEFAULT_THANK_YOU.won),
    lost: coerceSide(input?.lost, DEFAULT_THANK_YOU.lost),
  };
}

export async function getThankYouSettings(): Promise<ThankYouConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: THANK_YOU_SETTINGS_KEY } });
  return normalizeThankYou(row?.value as Partial<ThankYouConfig> | null);
}

export async function setThankYouSettings(input: Partial<ThankYouConfig>): Promise<ThankYouConfig> {
  const d = normalizeThankYou(input);
  await prisma.appSetting.upsert({
    where: { key: THANK_YOU_SETTINGS_KEY },
    create: { key: THANK_YOU_SETTINGS_KEY, value: d as unknown as Prisma.InputJsonValue },
    update: { value: d as unknown as Prisma.InputJsonValue },
  });
  return d;
}

// --- Message building -------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function money(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: 2 }).format(total);
  } catch {
    return `${currency} ${total.toLocaleString()}`;
  }
}

/** Substitute {placeholders}; known-but-empty → "", unknown left as typed. */
function applyTokens(s: string, tokens: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in tokens ? tokens[k] : `{${k}}`));
}

export interface ThankYouTokens {
  contactName: string | null;
  company: string;
  quoteNumber: string;
  total: string; // already formatted
  salesName: string;
  quoteUrl: string;
}

function tokenMap(t: ThankYouTokens): Record<string, string> {
  return {
    contactName: t.contactName?.trim() ? firstNameOf(t.contactName) : t.company,
    company: t.company,
    quoteNumber: t.quoteNumber,
    total: t.total,
    salesName: t.salesName,
    quoteUrl: t.quoteUrl,
  };
}

const SIGN_OFF = "Best regards,";
const EMAIL_COMPANY = "Aerovent Fans and Blowers Manufacturing";
const EMAIL_TAGLINE = "Engineering Superior Airflow Solutions";

export function buildThankYouEmail(side: ThankYouSide, t: ThankYouTokens): BuiltEmail {
  const tokens = tokenMap(t);
  const subject = applyTokens(side.subject, tokens).trim() || "Thank you from Aerovent";
  const bodyText = applyTokens(side.body, tokens).trim();
  const paragraphs = bodyText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const text = [
    bodyText,
    ...(t.quoteUrl ? ["", "You can review the quotation anytime here:", t.quoteUrl] : []),
    "",
    SIGN_OFF,
    t.salesName,
    EMAIL_COMPANY,
    EMAIL_TAGLINE,
    "",
    "—",
    "If you'd prefer not to receive messages like this, just reply and let us know and we'll stop.",
  ].join("\n");

  const bodyHtml = paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n  ");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">
  ${bodyHtml}
  ${t.quoteUrl ? `<p style="margin:0 0 12px">You can view your quotation here: <a href="${esc(t.quoteUrl)}">${esc(t.quoteUrl)}</a></p>` : ""}
  <p style="margin:0">${esc(SIGN_OFF)}<br>${esc(t.salesName)}<br>${esc(EMAIL_COMPANY)}<br>${esc(EMAIL_TAGLINE)}</p>
  <p style="margin:16px 0 0;font-size:12px;color:#888">If you'd prefer not to receive messages like this, just reply and let us know and we'll stop.</p>
</div>`;

  return { subject, text, html };
}

export function buildThankYouSms(side: ThankYouSide, t: ThankYouTokens): string {
  return applyTokens(side.sms, tokenMap(t)).replace(/[ \t]+/g, " ").trim();
}

// --- The one-shot send ------------------------------------------------------

export interface ThankYouSendResult {
  outcome: ThankYouOutcome;
  emailSent: boolean;
  smsSent: boolean;
  skipped?: string; // why nothing was sent
}

/**
 * Send the WON/LOST thank-you for an inquiry, once. Best-effort and NON-throwing:
 * any problem (disabled, dry-run, opt-out, no contact, send error) resolves to a
 * result with a reason — it never blocks the caller's status change.
 */
export async function sendThankYou(inquiryId: string, outcome: ThankYouOutcome): Promise<ThankYouSendResult> {
  const res: ThankYouSendResult = { outcome, emailSent: false, smsSent: false };
  try {
    const settings = await getThankYouSettings();
    const side = outcome === "won" ? settings.won : settings.lost;
    if (!side.enabled) return { ...res, skipped: "disabled" };

    const inquiry = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: { customer: true, createdBy: true },
    });
    if (!inquiry) return { ...res, skipped: "inquiry not found" };
    const c = inquiry.customer;

    const accounts = await getAccountsRegistry();
    if (accounts[c.id]?.optOutFollowUp) return { ...res, skipped: "opted out" };

    const stampKey = `${inquiryId}:${outcome}`;
    if (accounts[c.id]?.thankYou?.[stampKey]) return { ...res, skipped: "already sent" };

    // Latest quotation on the inquiry gives the quote number / amount / sales rep.
    const quote = await prisma.quotation.findFirst({
      where: { inquiryId },
      orderBy: { createdAt: "desc" },
      include: { preparedBy: true },
    });
    const salesName = quote?.preparedBy.name ?? inquiry.createdBy.name;
    const tokens: ThankYouTokens = {
      contactName: c.contactName,
      company: c.company,
      quoteNumber: quote?.quoteNumber ?? "",
      total: quote ? money(Number(quote.total), quote.currency) : "",
      salesName,
      quoteUrl: quote ? `${config.appUrl}/q/${quote.id}` : "",
    };

    const now = new Date();
    const live = !settings.dryRun;
    const from = config.followUpFromEmail ? `${config.followUpFromName} <${config.followUpFromEmail}>` : "";
    const replyTo = quote?.preparedBy.email ?? inquiry.createdBy.email ?? undefined;

    // Email
    if (live && c.email && emailConfigured() && config.followUpFromEmail) {
      try {
        const email = buildThankYouEmail(side, tokens);
        await sendEmail({ from, to: c.email, subject: email.subject, text: email.text, html: email.html, replyTo });
        res.emailSent = true;
      } catch {
        /* best-effort */
      }
    }

    // SMS
    const phone = normalizePhMobile(c.phone);
    if (live && phone && smsConfigured()) {
      try {
        const message = buildThankYouSms(side, tokens);
        if (message) {
          await sendSms({ to: phone, message });
          res.smsSent = true;
        }
      } catch {
        /* best-effort */
      }
    }

    if (!res.emailSent && !res.smsSent) {
      return { ...res, skipped: live ? "no reachable channel" : "dry-run" };
    }

    // Stamp idempotency + log to the client's conversation history.
    const acct = accounts[c.id] ?? { history: [], conversations: [] };
    acct.thankYou = { ...(acct.thankYou ?? {}), [stampKey]: now.toISOString() };
    const channels = [res.emailSent ? "email" : null, res.smsSent ? "SMS" : null].filter(Boolean).join(" + ");
    const entry: ConversationEntry = {
      id: randomUUID(),
      date: now.toISOString(),
      channel: res.emailSent && res.smsSent ? "Email" : res.emailSent ? "Email" : "SMS",
      contactPerson: c.contactName ?? c.company,
      message: `${outcome === "won" ? "Won" : "Lost"} thank-you sent (${channels})${tokens.quoteNumber ? ` for quotation ${tokens.quoteNumber}` : ""}.`,
      quoteNumber: tokens.quoteNumber || null,
      nextFollowUp: null,
      loggedById: quote?.preparedById ?? inquiry.createdById,
      loggedByName: salesName,
      createdAt: now.toISOString(),
    };
    acct.conversations = [...(acct.conversations ?? []), entry];
    accounts[c.id] = acct;
    await saveAccountsRegistry(accounts);

    return res;
  } catch {
    // Never let a thank-you problem surface to the caller.
    return { ...res, skipped: "error" };
  }
}
