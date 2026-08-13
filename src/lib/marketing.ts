/**
 * Email-marketing to the client list — independent of quotations/inquiries.
 *
 * Two modes share one audience (clients on the marketing list, or all clients
 * with an email, minus opt-outs):
 *   • Campaigns — a subject + message the user composes and sends on demand.
 *   • Recurring check-ins — a saved message sent automatically every N days.
 *
 * Config + per-client send history ride existing JSON (AppSetting + the accounts
 * registry) so there's no schema change. Sending always honours the per-client
 * opt-out and skips clients with no email.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { getAccountsRegistry } from "@/lib/account";
import type { BuiltEmail } from "@/lib/follow-up-email";

export const MARKETING_SETTINGS_KEY = "marketing_settings";

export interface MarketingConfig {
  /** Recurring check-ins on/off (default false). */
  enabled: boolean;
  /** Compute but never send (default true). */
  dryRun: boolean;
  /** Days between recurring check-ins (default 30). */
  everyDays: number;
  /** Cap on recurring check-ins per client (default 6). */
  maxNudges: number;
  /** The recurring message. */
  subject: string;
  body: string;
}

const DEFAULT_SUBJECT = `Keeping in touch — ${COMPANY.name}`;
const DEFAULT_BODY =
  "We just wanted to check in and stay in touch. If there's anything we can help you with — fans, blowers, ductwork, or ventilation — simply reply to this email and we'll be glad to assist.";

export function normalizeMarketingConfig(input: Partial<MarketingConfig> | null | undefined): MarketingConfig {
  const rawEvery = Math.floor(Number(input?.everyDays));
  const everyDays = Number.isFinite(rawEvery) && rawEvery > 0 ? rawEvery : 30;
  const rawMax = Math.floor(Number(input?.maxNudges));
  const maxNudges = Number.isFinite(rawMax) && rawMax >= 1 ? rawMax : 6;
  return {
    enabled: input?.enabled === true, // default OFF
    dryRun: input?.dryRun !== false, // default ON (safe)
    everyDays,
    maxNudges,
    subject: (typeof input?.subject === "string" && input.subject.trim()) || DEFAULT_SUBJECT,
    body: (typeof input?.body === "string" && input.body.trim()) || DEFAULT_BODY,
  };
}

export async function getMarketingConfig(): Promise<MarketingConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: MARKETING_SETTINGS_KEY } });
  return normalizeMarketingConfig(row?.value as Partial<MarketingConfig> | null);
}

export async function setMarketingConfig(input: Partial<MarketingConfig>): Promise<MarketingConfig> {
  const d = normalizeMarketingConfig(input);
  await prisma.appSetting.upsert({
    where: { key: MARKETING_SETTINGS_KEY },
    create: { key: MARKETING_SETTINGS_KEY, value: d as unknown as Prisma.InputJsonValue },
    update: { value: d as unknown as Prisma.InputJsonValue },
  });
  return d;
}

export type MarketingAudience = "list" | "all";

export interface MarketingRecipient {
  id: string;
  company: string;
  contactName: string | null;
  email: string;
}

/**
 * The clients a marketing send would reach: those with an email who haven't
 * opted out — either everyone ("all") or only those on the marketing list.
 */
export async function getMarketingRecipients(audience: MarketingAudience): Promise<MarketingRecipient[]> {
  const [accounts, customers] = await Promise.all([
    getAccountsRegistry(),
    prisma.customer.findMany({ select: { id: true, company: true, contactName: true, email: true }, orderBy: { company: "asc" } }),
  ]);
  const out: MarketingRecipient[] = [];
  for (const c of customers) {
    const email = (c.email ?? "").trim();
    if (!email) continue;
    const acct = accounts[c.id];
    if (acct?.optOutFollowUp) continue;
    if (audience === "list" && !acct?.marketingList) continue;
    out.push({ id: c.id, company: c.company, contactName: c.contactName, email });
  }
  return out;
}

export interface ContactLite {
  company: string;
  contactName: string | null;
  email: string | null;
}

/** Resolve customer ids → basic contact info, for the campaign-results breakdown. */
export async function resolveContacts(ids: string[]): Promise<Record<string, ContactLite>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return {};
  const rows = await prisma.customer.findMany({
    where: { id: { in: unique } },
    select: { id: true, company: true, contactName: true, email: true },
  });
  const out: Record<string, ContactLite> = {};
  for (const r of rows) out[r.id] = { company: r.company, contactName: r.contactName, email: r.email };
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Build a marketing email from a composed subject + body. The body is treated as
 * plain text (blank line = new paragraph); a greeting and an opt-out footer are
 * added automatically.
 */
export function buildMarketingEmail(i: { subject: string; body: string; company: string; contactName: string | null }): BuiltEmail {
  const greetingName = i.contactName?.trim() || i.company;
  const paragraphs = i.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const text = [
    `Dear ${greetingName},`,
    ``,
    ...paragraphs.flatMap((p) => [p, ``]),
    COMPANY.signoff,
    COMPANY.signatory,
    ``,
    `—`,
    `If you'd prefer not to receive these emails, just reply and let us know and we'll take you off the list.`,
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2933;max-width:560px">
  <p>Dear ${esc(greetingName)},</p>
  ${paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n  ")}
  <p style="margin-bottom:2px">${esc(COMPANY.signoff)}</p>
  <p style="margin-top:0"><strong>${esc(COMPANY.signatory)}</strong></p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
  <p style="font-size:12px;color:#7d9199">If you'd prefer not to receive these emails, just reply and let us know and we'll take you off the list.</p>
</div>`;

  return { subject: i.subject, text, html };
}
