"use client";

import { Fragment, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight, ChevronDown } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { CampaignSendRecord } from "@/lib/marketing-store";
import type { ContactLite } from "@/lib/marketing";

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

function ContactList({ ids, contacts, empty }: { ids: string[]; contacts: Record<string, ContactLite>; empty: string }) {
  if (ids.length === 0) return <p className="text-[11px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {ids.map((id) => {
        const c = contacts[id];
        const label = c ? (c.company || c.contactName || c.email || "—") : "(client removed)";
        return (
          <li key={id} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
            <span className="font-medium">{label}</span>
            {c?.email && <span className="text-muted-foreground">{c.email}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Delivered-campaign results with a per-campaign open/click recipient drill-down. */
export function CampaignResults({ sends, contacts }: { sends: CampaignSendRecord[]; contacts: Record<string, ContactLite> }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Campaign results</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {sends.length === 0 ? (
          <p className="text-xs text-muted-foreground">No campaigns sent yet. Opens and clicks show here after your first send.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] border-collapse text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Campaign</th>
                    <th className="w-14 py-1 px-1 text-right font-medium">Sent</th>
                    <th className="w-20 py-1 px-1 text-right font-medium">Opens</th>
                    <th className="w-20 py-1 px-1 text-right font-medium">Clicks</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {sends.map((s) => {
                    const opens = s.openedIds.length;
                    const clicks = s.clickedIds.length;
                    const isOpen = open === s.id;
                    return (
                      <Fragment key={s.id}>
                        <tr className="cursor-pointer border-b align-top hover:bg-accent/40" onClick={() => setOpen(isOpen ? null : s.id)}>
                          <td className="py-1 pr-2">
                            <div className="font-medium">{s.name || s.subject || "Campaign"}</div>
                            <div className="text-muted-foreground">{formatDateTime(new Date(s.sentAt))}{s.sentByName ? ` · ${s.sentByName}` : ""}</div>
                          </td>
                          <td className="py-1 px-1 text-right tabular-nums">{s.sent}</td>
                          <td className="py-1 px-1 text-right tabular-nums">{opens}<span className="text-muted-foreground"> ({pct(opens, s.sent)}%)</span></td>
                          <td className="py-1 px-1 text-right tabular-nums">{clicks}<span className="text-muted-foreground"> ({pct(clicks, s.sent)}%)</span></td>
                          <td className="py-1 pl-1 text-right text-muted-foreground">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b bg-muted/20">
                            <td colSpan={5} className="px-2 py-2">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <div className="mb-1 text-[11px] font-semibold text-emerald-700">Opened ({opens})</div>
                                  <ContactList ids={s.openedIds} contacts={contacts} empty="No opens recorded yet." />
                                </div>
                                <div>
                                  <div className="mb-1 text-[11px] font-semibold text-sky-700">Clicked ({clicks})</div>
                                  <ContactList ids={s.clickedIds} contacts={contacts} empty="No clicks recorded yet." />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">Click a campaign to see who opened and clicked. Opens are approximate — some mail clients block the tracking pixel or pre-load images.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
