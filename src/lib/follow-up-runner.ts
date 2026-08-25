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
import { evaluateFollowUp, sentAtFrom, nudgesSentFrom, lastNudgeAtFrom, smsNudgesSentFrom, lastSmsAtFrom } from "@/lib/follow-up";
import { getFollowUpSettings } from "@/lib/follow-up-settings";
import { getFollowUpTemplates } from "@/lib/follow-up-templates";
import { getAccountsRegistry, saveAccountsRegistry, type ConversationEntry } from "@/lib/account";
import { buildFollowUpEmail, buildInquiryFollowUpEmail, templateForNudge } from "@/lib/follow-up-email";
import { buildFollowUpSms, smsTemplateForNudge } from "@/lib/follow-up-sms";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { sendSms, smsConfigured, normalizePhMobile } from "@/lib/sms/semaphore";

/** Money formatter shared by the SMS builder (email formats its own internally). */
function money(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: 2 }).format(total);
  } catch {
    return `${currency} ${total.toLocaleString()}`;
  }
}

export type RunAction = "sent" | "preview" | "skipped";

export interface RunItem {
  quoteNumber: string; // quote number, or the inquiry's project label for inquiry check-ins
  company: string;
  to: string | null;
  nudge: number;
  action: RunAction;
  reason?: string;
  kind?: "quote" | "inquiry";
  /** Which channel this item is for — defaults to Email when absent. */
  channel?: "Email" | "SMS";
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
  /** SMS channel counters (independent of the email due/sent above). */
  smsDue: number;
  smsSent: number;
  smsPreviewed: number;
  smsSkipped: number;
  items: RunItem[];
  errors: string[];
}


/**
 * Run the follow-up pass. `live` is the caller's intent; the actual send decision
 * also requires the enabled flag, a Resend key, and a configured sender.
 */
