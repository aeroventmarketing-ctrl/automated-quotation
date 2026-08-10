"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { sendSelectedFollowUpsAction } from "./actions";

export interface DueRow {
  id: string;
  company: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  quoteNumber: string;
  amountLabel: string;
  sentLabel: string;
  days: number;
  nudge: number;
  maxNudges: number;
  salesName: string;
}

interface SendResult {
  live: boolean;
  reason?: string;
  sent: number;
  skipped: number;
  errors: string[];
}

/**
 * The "Follow-ups due" list. For admins it adds selection checkboxes and a
 * "Send to selected" button — the warm-up control: hand-pick a few clients and
 * email just them now (bypasses the daily on/off + dry-run, still needs Resend
 * configured). Non-admins get the same read-only list without the controls.
 */
export function DueTable({ rows, canSend, canView }: { rows: DueRow[]; canSend: boolean; canView: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const emailable = useMemo(() => rows.filter((r) => r.email), [rows]);
  const allEmailableSelected = emailable.length > 0 && emailable.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allEmailableSelected ? new Set() : new Set(emailable.map((r) => r.id)));
  }

  async function send() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Send follow-up emails to ${ids.length} selected client${ids.length > 1 ? "s" : ""} now? This emails real clients.`)) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await sendSelectedFollowUpsAction(ids);
      setResult({ live: r.live, reason: r.reason, sent: r.sent, skipped: r.skipped, errors: r.errors });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {canSend && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy || selected.size === 0} onClick={send}>
            {busy ? "Sending…" : `Send to selected (${selected.size})`}
          </Button>
          <span className="text-xs text-muted-foreground">
            Warm-up: tick a few clients and send just them now. Sends immediately (even while the daily
            scheduler is off) — needs the Resend key + sender configured.
          </span>
        </div>
      )}

      {result && (
        <div className={`rounded-md border px-3 py-2 text-xs ${result.live ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
          {result.live
            ? `Sent ${result.sent}${result.skipped ? `, skipped ${result.skipped}` : ""}.`
            : `Nothing sent — ${result.reason ?? "sending not configured"}.`}
          {result.errors.length > 0 && ` ${result.errors.length} error(s): ${result.errors.slice(0, 2).join("; ")}`}
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {canSend && (
                <TableHead className="w-8">
                  <input type="checkbox" aria-label="Select all with email" checked={allEmailableSelected} onChange={toggleAll} disabled={busy || emailable.length === 0} />
                </TableHead>
              )}
              <TableHead>Client</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Quote</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead>Nudge</TableHead>
              <TableHead>Sales</TableHead>
              <TableHead className="text-right">Link</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                {canSend && (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.company}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      disabled={busy || !r.email}
                      title={r.email ? undefined : "No email on file"}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <div className="font-medium">{r.company}</div>
                  {r.contactName && <div className="text-xs text-muted-foreground">{r.contactName}</div>}
                </TableCell>
                <TableCell className="text-xs">
                  {r.email ? <div>{r.email}</div> : null}
                  {r.phone ? <div className="text-muted-foreground">{r.phone}</div> : null}
                  {!r.email && !r.phone && <span className="text-muted-foreground">No contact on file</span>}
                  {!r.email && r.phone && <span className="text-amber-600">No email</span>}
                </TableCell>
                <TableCell>
                  <Link href={`/quotations/${r.id}`} className="font-medium text-primary hover:underline">{r.quoteNumber}</Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.amountLabel}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">{r.sentLabel}</TableCell>
                <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                <TableCell>
                  <Badge variant={r.nudge >= r.maxNudges ? "destructive" : "default"}>#{r.nudge}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.salesName}</TableCell>
                <TableCell className="text-right">
                  {canView && (
                    <a href={`/api/quotations/${r.id}/pdf`} target="_blank" rel="noopener noreferrer" title="View quotation (PDF)" aria-label="View quotation" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                      <Eye className="h-4 w-4" />
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
