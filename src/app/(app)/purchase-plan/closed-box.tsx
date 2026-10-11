"use client";

import { useState } from "react";
import Link from "next/link";
import { XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ClosedPlanRow } from "@/lib/purchaser-plan";

/** Ten rows, then a word — the same as every long list on My Dashboard. */
const FIRST = 10;

const fmtDay = (ymd: string | null) => {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
};
const fmtStamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

/**
 * Rejected / Cancelled MRFs — the owner's *"make a separate box for
 * Rejected/Cancelled MRF."* Read-only: nothing here is being worked on. It says
 * what happened, who did it, when, and — for a rejected purchase — why.
 */
export function ClosedPlanBox({ rows }: { rows: ClosedPlanRow[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, FIRST);
  const hidden = rows.length - FIRST;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <XCircle className="h-4 w-4 text-red-600" />
          Rejected / Cancelled
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{rows.length}</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          MRFs that were cancelled, or whose purchase was rejected or cancelled in Purchasing. Most recent first.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No rejected or cancelled MRFs.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {["Order no.", "Ordered date", "Account holder", "MRF no.", "What happened", "By", "When"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left align-bottom font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((r) => (
                    <tr key={r.key} className="align-top hover:bg-accent/40">
                      <td className="whitespace-nowrap px-2.5 py-2">
                        <Link href={r.orderHref} className="font-mono text-xs font-semibold text-primary hover:underline" title={`Open order ${r.orderNo}`}>
                          {r.orderNo}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2">{fmtDay(r.orderedDate) ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2.5 py-2">{r.accountHolder}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 tabular-nums">
                        {/* A plain link, not <Link>: a full page load is what makes the browser scroll
              to the #mrf- anchor and light up the card with :target. */}
          <a href={r.mrfHref} className="font-semibold text-primary hover:underline" title={`Open MRF #${r.mrfNo}`}>
                          #{r.mrfNo}
                        </a>
                      </td>
                      <td className="px-2.5 py-2">
                        <Badge variant={r.outcome === "Purchase rejected" ? "destructive" : "secondary"} className="whitespace-nowrap font-normal">
                          {r.outcome}
                        </Badge>
                        {r.note && <div className="mt-0.5 max-w-[16rem] text-[11px] leading-tight text-muted-foreground">Reason: {r.note}</div>}
                      </td>
                      <td className="px-2.5 py-2">{r.byName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap px-2.5 py-2">{fmtStamp(r.at) ?? <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hidden > 0 && (
              <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-xs font-semibold text-primary hover:underline" aria-expanded={open}>
                {open ? "Show less" : `Show ${hidden} more`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
