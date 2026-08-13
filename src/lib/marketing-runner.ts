/**
 * Marketing send workers — separate from the quote/inquiry follow-up runner.
 *
 *  • runMarketingRecurring — the daily automatic check-in pass over the marketing
 *    list (every `everyDays`, up to `maxNudges`), gated by its own switch +
 *    dry-run + Resend setup. Called by the cron.
 *  • sendMarketingCampaign — an on-demand blast of a composed subject + message
 *    to the chosen audience. Triggered by a user from the Marketing page.
 *
 * Both honour the per-client opt-out, skip clients with no email, record each
 * send to the client's conversation history, and never exceed a per-run cap.
 */
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { config as appConfig } from "@/lib/config";
import { calendarDaysBetween } from "@/lib/follow-up";
import { getAccountsRegistry, saveAccountsRegistry, type ConversationEntry } from "@/lib/account";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { longLivedImageUrl } from "@/lib/storage";
import { unsubscribeUrl } from "@/lib/marketing-unsubscribe";
import {
  getMarketingConfig,
  getMarketingRecipients,
  buildMarketingEmail,
  type MarketingAudience,
} from "@/lib/marketing";
import {
  buildCampaignEmail,
  campaignImagePaths,
  type CampaignDraft,
} from "@/lib/marketing-campaign";

const MARKETING_CAP_PER_RUN = 300;

export interface MarketingRunItem {
  company: string;
  to: string;
  action: "sent" | "preview" | "skipped";
  reason?: string;
}

export interface MarketingRunResult {
  ranAt: string;
  live: boolean;
  requestedLive: boolean;
  reason?: string;
  recipients: number; // how many were in the audience
  sent: number;
  previewed: number;
  skipped: number;
  items: MarketingRunItem[];
  errors: string[];
}

const senderFrom = (nameOverride?: string) =>
  appConfig.followUpFromEmail ? `${(nameOverride?.trim() || appConfig.followUpFromName)} <${appConfig.followUpFromEmail}>` : "";

function logEntry(now: Date, company: string, contactName: string | null, message: string, actor?: { id: string; name: string }): ConversationEntry {
  return {
    id: randomUUID(),
    date: now.toISOString(),
    channel: "Email",
    contactPerson: contactName ?? company,
    message,
    quoteNumber: null,
    nextFollowUp: null,
    loggedById: actor?.id ?? "system",
    loggedByName: actor?.name ?? "Marketing",
    createdAt: now.toISOString(),
  };
}

/** The automatic recurring check-in pass over the marketing list. */
export async function runMarketingRecurring(opts: { now?: Date; live: boolean }): Promise<MarketingRunResult> {
  const now = opts.now ?? new Date();
  const config = await getMarketingConfig();
  const canSend = emailConfigured() && !!appConfig.followUpFromEmail;
  const effectiveLive = opts.live && config.enabled && !config.dryRun && canSend;
  let reason: string | undefined;
  if (opts.live && !effectiveLive) {
    reason = !config.enabled
      ? "recurring marketing is disabled"
      : config.dryRun
        ? "dry-run is on"
        : !emailConfigured()
          ? "no Resend API key configured"
          : "no sender address configured (FOLLOW_UP_FROM_EMAIL)";
  }

  const accounts = await getAccountsRegistry();
  const customers = await prisma.customer.findMany({ select: { id: true, company: true, contactName: true, email: true }, orderBy: { company: "asc" } });
  const from = senderFrom();

  const items: MarketingRunItem[] = [];
  const errors: string[] = [];
  let recipients = 0;
  let sent = 0;
  let previewed = 0;
  let skipped = 0;
  let dirty = false;

  for (const c of customers) {
    const acct = accounts[c.id];
    if (!acct?.marketingList) continue; // recurring targets the marketing list only
    recipients++;
    const email = (c.email ?? "").trim();
    if (acct.optOutFollowUp) { skipped++; items.push({ company: c.company, to: email, action: "skipped", reason: "opted out" }); continue; }
    if (!email) { skipped++; items.push({ company: c.company, to: "", action: "skipped", reason: "no email on file" }); continue; }

    const sentArr = acct.marketingFollowUp?.sent ?? [];
    if (sentArr.length >= config.maxNudges) continue; // reached the cap — done
    const lastSent = sentArr.length ? new Date(sentArr[sentArr.length - 1].at) : null;
    const due = !lastSent || calendarDaysBetween(lastSent, now) >= config.everyDays;
    if (!due) continue;

    const mail = buildMarketingEmail({ subject: config.subject, body: config.body, company: c.company, contactName: c.contactName });

    if (!effectiveLive) { previewed++; items.push({ company: c.company, to: email, action: "preview" }); continue; }
    if (sent >= MARKETING_CAP_PER_RUN) { skipped++; items.push({ company: c.company, to: email, action: "skipped", reason: "per-run send cap reached" }); continue; }

    try {
      await sendEmail({ from, to: email, subject: mail.subject, text: mail.text, html: mail.html });
      const a = accounts[c.id]!;
      a.marketingFollowUp = { sent: [...(a.marketingFollowUp?.sent ?? []), { at: now.toISOString() }] };
      a.conversations = [...(a.conversations ?? []), logEntry(now, c.company, c.contactName, "Automated marketing check-in sent.")];
      dirty = true;
      sent++;
      items.push({ company: c.company, to: email, action: "sent" });
    } catch (e) {
      errors.push(`${c.company}: ${e instanceof Error ? e.message : "send failed"}`);
      items.push({ company: c.company, to: email, action: "skipped", reason: "send failed" });
    }
  }

  if (dirty) await saveAccountsRegistry(accounts);
  return { ranAt: now.toISOString(), live: effectiveLive, requestedLive: opts.live, reason, recipients, sent, previewed, skipped, items, errors };
}

