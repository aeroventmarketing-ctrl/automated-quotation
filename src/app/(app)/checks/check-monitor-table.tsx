"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CHECK_STATE_LABEL, needsAttention, type CheckWatchRow, type CheckWatchSummary } from "@/lib/check-monitor";
import { formatCheckNo } from "@/lib/voucher-check";
import { markCheckCleared, rescheduleCheck, unclearCheck } from "../orders/actions";

const TONE: Record<CheckWatchRow["state"], string> = {
  overdue: "border-destructive/40 bg-destructive/10 text-destructive",
  due: "border-amber-500/50 bg-amber-100 text-amber-800",
  soon: "border-amber-500/40 bg-amber-50 text-amber-700",
  scheduled: "border-border bg-muted/40 text-muted-foreground",
  cleared: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  undated: "border-border bg-muted/40 text-muted-foreground",
};

/** "in 3 days" / "today" / "5 days ago" — the thing the eye actually wants. */
function whenText(row: CheckWatchRow): string {
  if (row.state === "cleared") return row.clearedOn ? `cleared ${formatDate(row.clearedOn)}` : "cleared";
  if (row.daysLeft == null) return "no date";
  if (row.daysLeft === 0) return "today";
  return row.daysLeft > 0 ? `in ${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"}` : `${-row.daysLeft} day${row.daysLeft === -1 ? "" : "s"} ago`;
}

/**
 * The monitoring table, in two tabs — the owner's rule: *"Move the cleared check
 * to a separate tab once check is cleared."*
 *
 * Clearing and moving a date are **admin only**; everyone else who can see the
 * page sees the same schedule read-only.
 */
