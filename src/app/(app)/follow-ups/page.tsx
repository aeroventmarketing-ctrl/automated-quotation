import { Info } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { evaluateFollowUp, sentAtFrom, nudgesSentFrom, lastNudgeAtFrom } from "@/lib/follow-up";
import { getFollowUpSettings, scheduleLabel } from "@/lib/follow-up-settings";
import { config } from "@/lib/config";
import { emailConfigured } from "@/lib/email/resend";
import { DueTable, type DueRow } from "./due-table";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);

const num = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

/**
 * "Follow-ups due" — the Sales/CRM daily worklist. It runs the follow-up rules
 * engine over every sent-but-open quote and lists the ones due for a nudge.
 *
 * DRY RUN: this page only *recommends* follow-ups; automatic sending is not
 * enabled yet, so nothing goes to any client from here. Each row links to the
 * quote and the shareable client link so a salesperson can follow up by hand.
 */
export default async function FollowUpsPage() {
  const now = new Date();
  const settings = await getFollowUpSettings();
  // Eye view (open the quotation PDF) for Sales, admins and the Payment Approver.
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const canView = isAdmin(viewer) || viewer?.role === "SALES" || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "payment_approver"));

  // Sent quotes whose inquiry is still open (not won/lost).
  const quotes = await prisma.quotation.findMany({
    where: { status: "SENT", inquiry: { status: { notIn: ["WON", "LOST"] } } },
    include: { inquiry: { include: { customer: true } }, preparedBy: true },
    orderBy: { createdAt: "asc" },
  });

  const campaignStartAt = settings.campaignStartAt ? new Date(settings.campaignStartAt) : null;
  const rows = quotes
    .map((q) => {
      const sentIso = sentAtFrom(q.classification);
      const sentAt = sentIso ? new Date(sentIso) : q.createdAt;
      const lastIso = lastNudgeAtFrom(q.classification);
      const result = evaluateFollowUp(
        {
          sentAt,
          validUntil: q.validUntil ?? null,
          won: false, // WON/LOST inquiries are already filtered out
          nudgesSent: nudgesSentFrom(q.classification),
          now,
          campaignStartAt,
          lastSentAt: lastIso ? new Date(lastIso) : null,
        },
        settings,
      );
      return { q, sentAt, result };
    })
    .filter((r) => r.result.state === "due")
    .sort((a, b) => b.result.daysSinceSent - a.result.daysSinceSent);

  const cadence = settings.offsetsDays.join(", ");
  const canSend = isAdmin(viewer);
  // Real send status (mirrors the Admin follow-up card), so this page never
  // shows a stale "dry run" message once sending is actually live.
  const senderReady = emailConfigured() && !!config.followUpFromEmail;
  const liveSending = settings.enabled && !settings.dryRun && senderReady;
  const noKeys = !senderReady;
  const dueRows: DueRow[] = rows.map(({ q, sentAt, result }) => {
    const c = q.inquiry.customer;
    return {
      id: q.id,
      company: c.company,
      contactName: c.contactName,
      email: c.email,
      phone: c.phone,
      quoteNumber: q.quoteNumber,
      amount: Number(q.total),
      amountLabel: num(Number(q.total)),
      sentMs: sentAt.getTime(),
      sentLabel: fmtDate(sentAt),
      days: result.daysSinceSent,
      nudge: result.nudgeNumber,
      maxNudges: settings.maxNudges,
      salesName: q.preparedBy.name,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Follow-ups due</h1>
          <p className="text-sm text-muted-foreground">
            Clients to chase today — sent quotes that haven&apos;t been won yet.
          </p>
        </div>
        <Badge variant="secondary" className="h-fit">
          {rows.length} due
        </Badge>
      </div>

      {/* Live status — reflects the real Admin settings (not a fixed message). */}
      {liveSending ? (
        <div className="flex items-start gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
          <p className="text-emerald-800">
            <span className="font-medium">Live sending is ON.</span>{" "}
            The scheduler emails due clients automatically <strong>{scheduleLabel(settings)}</strong>,
            up to <strong>{settings.maxPerRun}</strong> per run, on a day&nbsp;{cadence} cadence (max{" "}
            {settings.maxNudges} nudges). You can also send some now with <em>Send to selected</em> below.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-md border border-dashed bg-muted/40 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">
              {noKeys
                ? "Not connected — the email sender isn't configured yet."
                : "Automatic sending is off — nothing is emailed automatically."}
            </span>{" "}
            This list recommends who to follow up, on a day&nbsp;{cadence} cadence after a quote is sent
            (max {settings.maxNudges} nudges), and stops once a deal is won or the quote expires.
            {noKeys
              ? " Add the Resend key + sender, then turn on Automatic follow-up emails in Admin."
              : " Turn on Automatic follow-up emails (and turn off Dry run) in Admin to send on schedule."}
          </p>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No follow-ups due right now. 🎉
            </p>
          ) : (
            <DueTable rows={dueRows} canSend={canSend} canView={canView} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
