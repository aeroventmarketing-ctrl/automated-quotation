/**
 * The follow-up scheduler's worker. Scans every sent-but-open quote, asks the
 * rules engine which are due, and for each due one either previews (dry-run) or
 * sends an email and records it. Called by the daily cron route and by the Admin
 * "preview run" button.
 *
 * Safety: sending only happens when the caller asks for live mode AND automated
 * sending is enabled AND a Resend key + sender address are configured. Anything
 * short of that degrades to a preview — it never sends by accident. Each real
 * send is recorded on the quote (so a nudge is never repeated) and logged to the
 * client's conversation history.
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { evaluateFollowUp, sentAtFrom, nudgesSentFrom } from "@/lib/follow-up";
import { getFollowUpSettings } from "@/lib/follow-up-settings";
import { getFollowUpTemplates } from "@/lib/follow-up-templates";
import { getAccountsRegistry, saveAccountsRegistry, type ConversationEntry } from "@/lib/account";
import { buildFollowUpEmail, buildInquiryFollowUpEmail, templateForNudge } from "@/lib/follow-up-email";
import { sendEmail, emailConfigured } from "@/lib/email/resend";

export type RunAction = "sent" | "preview" | "skipped";

export interface RunItem {
  quoteNumber: string; // quote number, or the inquiry's project label for inquiry check-ins
  company: string;
  to: string | null;
  nudge: number;
  action: RunAction;
  reason?: string;
  kind?: "quote" | "inquiry";
}

export interface FollowUpRunResult {
  ranAt: string;
  live: boolean; // whether this run actually sent (effective, after all guards)
  requestedLive: boolean; // whether the caller asked to send
  reason?: string; // why a requested live run degraded to preview
  evaluated: number;
  due: number;
  sent: number;
  previewed: number;
  skipped: number;
  items: RunItem[];
  errors: string[];
}

const SEND_CAP_PER_RUN = 100;

/**
 * Run the follow-up pass. `live` is the caller's intent; the actual send decision
 * also requires the enabled flag, a Resend key, and a configured sender.
 */