/**
 * Send one composed campaign to the chosen audience now. `live: false` previews
 * (counts recipients, sends nothing). Requires a Resend key + sender to deliver.
 */
export async function sendMarketingCampaign(opts: {
  subject: string;
  body: string;
  audience: MarketingAudience;
  live: boolean;
  actor?: { id: string; name: string };
}): Promise<MarketingRunResult> {
  const now = new Date();
  const canSend = emailConfigured() && !!appConfig.followUpFromEmail;
  const effectiveLive = opts.live && canSend;
  let reason: string | undefined;
  if (opts.live && !effectiveLive) {
    reason = !emailConfigured() ? "no Resend API key configured" : "no sender address configured (FOLLOW_UP_FROM_EMAIL)";
  }

  const list = await getMarketingRecipients(opts.audience);
  const accounts = await getAccountsRegistry();
  const from = senderFrom();

  const items: MarketingRunItem[] = [];
  const errors: string[] = [];
  let sent = 0;
  let previewed = 0;
  let skipped = 0;
  let dirty = false;

  for (const r of list) {
    if (!effectiveLive) { previewed++; items.push({ company: r.company, to: r.email, action: "preview" }); continue; }
    if (sent >= MARKETING_CAP_PER_RUN) { skipped++; items.push({ company: r.company, to: r.email, action: "skipped", reason: "per-run send cap reached" }); continue; }
    try {
      const mail = buildMarketingEmail({ subject: opts.subject, body: opts.body, company: r.company, contactName: r.contactName });
      await sendEmail({ from, to: r.email, subject: mail.subject, text: mail.text, html: mail.html });
      const a = accounts[r.id] ?? { history: [], conversations: [] };
      a.conversations = [...(a.conversations ?? []), logEntry(now, r.company, r.contactName, `Marketing campaign sent: “${opts.subject}”.`, opts.actor)];
      accounts[r.id] = a;
      dirty = true;
      sent++;
      items.push({ company: r.company, to: r.email, action: "sent" });
    } catch (e) {
      errors.push(`${r.company}: ${e instanceof Error ? e.message : "send failed"}`);
      items.push({ company: r.company, to: r.email, action: "skipped", reason: "send failed" });
    }
  }

  if (dirty) await saveAccountsRegistry(accounts);
  return { ranAt: now.toISOString(), live: effectiveLive, requestedLive: opts.live, reason, recipients: list.length, sent, previewed, skipped, items, errors };
}

// ===========================================================================
// Rich campaign builder — a structured, sectioned promotional email.
// ===========================================================================

/** Resolve every image path referenced by a draft to a long-lived signed URL. */
async function resolveCampaignImageUrls(draft: CampaignDraft): Promise<Record<string, string>> {
  const paths = campaignImagePaths(draft);
  const urls: Record<string, string> = {};
  await Promise.all(
    paths.map(async (p) => {
      try { urls[p] = await longLivedImageUrl(p); } catch { /* drop broken image silently */ }
    }),
  );
  return urls;
}

export interface CampaignPreview {
  subject: string;
  html: string;
  text: string;
  sampleTo: string; // the sample recipient the preview was personalized for
}

/**
 * Render the campaign for a single sample recipient — the exact HTML/text that
 * would be sent. Used by the builder's live preview. Sends nothing.
 */