export function CheckMonitor({
  rows,
  summary,
  admin,
  todayYMD,
}: {
  rows: CheckWatchRow[];
  summary: CheckWatchSummary;
  admin: boolean;
  todayYMD: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"open" | "cleared">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Which row's form is open, and which kind.
  const [form, setForm] = useState<{ key: string; kind: "clear" | "move" } | null>(null);
  const [dateVal, setDateVal] = useState(todayYMD);
  const [reason, setReason] = useState("");

  const open = rows.filter((r) => r.state !== "cleared");
  const cleared = rows.filter((r) => r.state === "cleared");
  const shown = tab === "open" ? open : cleared;
  const keyOf = (r: CheckWatchRow) => `${r.prId}:${r.path}`;

  function openForm(r: CheckWatchRow, kind: "clear" | "move") {
    setForm({ key: keyOf(r), kind });
    setErr(null);
    setReason("");
    // Clearing defaults to today; moving defaults to the date it is on now.
    setDateVal(kind === "clear" ? todayYMD : r.clearingYMD ?? todayYMD);
  }

  async function run(key: string, fn: () => Promise<{ ok?: true; error?: string }>) {
    setBusy(key);
    setErr(null);
    try {
      const res = await fn();
      if (res.error) { setErr(res.error); return; }
      setForm(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div className={`rounded-md border px-3 py-2 ${tone ?? "bg-muted/30"}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Needs attention" value={String(summary.attention)} tone={summary.attention > 0 ? "border-amber-500/40 bg-amber-50 text-amber-800" : undefined} />
        <Stat label="Overdue" value={String(summary.overdue)} tone={summary.overdue > 0 ? "border-destructive/40 bg-destructive/10 text-destructive" : undefined} />
        <Stat label="Still to clear" value={formatCurrency(summary.openAmount, "PHP")} />
        <Stat label="Cleared" value={String(summary.cleared)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([["open", `Upcoming (${open.length})`], ["cleared", `Cleared (${cleared.length})`]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setTab(k); setForm(null); }}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${tab === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {tab === "open" ? "No checks are waiting to clear." : "No checks have been cleared yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[1240px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {/* The owner's own register columns, in their order and their
                    wording: Date · Company · Purchase Order Number · Check No. ·
                    Amount · Date Paid/Cleared · Form of Payment · Status · Remarks. */}
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Purchase Order Number</th>
                <th className="px-3 py-2 font-medium">Check No.</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Date Paid/Cleared</th>
                <th className="px-3 py-2 font-medium">Form of Payment</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Remarks</th>
                {admin && <th className="px-3 py-2 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const key = keyOf(r);
                const openForm_ = form?.key === key ? form : null;
                return (
                  <tr key={key} className="border-b align-top last:border-0">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.poDate ? formatDate(r.poDate) : "—"}</td>
                    <td className="px-3 py-2">{r.supplier || "—"}</td>
                    <td className="px-3 py-2">
                      <Link href={`/purchasing?req=${r.prId}`} className="text-primary underline-offset-2 hover:underline">
                        {r.poNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-medium tabular-nums">{formatCheckNo(r.checkNo) ?? <span className="text-muted-foreground">not read</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.amount != null ? formatCurrency(r.amount, "PHP") : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium tabular-nums">{r.clearingYMD ? formatDate(r.clearingYMD) : "—"}</div>
                      {/* How far off it is, which is the whole point of watching it. */}
                      <div className={`text-xs ${needsAttention(r.state) ? "font-medium text-amber-700" : "text-muted-foreground"}`}>{whenText(r)}</div>
                      {r.originalYMD && (
                        <div className="mt-0.5 text-xs text-amber-700">
                          moved from {formatDate(r.originalYMD)}
                          {r.moves > 1 ? ` · ${r.moves} times` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.form}</td>
                    <td className="px-3 py-2">
                      {/* The register's word for it, with the urgency that word
                          doesn't carry — "Check Clearing" is true of a check due
                          next month and of one three days overdue. */}
                      <div className="font-medium">{r.statusLabel}</div>
                      <span className={`mt-0.5 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${TONE[r.state]}`}>
                        {needsAttention(r.state) && <AlertTriangle className="h-3.5 w-3.5" />}
                        {r.state === "cleared" && <CheckCircle2 className="h-3.5 w-3.5" />}
                        {CHECK_STATE_LABEL[r.state]}
                      </span>
                      {r.state === "cleared" && r.clearedByName && (
                        <div className="mt-0.5 text-xs text-muted-foreground">by {r.clearedByName}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.remarks ?? ""}</td>
                    {admin && (
                      <td className="px-3 py-2">
                        {openForm_ ? (
                          <div className="ml-auto w-64 space-y-1.5 rounded-md border bg-background p-2 text-left">
                            <div className="text-xs font-medium">
                              {openForm_.kind === "clear" ? "Date the check cleared" : "New clearing date"}
                            </div>
                            <Input type="date" className="h-8" value={dateVal} onChange={(e) => setDateVal(e.target.value)} />
                            {openForm_.kind === "move" && (
                              <Input
                                className="h-8"
                                placeholder="Why — e.g. insufficient funds"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                              />
                            )}
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setForm(null)}>Cancel</Button>
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={busy === key || (openForm_.kind === "move" && !reason.trim())}
                                onClick={() =>
                                  run(key, () =>
                                    openForm_.kind === "clear"
                                      ? markCheckCleared(r.prId, r.path, { on: dateVal })
                                      : rescheduleCheck(r.prId, r.path, { to: dateVal, reason }),
                                  )
                                }
                              >
                                {busy === key ? "Saving…" : openForm_.kind === "clear" ? "Mark cleared" : "Move date"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            {r.state === "cleared" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={busy === key}
                                onClick={() => run(key, () => unclearCheck(r.prId, r.path))}
                                title="Put this check back on the watch list"
                              >
                                <Undo2 className="mr-1 h-3.5 w-3.5" /> Not cleared
                              </Button>
                            ) : (
                              <>
                                <Button size="sm" className="h-7 text-xs" onClick={() => openForm(r, "clear")}>
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Cleared
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => openForm(r, "move")}
                                  title="Move the clearing date — e.g. the account can't fund it yet"
                                >
                                  <CalendarClock className="mr-1 h-3.5 w-3.5" /> Move date
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
