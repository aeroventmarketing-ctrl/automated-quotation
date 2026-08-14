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
import { rfqToken } from "@/lib/rfq-link";
import {
  getMarketingConfig,
  getMarketingRecipients,
  buildMarketingEmail,
  type MarketingAudience,
  type MarketingRecipient,
} from "@/lib/marketing";
import {
  buildCampaignEmail,
  campaignImagePaths,
  type CampaignDraft,
} from "@/lib/marketing-campaign";
import {
  recordCampaignSend,
  getScheduledCampaigns,
  updateScheduledCampaign,
  getCampaignSends,
  getAbTests,
  addAbTest,
  updateAbTest,
  type AbTest,
} from "@/lib/marketing-store";

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
  /** The send-record id (set on a live campaign send — used for open/click tracking). */
  sendId?: string;
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
  const sampleId = sample?.id ?? "sample";
  const mail = buildCampaignEmail(draft, {
    recipient,
    imageUrls,
    unsubscribeUrl: unsubscribeUrl(sampleId),
    rfqPrefill: { customerId: sampleId, token: rfqToken(sampleId) },
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
  /** Campaign name for the send record (defaults to the subject). */
  campaignName?: string;
}): Promise<MarketingRunResult> {
  const recipients = await getMarketingRecipients(opts.audience);
  return deliverCampaign({ ...opts, recipients, audience: opts.audience });
}

/**
 * Deliver a campaign to a specific recipient list (the shared core of a direct
 * send, a scheduled send, and each A/B variant / remainder send).
 */
