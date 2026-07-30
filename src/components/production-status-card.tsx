"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductionStatus, ProductionRow } from "@/lib/production-status";
import { useAlertsSuppressed } from "@/components/alert-golive-context";

type Kind = "onTime" | "nearDue" | "late";

const KIND = {
  late: { label: "Late Production", anchor: "prod-late", dot: "#d03b3b", text: "text-destructive" },
  nearDue: { label: "Near Due Production", anchor: "prod-near", dot: "#eda100", text: "text-amber-600" },
  onTime: { label: "On time Production", anchor: "prod-ontime", dot: "#0ca30c", text: "text-emerald-600" },
} as const;

const fmtDue = (due: string) => {
  const [y, m, d] = due.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

function StatusRow({ r, kind, maskClient }: { r: ProductionRow; kind: Kind; maskClient: boolean }) {
  const tag =
    kind === "late" ? `${-r.days}d overdue` : r.days === 0 ? "Due today" : kind === "nearDue" ? `Due in ${r.days}d` : `${r.days}d left`;
  const cls =
    kind === "late"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : kind === "nearDue"
      ? "border-amber-400 bg-amber-50 text-amber-700"
      : "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  return (
    <li>
      <Link href={`/orders/${r.orderId}`} className="-mx-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-1.5 text-sm hover:bg-accent">
        <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{tag}</span>
        <span className="font-medium">{r.dept}</span>
        {/* The order ref (quote no.) is an internal id, safe to show; the client
            company / project are masked for restricted production roles. */}
        <span className="min-w-0 truncate text-muted-foreground">{maskClient ? r.quoteNumber : `${r.company}${r.projectName ? ` · ${r.projectName}` : ""} · ${r.quoteNumber}`}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">due {fmtDue(r.dueAt)}</span>
      </Link>
    </li>
  );
}

function Section({ kind, rows, maskClient }: { kind: Kind; rows: ProductionRow[]; maskClient: boolean }) {
  const k = KIND[kind];
  if (rows.length === 0) return null;
  return (
    <div id={k.anchor} className="scroll-mt-20 space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: k.dot }} /> {k.label} <span className="text-muted-foreground/70">({rows.length})</span>
      </div>
      <ul className="divide-y">
        {rows.slice(0, 8).map((r, i) => <StatusRow key={`${r.orderId}-${r.dept}-${i}`} r={r} kind={kind} maskClient={maskClient} />)}
        {rows.length > 8 && <li className="pt-1 text-xs text-muted-foreground">+ {rows.length - 8} more</li>}
      </ul>
    </div>
  );
}

/** Production-deadline snapshot: On time / Near due / Late, each clickable to
 *  the client's order. Shown across the dashboards. */
export function ProductionStatusCard({ status, maskClient = false }: { status: ProductionStatus; maskClient?: boolean }) {
  // Alerts go-live gate: keep the whole card hidden until the launch moment.
  const suppressed = useAlertsSuppressed();
  if (suppressed) return null;
  const total = status.onTime.length + status.nearDue.length + status.late.length;
  const tiles: { kind: Kind; count: number }[] = [
    { kind: "onTime", count: status.onTime.length },
    { kind: "nearDue", count: status.nearDue.length },
    { kind: "late", count: status.late.length },
  ];
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="h-4 w-4 text-muted-foreground" /> Production status</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="flex items-center gap-2 py-1 text-sm text-emerald-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/10">✓</span>
            No production job orders in progress.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {tiles.map((t) => {
                const k = KIND[t.kind];
                return (
                  <Link key={t.kind} href={t.count > 0 ? `#${k.anchor}` : "#"} className="rounded-lg outline-none">
                    <Card className={`h-full ${t.count > 0 ? "transition-colors hover:border-primary/40 hover:bg-accent" : "opacity-70"}`}>
                      <CardContent className="py-4">
                        <div className={`text-2xl font-bold tabular-nums leading-none ${t.count > 0 ? k.text : ""}`}>{t.count}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: k.dot }} /> {k.label}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Unfinished department job orders on live orders, by deadline. Click a row to open the client&rsquo;s order.</p>
            <div className="mt-2 space-y-4">
              <Section kind="late" rows={status.late} maskClient={maskClient} />
              <Section kind="nearDue" rows={status.nearDue} maskClient={maskClient} />
              <Section kind="onTime" rows={status.onTime} maskClient={maskClient} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
