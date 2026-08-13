import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { ScheduledCampaign, CampaignSendRecord, AbTest } from "@/lib/marketing-store";
import type { ContactLite } from "@/lib/marketing";
import { cancelScheduledCampaignAction, cancelAbTestAction } from "./actions";
import { CancelScheduledButton } from "./cancel-scheduled-button";
import { CampaignResults } from "./campaign-results";

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-sky-100 text-sky-700",
  testing: "bg-sky-100 text-sky-700",
  sent: "bg-emerald-100 text-emerald-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};

const badge = (status: string) => (
  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_STYLE[status] ?? "bg-muted text-muted-foreground"}`}>{status}</span>
);

/**
 * Scheduled campaigns, A/B subject tests, and delivered-campaign results (with an
 * open/click recipient drill-down). Read-only apart from cancelling a pending
 * schedule or an in-progress A/B test.
 */
export function CampaignActivity({
  scheduled,
  sends,
  contacts,
  abTests,
}: {
  scheduled: ScheduledCampaign[];
  sends: CampaignSendRecord[];
  contacts: Record<string, ContactLite>;
  abTests: AbTest[];
}) {
  const pending = scheduled.filter((s) => s.status === "pending");
  const pastSchedules = scheduled.filter((s) => s.status !== "pending");
  const openRate = (sendId?: string) => {
    const rec = sendId ? sends.find((s) => s.id === sendId) : undefined;
    return rec ? { opens: rec.openedIds.length, sent: rec.sent } : { opens: 0, sent: 0 };
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Scheduled */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Scheduled campaigns</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pending.length === 0 && pastSchedules.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing scheduled. Use <strong>Schedule send</strong> in the builder to queue a campaign.</p>
            ) : (
              <div className="space-y-1.5">
                {[...pending, ...pastSchedules].map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.name}</div>
                      <div className="text-muted-foreground">
                        {s.status === "pending" ? "Sends" : s.status === "sent" ? "Sent" : s.status}
                        {" "}{formatDateTime(new Date(s.status === "sent" && s.sentAt ? s.sentAt : s.scheduledFor))}
                        {" · "}{s.audience === "list" ? "Marketing list" : "All clients"}
                        {s.status === "sent" && s.result ? ` · ${s.result.sent} sent` : ""}
                        {s.status === "failed" && s.error ? ` · ${s.error}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {badge(s.status)}
                      {s.status === "pending" && <CancelScheduledButton id={s.id} onCancel={cancelScheduledCampaignAction} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* A/B subject tests */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">A/B subject tests</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {abTests.length === 0 ? (
              <p className="text-xs text-muted-foreground">No A/B tests. Turn on <strong>A/B test the subject</strong> in the builder to trial two subject lines.</p>
            ) : (
              <div className="space-y-1.5">
                {abTests.map((t) => {
                  const a = openRate(t.sendIdA);
                  const b = openRate(t.sendIdB);
                  return (
                    <div key={t.id} className="space-y-1 rounded-md border px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{t.name}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          {badge(t.status)}
                          {t.status === "testing" && <CancelScheduledButton id={t.id} onCancel={cancelAbTestAction} />}
                        </div>
                      </div>
                      <div className={t.winner === "A" ? "font-semibold text-emerald-700" : ""}>
                        A: “{t.subjectA}” — {a.opens}/{a.sent} opened ({pct(a.opens, a.sent)}%){t.winner === "A" ? " · winner" : ""}
                      </div>
                      <div className={t.winner === "B" ? "font-semibold text-emerald-700" : ""}>
                        B: “{t.subjectB}” — {b.opens}/{b.sent} opened ({pct(b.opens, b.sent)}%){t.winner === "B" ? " · winner" : ""}
                      </div>
                      <div className="text-muted-foreground">
                        {t.status === "testing" && `Picks the winner ${formatDateTime(new Date(t.decideAt))} → sends to the rest`}
                        {t.status === "completed" && `Winner sent to ${t.remainderCount ?? 0} more client${(t.remainderCount ?? 0) === 1 ? "" : "s"}`}
                        {t.status === "failed" && (t.error || "Failed")}
                        {t.status === "cancelled" && "Cancelled before the winner was sent"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CampaignResults sends={sends} contacts={contacts} />
    </div>
  );
}