export async function runFollowUps(opts: { now?: Date; live: boolean }): Promise<FollowUpRunResult> {
  const now = opts.now ?? new Date();
  const settings = await getFollowUpSettings();
  const templates = await getFollowUpTemplates();

  const canSend = emailConfigured() && !!config.followUpFromEmail;
  const effectiveLive = opts.live && settings.enabled && !settings.dryRun && canSend;
  let reason: string | undefined;
  if (opts.live && !effectiveLive) {
    reason = !settings.enabled
      ? "automated sending is disabled"
      : settings.dryRun
        ? "dry-run is on"
        : !emailConfigured()
          ? "no Resend API key configured"
          : "no sender address configured (FOLLOW_UP_FROM_EMAIL)";
  }

  const quotes = await prisma.quotation.findMany({
    where: { status: "SENT", inquiry: { status: { notIn: ["WON", "LOST"] } } },
    include: { inquiry: { include: { customer: true } }, preparedBy: true },
    orderBy: { createdAt: "asc" },
  });

  const accounts = await getAccountsRegistry();
  let accountsDirty = false;

  const items: RunItem[] = [];
  const errors: string[] = [];
  let due = 0;
  let sent = 0;
  let previewed = 0;
  let skipped = 0;

  const from = config.followUpFromEmail
    ? `${config.followUpFromName} <${config.followUpFromEmail}>`
    : "";

  for (const q of quotes) {
    const sentIso = sentAtFrom(q.classification);
    const sentAt = sentIso ? new Date(sentIso) : q.createdAt;
    const result = evaluateFollowUp(
      {
        sentAt,
        validUntil: q.validUntil ?? null,
        won: false,
        nudgesSent: nudgesSentFrom(q.classification),
        now,
      },
      settings,
    );
    if (result.state !== "due") continue;

    due++;
    const c = q.inquiry.customer;
    const base: RunItem = { quoteNumber: q.quoteNumber, company: c.company, to: c.email, nudge: result.nudgeNumber, action: "skipped", kind: "quote" };

    if (accounts[c.id]?.optOutFollowUp) {
      skipped++;
      items.push({ ...base, action: "skipped", reason: "opted out" });
      continue;
    }
    if (!c.email) {
      skipped++;
      items.push({ ...base, action: "skipped", reason: "no email on file" });
      continue;
    }

    const email = buildFollowUpEmail({
      company: c.company,
      contactName: c.contactName,
      quoteNumber: q.quoteNumber,
      projectName: q.projectName ?? null,
      total: Number(q.total),
      currency: q.currency,
      validUntil: q.validUntil ?? null,
      quoteUrl: `${config.appUrl}/q/${q.id}`,
      salesName: q.preparedBy.name,
      nudgeNumber: result.nudgeNumber,
      template: templateForNudge(templates, result.nudgeNumber),
    });

    if (!effectiveLive) {
      previewed++;
      items.push({ ...base, action: "preview" });
      continue;
    }

    if (sent >= SEND_CAP_PER_RUN) {
      skipped++;
      items.push({ ...base, action: "skipped", reason: "per-run send cap reached" });
      continue;
    }

    try {
      await sendEmail({
        from,
        to: c.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        replyTo: q.preparedBy.email ?? undefined,
      });

      // Record the nudge on the quote so it's never repeated.
      const cls = (q.classification as Record<string, unknown>) ?? {};
      const fu = (cls.followUp as Record<string, unknown> | undefined) ?? {};
      const sentArr = Array.isArray(fu.sent) ? (fu.sent as unknown[]) : [];
      sentArr.push({ nudge: result.nudgeNumber, at: now.toISOString(), channel: "Email", to: c.email });
      await prisma.quotation.update({
        where: { id: q.id },
        data: { classification: { ...cls, followUp: { ...fu, sent: sentArr } } as Prisma.InputJsonObject },
      });

      // Log it into the client's conversation history.
      const entry: ConversationEntry = {
        id: randomUUID(),
        date: now.toISOString(),
        channel: "Email",
        contactPerson: c.contactName ?? c.company,
        message: `Automated follow-up sent (nudge #${result.nudgeNumber}) for quotation ${q.quoteNumber}.`,
        quoteNumber: q.quoteNumber,
        nextFollowUp: null,
        loggedById: q.preparedById,
        loggedByName: q.preparedBy.name,
        createdAt: now.toISOString(),
      };
      const acct = accounts[c.id] ?? { history: [], conversations: [] };
      acct.conversations = [...(acct.conversations ?? []), entry];
      accounts[c.id] = acct;
      accountsDirty = true;

      sent++;
      items.push({ ...base, action: "sent" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "send failed";
      errors.push(`${q.quoteNumber}: ${msg}`);
      items.push({ ...base, action: "skipped", reason: "send failed" });
    }
  }

  // --- Inquiry "constant communication" pass -------------------------------
  // Clients with an OPEN inquiry and no quotation ever sent get a periodic
  // check-in (every `inquiryEveryDays`, up to `inquiryMaxNudges`), one nudge per
  // client. Independent switch (`inquiryEnabled`), still gated by dry-run + keys.
  const inquiryLive = opts.live && settings.inquiryEnabled && !settings.dryRun && canSend;
  const inqOffsets = Array.from({ length: settings.inquiryMaxNudges }, (_, i) => (i + 1) * settings.inquiryEveryDays);
  const inqSettings = { offsetsDays: inqOffsets, maxNudges: settings.inquiryMaxNudges };

  // Clients who HAVE been quoted (any inquiry sent/won/lost) are excluded — they
  // belong to the quotation follow-up flow, not the "not yet quoted" check-ins.
  const quotedCustomerIds = new Set(
    (await prisma.inquiry.findMany({ where: { status: { in: ["SENT", "WON", "LOST"] } }, select: { customerId: true } })).map((i) => i.customerId),
  );
  const openInquiries = await prisma.inquiry.findMany({
    where: { status: { notIn: ["SENT", "WON", "LOST"] } },
    include: { customer: true, createdBy: true },
    orderBy: { createdAt: "asc" },
  });
  // One check-in per client, anchored on their earliest open inquiry.
  const inquiryByCustomer = new Map<string, (typeof openInquiries)[number]>();
  for (const inq of openInquiries) {
    if (quotedCustomerIds.has(inq.customerId)) continue;
    if (!inquiryByCustomer.has(inq.customerId)) inquiryByCustomer.set(inq.customerId, inq);
  }

  for (const inq of inquiryByCustomer.values()) {
    const c = inq.customer;
    const nudgesSent = accounts[c.id]?.inquiryFollowUp?.sent?.length ?? 0;
    const result = evaluateFollowUp({ sentAt: inq.createdAt, validUntil: null, won: false, nudgesSent, now }, inqSettings);
    if (result.state !== "due") continue;

    due++;
    const base: RunItem = { quoteNumber: inq.projectName?.trim() || "(inquiry)", company: c.company, to: c.email, nudge: result.nudgeNumber, action: "skipped", kind: "inquiry" };

    if (accounts[c.id]?.optOutFollowUp) { skipped++; items.push({ ...base, reason: "opted out" }); continue; }
    if (!c.email) { skipped++; items.push({ ...base, reason: "no email on file" }); continue; }

    const email = buildInquiryFollowUpEmail({ company: c.company, contactName: c.contactName, salesName: inq.createdBy.name, projectName: inq.projectName ?? null });

    if (!inquiryLive) { previewed++; items.push({ ...base, action: "preview" }); continue; }
    if (sent >= SEND_CAP_PER_RUN) { skipped++; items.push({ ...base, reason: "per-run send cap reached" }); continue; }

    try {
      await sendEmail({ from, to: c.email, subject: email.subject, text: email.text, html: email.html, replyTo: inq.createdBy.email ?? undefined });

      const acct = accounts[c.id] ?? { history: [], conversations: [] };
      acct.inquiryFollowUp = { sent: [...(acct.inquiryFollowUp?.sent ?? []), { at: now.toISOString() }] };
      const entry: ConversationEntry = {
        id: randomUUID(),
        date: now.toISOString(),
        channel: "Email",
        contactPerson: c.contactName ?? c.company,
        message: `Automated check-in sent (constant communication #${result.nudgeNumber}).`,
        quoteNumber: null,
        nextFollowUp: null,
        loggedById: inq.createdById,
        loggedByName: inq.createdBy.name,
        createdAt: now.toISOString(),
      };
      acct.conversations = [...(acct.conversations ?? []), entry];
      accounts[c.id] = acct;
      accountsDirty = true;

      sent++;
      items.push({ ...base, action: "sent" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "send failed";
      errors.push(`${c.company} (inquiry): ${msg}`);
      items.push({ ...base, reason: "send failed" });
    }
  }

  if (accountsDirty) await saveAccountsRegistry(accounts);

  return {
    ranAt: now.toISOString(),
    live: effectiveLive,
    requestedLive: opts.live,
    reason,
    evaluated: quotes.length + inquiryByCustomer.size,
    due,
    sent,
    previewed,
    skipped,
    items,
    errors,
  };
}