export async function deliverCampaign(opts: {
  draft: CampaignDraft;
  recipients: MarketingRecipient[];
  live: boolean;
  audience?: MarketingAudience; // for the send record's label only
  actor?: { id: string; name: string };
  campaignName?: string;
}): Promise<MarketingRunResult> {
  const now = new Date();
  const canSend = emailConfigured() && !!appConfig.followUpFromEmail;
  const effectiveLive = opts.live && canSend;
  let reason: string | undefined;
  if (opts.live && !effectiveLive) {
    reason = !emailConfigured() ? "no Resend API key configured" : "no sender address configured (FOLLOW_UP_FROM_EMAIL)";
  }

  const list = opts.recipients;
  const accounts = await getAccountsRegistry();
  const from = senderFrom(opts.draft.senderName);
  const imageUrls = effectiveLive ? await resolveCampaignImageUrls(opts.draft) : {};
  const sendId = randomUUID();
  const trackBase = appConfig.appUrl.replace(/\/+$/, "");

  const items: MarketingRunItem[] = [];
  const errors: string[] = [];
  let sent = 0;
  let previewed = 0;
  let skipped = 0;
  let dirty = false;
  let subjectSample = "";

  for (const r of list) {
    if (!effectiveLive) { previewed++; items.push({ company: r.company, to: r.email, action: "preview" }); continue; }
    if (sent >= MARKETING_CAP_PER_RUN) { skipped++; items.push({ company: r.company, to: r.email, action: "skipped", reason: "per-run send cap reached" }); continue; }
    try {
      const mail = buildCampaignEmail(opts.draft, {
        recipient: { company: r.company, contactName: r.contactName },
        imageUrls,
        unsubscribeUrl: unsubscribeUrl(r.id),
        tracking: { base: trackBase, sendId, customerId: r.id },
        rfqPrefill: { customerId: r.id, token: rfqToken(r.id) },
      });
      subjectSample = mail.subject;
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
  // Record the send for the results view (only when something actually went out).
  if (effectiveLive && sent > 0) {
    await recordCampaignSend({
      id: sendId,
      name: (opts.campaignName ?? "").trim() || subjectSample || "Campaign",
      subject: subjectSample,
      audience: opts.audience ?? "custom",
      sentAt: now.toISOString(),
      sentByName: opts.actor?.name ?? "Marketing",
      recipients: list.length,
      sent,
    });
  }
  return { ranAt: now.toISOString(), live: effectiveLive, requestedLive: opts.live, reason, recipients: list.length, sent, previewed, skipped, items, errors, sendId: effectiveLive && sent > 0 ? sendId : undefined };
}

/**
 * Fire any scheduled campaigns whose time has arrived. Called hourly by the cron
 * — independent of the recurring-check-in schedule gate.
 */
export async function runScheduledCampaigns(opts: { now?: Date; live: boolean }): Promise<{ processed: number; sent: number; failed: number }> {
  const now = opts.now ?? new Date();
  const jobs = await getScheduledCampaigns();
  const due = jobs.filter((j) => j.status === "pending" && j.scheduledFor && new Date(j.scheduledFor).getTime() <= now.getTime());
  let processed = 0;
  let sentTotal = 0;
  let failed = 0;
  for (const job of due) {
    if (!opts.live) continue;
    processed++;
    try {
      const res = await sendCampaign({ draft: job.draft, audience: job.audience, live: true, campaignName: job.name, actor: { id: "scheduler", name: job.createdByName || "Scheduler" } });
      sentTotal += res.sent;
      await updateScheduledCampaign(job.id, {
        status: "sent",
        sentAt: now.toISOString(),
        sendId: res.sendId,
        result: { sent: res.sent, skipped: res.skipped, failed: res.errors.length },
        ...(res.reason ? { error: res.reason } : {}),
      });
    } catch (e) {
      failed++;
      await updateScheduledCampaign(job.id, { status: "failed", error: e instanceof Error ? e.message : "send failed" });
    }
  }
  return { processed, sent: sentTotal, failed };
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

// ===========================================================================
// A/B subject testing
// ===========================================================================

/** Fisher–Yates shuffle (Math.random is fine here — normal server code). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Start an A/B subject test: send subject A and subject B to two halves of a
 * small test slice of the audience now; the cron picks the higher-opening subject
 * after `decideAfterHours` and sends it to the remaining recipients.
 */
export async function startAbTest(opts: {
  draft: CampaignDraft;
  subjectB: string;
  audience: MarketingAudience;
  testFraction: number;
  decideAfterHours: number;
  actor?: { id: string; name: string };
  name?: string;
}): Promise<{ ok: boolean; reason?: string; test?: AbTest }> {
  if (!emailConfigured() || !appConfig.followUpFromEmail) {
    return { ok: false, reason: !emailConfigured() ? "no Resend API key configured" : "no sender address configured (FOLLOW_UP_FROM_EMAIL)" };
  }
  const subjectA = opts.draft.subject.trim();
  const subjectB = opts.subjectB.trim();
  if (!subjectA || !subjectB) return { ok: false, reason: "both subject A and subject B are required" };

  const all = await getMarketingRecipients(opts.audience);
  if (all.length < 4) return { ok: false, reason: "need at least 4 recipients to A/B test the subject" };

  const frac = Math.min(0.9, Math.max(0.1, opts.testFraction || 0.3));
  const shuffled = shuffle(all);
  let testCount = Math.round(all.length * frac);
  testCount = Math.max(2, Math.min(testCount, all.length - 1)); // ≥2 to split, keep ≥1 for the remainder
  const testGroup = shuffled.slice(0, testCount);
  const half = Math.floor(testGroup.length / 2);
  const groupA = testGroup.slice(0, half);
  const groupB = testGroup.slice(half);

  const now = new Date();
  const name = (opts.name ?? "").trim() || subjectA || "A/B test";
  const decideHours = Math.max(1, Math.round(opts.decideAfterHours || 4));

  const resA = await deliverCampaign({ draft: { ...opts.draft, subject: subjectA }, recipients: groupA, live: true, actor: opts.actor, campaignName: `${name} — A` });
  const resB = await deliverCampaign({ draft: { ...opts.draft, subject: subjectB }, recipients: groupB, live: true, actor: opts.actor, campaignName: `${name} — B` });

  const test: AbTest = {
    id: randomUUID(),
    name,
    draft: opts.draft,
    subjectA,
    subjectB,
    audience: opts.audience,
    testFraction: frac,
    decideAfterHours: decideHours,
    status: "testing",
    createdByName: opts.actor?.name ?? "Marketing",
    createdAt: now.toISOString(),
    decideAt: new Date(now.getTime() + decideHours * 3600_000).toISOString(),
    testedIdsA: groupA.map((r) => r.id),
    testedIdsB: groupB.map((r) => r.id),
    sendIdA: resA.sendId,
    sendIdB: resB.sendId,
  };
  await addAbTest(test);
  return { ok: true, test };
}

/**
 * Finish any A/B tests whose decision time has passed: compare the open rate of
 * the two test variants, then send the winning subject to everyone who wasn't in
 * the test slice. Called hourly by the cron.
 */
export async function runAbTests(opts: { now?: Date; live: boolean }): Promise<{ processed: number; completed: number }> {
  const now = opts.now ?? new Date();
  const tests = await getAbTests();
  const due = tests.filter((t) => t.status === "testing" && t.decideAt && new Date(t.decideAt).getTime() <= now.getTime());
  let processed = 0;
  let completed = 0;
  for (const t of due) {
    if (!opts.live) continue;
    processed++;
    try {
      const sends = await getCampaignSends();
      const a = sends.find((s) => s.id === t.sendIdA);
      const b = sends.find((s) => s.id === t.sendIdB);
      const rateA = a && a.sent > 0 ? a.openedIds.length / a.sent : 0;
      const rateB = b && b.sent > 0 ? b.openedIds.length / b.sent : 0;
      const winner: "A" | "B" = rateB > rateA ? "B" : "A"; // tie → A
      const winnerSubject = winner === "A" ? t.subjectA : t.subjectB;

      const audience = await getMarketingRecipients(t.audience);
      const tested = new Set([...t.testedIdsA, ...t.testedIdsB]);
      const remainder = audience.filter((r) => !tested.has(r.id));
      let remainderSendId: string | undefined;
      if (remainder.length > 0) {
        const res = await deliverCampaign({
          draft: { ...t.draft, subject: winnerSubject },
          recipients: remainder,
          live: true,
          actor: { id: "scheduler", name: t.createdByName || "Scheduler" },
          campaignName: `${t.name} — winner (${winner})`,
        });
        remainderSendId = res.sendId;
      }
      await updateAbTest(t.id, { status: "completed", winner, winnerSubject, remainderSendId, remainderCount: remainder.length, completedAt: now.toISOString() });
      completed++;
    } catch (e) {
      await updateAbTest(t.id, { status: "failed", error: e instanceof Error ? e.message : "A/B finalize failed" });
    }
  }
  return { processed, completed };
}
