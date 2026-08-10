"use client";

/**
 * Management "Recent activity" card — collapsible, grouped by day (Today /
 * Yesterday / …), listing reconciled vouchers, MRFs, requisitions, POs and other
 * events from the last few days. Rows are clickable and open the underlying
 * record. Display-only.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { RecentActivityDay, ActivityKind } from "@/lib/recent-activity";

const CURRENCY = "PHP";

const KIND_VARIANT: Record<ActivityKind, "default" | "secondary" | "warning" | "success"> = {
  Requisition: "secondary",
  PO: "default",
  Reconciled: "success",
  Voucher: "warning",
  MRF: "secondary",
  Other: "secondary",
};

const fmtTime = (iso: string) => {
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
  } catch {
    return "";
  }
};

export function RecentActivityCard({ days }: { days: RecentActivityDay[] }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const total = days.reduce((s, d) => s + d.items.length, 0);

  return (
    <Card className="mt-4 shadow-sm">
      <CardHeader className="pb-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <CardTitle className="flex flex-1 items-center gap-2 text-sm">
            <History className="h-4 w-4 text-muted-foreground" /> Recent activity
            <span className="text-xs font-normal text-muted-foreground">(last 3 days · {total})</span>
          </CardTitle>
          <span className="shrink-0 text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {total === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No requisitions, POs, vouchers or MRFs in the last 3 days.</p>
          ) : (
            days.map((day) => (
              <div key={day.ymd}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day.label}</span>
                  <span className="text-[11px] text-muted-foreground">· {day.items.length}</span>
                </div>
                <div className="overflow-hidden rounded-md border">
                  {day.items.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => router.push(it.href)}
                      className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <Badge variant={KIND_VARIANT[it.kind]} className="w-28 shrink-0 justify-center">{it.label}</Badge>
                      <span className="w-24 shrink-0 font-medium tabular-nums text-red-600">{it.ref}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{it.detail}{it.who ? ` · ${it.who}` : ""}</span>
                      {it.amount != null && <span className="shrink-0 tabular-nums">{formatCurrency(it.amount, CURRENCY)}</span>}
                      <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">{fmtTime(it.at)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      )}
    </Card>
  );
}