export async function renderCampaignPreview(draft: CampaignDraft): Promise<CampaignPreview> {
  const imageUrls = await resolveCampaignImageUrls(draft);
  // Personalize against a real recipient when one exists, else a placeholder.
  const [sample] = await getMarketingRecipients("all");
  const recipient = sample
    ? { company: sample.company, contactName: sample.contactName }
    : { company: "Sample Company Inc.", contactName: "Juan Dela Cruz" };
  const mail = buildCampaignEmail(draft, {
    recipient,
    imageUrls,
    unsubscribeUrl: unsubscribeUrl(sample?.id ?? "sample"),
  });
  return { subject: mail.subject, html: mail.html, text: mail.text, sampleTo: sample?.company ?? "a sample client" };
}

/**
 * Send one built campaign to the chosen audience now. `live: false` previews
 * (counts recipients, sends nothing). Honours opt-outs, skips no-email clients,
 * personalizes per recipient and embeds a one-click unsubscribe link.
 */
export async function sendCampaign(opts: {
  draft: CampaignDraft;
  audience: MarketingAudience;
  live: boolean;
  actor?: { id: string; name: string };
}): Promise<MarketingRunResult> {
  const now = new Date();
  const canSend = emailConfigured() && !!appConfig.followUpFromEmail;
  const effectiveLive = opts.live && canSend;
  let reason: string | undefined;
  if (opts.live && !effectiveLive) {
    reason = !emailConfigured() ? "no Resend API key configured" : "no sender address configured (FOLLOW_UP_FROM_EMAIL)";
  }

  const list = await getMarketingRecipients(opts.audience);
  const accounts = await getAccountsRegistry();
  const from = senderFrom(opts.draft.senderName);
  const imageUrls = effectiveLive ? await resolveCampaignImageUrls(opts.draft) : {};

  const items: MarketingRunItem[] = [];
  const errors: string[] = [];
  let sent = 0;
  let previewed = 0;
  let skipped = 0;
  let dirty = false;

  for (const r of list) {
    if (!effectiveLive) { previewed++; items.push({ company: r.company, to: r.email, action: "preview" }); continue; }
    if (sent >= MARKETING_CAP_PER_RUN) { skipped++; items.push({ company: r.company, to: r.email, action: "skipped", reason: "per-run send cap reached" }); continue; }
    try {
      const mail = buildCampaignEmail(opts.draft, {
        recipient: { company: r.company, contactName: r.contactName },
        imageUrls,
        unsubscribeUrl: unsubscribeUrl(r.id),
      });
      await sendEmail({ from, to: r.email, subject: mail.subject, text: mail.text, html: mail.html });
      const a = accounts[r.id] ?? { history: [], conversations: [] };
      a.conversations = [...(a.conversations ?? []), logEntry(now, r.company, r.contactName, `Marketing campaign sent: “${mail.subject}”.`, opts.actor)];
      accounts[r.id] = a;
      dirty = true;
      sent++;
      items.push({ company: r.company, to: r.email, action: "sent" });
    } catch (e) {
      errors.push(`${r.company}: ${e instanceof Error ? e.message : "send failed"}`);
      items.push({ company: r.company, to: r.email, action: "skipped", reason: "send failed" });
    }
  }

  if (dirty) await saveAccountsRegistry(accounts);
  return { ranAt: now.toISOString(), live: effectiveLive, requestedLive: opts.live, reason, recipients: list.length, sent, previewed, skipped, items, errors };
}

/**
 * Send one test copy of the campaign to a single address (personalized with
 * sample tokens), so the sender can check how it looks before a real blast.
 */
export async function sendCampaignTest(opts: { draft: CampaignDraft; toEmail: string }): Promise<{ ok: boolean; reason?: string }> {
  if (!emailConfigured() || !appConfig.followUpFromEmail) {
    return { ok: false, reason: !emailConfigured() ? "no Resend API key configured" : "no sender address configured (FOLLOW_UP_FROM_EMAIL)" };
  }
  const imageUrls = await resolveCampaignImageUrls(opts.draft);
  const mail = buildCampaignEmail(opts.draft, {
    recipient: { company: "Sample Company Inc.", contactName: "Juan Dela Cruz" },
    imageUrls,
    unsubscribeUrl: unsubscribeUrl("sample"),
  });
  await sendEmail({
    from: senderFrom(opts.draft.senderName),
    to: opts.toEmail,
    subject: `[TEST] ${mail.subject}`,
    text: mail.text,
    html: mail.html,
  });
  return { ok: true };
}
