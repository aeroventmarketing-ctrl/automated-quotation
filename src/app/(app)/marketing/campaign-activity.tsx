import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { ScheduledCampaign, CampaignSendRecord } from "@/lib/marketing-store";
import { cancelScheduledCampaignAction } from "./actions";
import { CancelScheduledButton } from "./cancel-scheduled-button";

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

const STATUS_STYLE: Record<ScheduledCampaign["status"], string> = {
  pending: "bg-sky-100 text-sky-700",
  sent: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};

/**
 * Scheduled campaigns (upcoming + history) and delivered-campaign results with
 * open / click tallies. Read-only apart from cancelling a pending schedule.
 */
export function CampaignActivity({ scheduled, sends }: { scheduled: ScheduledCampaign[]; sends: CampaignSendRecord[] }) {
  const pending = scheduled.filter((s) => s.status === "pending");
  const pastSchedules = scheduled.filter((s) => s.status !== "pending");

  return (
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
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_STYLE[s.status]}`}>{s.status}</span>
                    {s.status === "pending" && <CancelScheduledButton id={s.id} onCancel={cancelScheduledCampaignAction} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sent — results */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Campaign results</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {sends.length === 0 ? (
            <p className="text-xs text-muted-foreground">No campaigns sent yet. Opens and clicks show here after your first send.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Campaign</th>
                    <th className="w-16 py-1 px-1 text-right font-medium">Sent</th>
                    <th className="w-20 py-1 px-1 text-right font-medium">Opens</th>
                    <th className="w-20 py-1 px-1 text-right font-medium">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {sends.map((s) => {
                    const opens = s.openedIds.length;
                    const clicks = s.clickedIds.length;
                    return (
                      <tr key={s.id} className="border-b last:border-0 align-top">
                        <td className="py-1 pr-2">
                          <div className="font-medium">{s.name || s.subject || "Campaign"}</div>
                          <div className="text-muted-foreground">{formatDateTime(new Date(s.sentAt))}{s.sentByName ? ` · ${s.sentByName}` : ""}</div>
                        </td>
                        <td className="py-1 px-1 text-right tabular-nums">{s.sent}</td>
                        <td className="py-1 px-1 text-right tabular-nums">{opens}<span className="text-muted-foreground"> ({pct(opens, s.sent)}%)</span></td>
                        <td className="py-1 px-1 text-right tabular-nums">{clicks}<span className="text-muted-foreground"> ({pct(clicks, s.sent)}%)</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted-foreground">Opens are approximate — some mail clients block the tracking pixel or pre-load images.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