export async function runFollowUps(opts: {
  now?: Date;
  live: boolean;
  /** Restrict the send to these quote ids only (manual "send to selected"). When
   *  set, the inquiry check-in pass is skipped. */
  onlyQuoteIds?: string[];
  /** Manual send: ignore the enabled / dry-run switches (still needs Resend keys).
   *  Used by the "send to selected" warm-up action, not the daily scheduler. */
  ignoreEnabledDryRun?: boolean;
}): Promise<FollowUpRunResult> {
  const now = opts.now ?? new Date();
  const settings = await getFollowUpSettings();
  const templates = await getFollowUpTemplates();
  const targeted = Array.isArray(opts.onlyQuoteIds);
  // Emails sent per run — quote follow-ups + inquiry check-ins share this budget.
  // A targeted manual send (admin hand-picked the recipients) ignores the cap.
  // A targeted manual send ignores the cap; maxPerRun of 0 means "no limit".
  const sendCap = targeted || settings.maxPerRun <= 0 ? Number.POSITIVE_INFINITY : settings.maxPerRun;
  const campaignStartAt = settings.campaignStartAt ? new Date(settings.campaignStartAt) : null;

  const canSend = emailConfigured() && !!config.followUpFromEmail;
  const switchesOk = opts.ignoreEnabledDryRun || (settings.enabled && !settings.dryRun);
  const effectiveLive = opts.live && switchesOk && canSend;
  let reason: string | undefined;
  if (opts.live && !effectiveLive) {
    reason = !switchesOk
      ? !settings.enabled
        ? "automated sending is disabled"
        : "dry-run is on"
      : !emailConfigured()
        ? "no Resend API key configured"
        : "no sender address configured (FOLLOW_UP_FROM_EMAIL)";
  }

  const quotes = await prisma.quotation.findMany({
    where: {
      status: "SENT",
      inquiry: { status: { notIn: ["WON", "LOST"] } },
      ...(targeted ? { id: { in: opts.onlyQuoteIds } } : {}),
    },
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
    const lastIso = lastNudgeAtFrom(q.classification);
    const result = evaluateFollowUp(
      {
        sentAt,
        validUntil: q.validUntil ?? null,
        won: false,
        nudgesSent: nudgesSentFrom(q.classification),
        now,
        campaignStartAt,
        lastSentAt: lastIso ? new Date(lastIso) : null,
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

    if (sent >= sendCap) {
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
  // Skipped entirely for a targeted quote send.
  let inquiryEvaluated = 0;
  if (!targeted) {
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
  inquiryEvaluated = inquiryByCustomer.size;

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
    if (sent >= sendCap) { skipped++; items.push({ ...base, reason: "per-run send cap reached" }); continue; }

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
  } // end inquiry pass (skipped for targeted sends)

  // --- SMS follow-up pass (independent channel, same cadence) --------------
  // Texts due clients who have a phone number, tracked separately from email
  // (its own `followUp.smsSent` stamps) so the two channels never block each
  // other. Own enable + dry-run + per-run cap. Skipped for targeted sends.
  let smsDue = 0;
  let smsSent = 0;
  let smsPreviewed = 0;
  let smsSkipped = 0;
  if (!targeted && settings.smsEnabled) {
    const smsLive = opts.live && settings.smsEnabled && !settings.smsDryRun && smsConfigured();
    const smsCap = settings.smsMaxPerRun;

    // Phase 1 — evaluate everyone first (no I/O): queue up who actually gets a
    // text this run, up to the per-run cap.
    const sendQueue: { q: (typeof quotes)[number]; phone: string; message: string; nudgeNumber: number; base: RunItem }[] = [];
    for (const q of quotes) {
      const sentIso = sentAtFrom(q.classification);
      const sentAt = sentIso ? new Date(sentIso) : q.createdAt;
      const lastIso = lastSmsAtFrom(q.classification);
      const result = evaluateFollowUp(
        {
          sentAt,
          validUntil: q.validUntil ?? null,
          won: false,
          nudgesSent: smsNudgesSentFrom(q.classification),
          now,
          campaignStartAt,
          lastSentAt: lastIso ? new Date(lastIso) : null,
        },
        settings,
      );
      if (result.state !== "due") continue;

      smsDue++;
      const c = q.inquiry.customer;
      const phone = normalizePhMobile(c.phone);
      const base: RunItem = { quoteNumber: q.quoteNumber, company: c.company, to: phone, nudge: result.nudgeNumber, action: "skipped", kind: "quote", channel: "SMS" };

      if (accounts[c.id]?.optOutFollowUp) {
        smsSkipped++;
        items.push({ ...base, reason: "opted out" });
        continue;
      }
      if (!phone) {
        smsSkipped++;
        items.push({ ...base, reason: "no valid mobile on file" });
        continue;
      }

      const message = buildFollowUpSms({
        company: c.company,
        contactName: c.contactName,
        quoteNumber: q.quoteNumber,
        total: money(Number(q.total), q.currency),
        salesName: q.preparedBy.name,
        quoteUrl: `${config.appUrl}/q/${q.id}`,
        template: smsTemplateForNudge(settings.smsTemplates, result.nudgeNumber),
      });

      if (!smsLive) {
        smsPreviewed++;
        items.push({ ...base, action: "preview" });
        continue;
      }
      if (sendQueue.length >= smsCap) {
        smsSkipped++;
        items.push({ ...base, reason: "per-run SMS cap reached" });
        continue;
      }
      sendQueue.push({ q, phone, message, nudgeNumber: result.nudgeNumber, base });
    }

    // Phase 2 — send in small parallel batches. One-at-a-time sending couldn't
    // finish a full run inside the serverless time budget (the function was
    // killed mid-loop, so only the first ~20 texts of a 100-cap run went out).
    // Each task still stamps its own quote immediately after its send, so a
    // mid-run crash never repeats a nudge.
    const SMS_CONCURRENCY = 8;
    for (let i = 0; i < sendQueue.length; i += SMS_CONCURRENCY) {
      const batch = sendQueue.slice(i, i + SMS_CONCURRENCY);
      await Promise.all(batch.map(async ({ q, phone, message, nudgeNumber, base }) => {
        const c = q.inquiry.customer;
        try {
          await sendSms({ to: phone, message });

          // Record the SMS nudge on the quote (separate array) so it's never repeated.
          const cls = (q.classification as Record<string, unknown>) ?? {};
          const fu = (cls.followUp as Record<string, unknown> | undefined) ?? {};
          const smsArr = Array.isArray(fu.smsSent) ? (fu.smsSent as unknown[]) : [];
          smsArr.push({ nudge: nudgeNumber, at: now.toISOString(), channel: "SMS", to: phone });
          await prisma.quotation.update({
            where: { id: q.id },
            data: { classification: { ...cls, followUp: { ...fu, smsSent: smsArr } } as Prisma.InputJsonObject },
          });

          // Log it into the client's conversation history.
          const entry: ConversationEntry = {
            id: randomUUID(),
            date: now.toISOString(),
            channel: "SMS",
            contactPerson: c.contactName ?? c.company,
            message: `Automated follow-up SMS sent (nudge #${nudgeNumber}) for quotation ${q.quoteNumber}.`,
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

          smsSent++;
          items.push({ ...base, action: "sent" });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "sms failed";
          errors.push(`${q.quoteNumber} (SMS): ${msg}`);
          items.push({ ...base, reason: "send failed" });
        }
      }));
    }
  }

  if (accountsDirty) await saveAccountsRegistry(accounts);

  return {
    ranAt: now.toISOString(),
    live: effectiveLive,
    requestedLive: opts.live,
    reason,
    evaluated: quotes.length + inquiryEvaluated,
    due,
    sent,
    previewed,
    skipped,
    smsDue,
    smsSent,
    smsPreviewed,
    smsSkipped,
    items,
    errors,
  };
}
