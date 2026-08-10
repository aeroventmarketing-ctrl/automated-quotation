"use client";

import React, { useMemo, useState } from "react";
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
  amount: number;
  amountLabel: string;
  sentMs: number;
  sentLabel: string;
  days: number;
  nudge: number;
  maxNudges: number;
  salesName: string;
}

type SortKey = "days" | "sent" | "amount" | "company" | "nudge" | "sales";
type GroupKey = "none" | "company" | "sales" | "nudge";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "days", label: "Days waiting" },
  { key: "sent", label: "Sent date" },
  { key: "amount", label: "Amount" },
  { key: "company", label: "Client" },
  { key: "nudge", label: "Nudge" },
  { key: "sales", label: "Sales" },
];
const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "company", label: "Client" },
  { key: "sales", label: "Sales" },
  { key: "nudge", label: "Nudge" },
];

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
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [group, setGroup] = useState<GroupKey>("none");

  // Search across client, contact, email, phone, quote no. and sales.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/gi, "");
    const qCompact = compact(q);
    return rows.filter((r) => {
      if ([r.company, r.contactName, r.email, r.phone, r.quoteNumber, r.salesName].some((f) => (f ?? "").toLowerCase().includes(q))) return true;
      return qCompact.length > 0 && compact(r.quoteNumber).includes(qCompact);
    });
  }, [rows, query]);

  const sorted = useMemo(() => {
    const mul = dir === "asc" ? 1 : -1;
    const cmp = (a: DueRow, b: DueRow): number => {
      switch (sortKey) {
        case "sent": return (a.sentMs - b.sentMs) * mul;
        case "amount": return (a.amount - b.amount) * mul;
        case "company": return a.company.localeCompare(b.company) * mul;
        case "nudge": return (a.nudge - b.nudge) * mul;
        case "sales": return (a.salesName || "").localeCompare(b.salesName || "") * mul;
        default: return (a.days - b.days) * mul;
      }
    };
    return [...filtered].sort(cmp);
  }, [filtered, sortKey, dir]);

  const groupValue = (r: DueRow): string => {
    switch (group) {
      case "company": return r.company;
      case "sales": return r.salesName || "—";
      case "nudge": return `Nudge #${r.nudge}`;
      default: return "";
    }
  };
  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", rows: sorted }];
    const map = new Map<string, DueRow[]>();
    for (const r of sorted) {
      const k = groupValue(r);
      (map.get(k) ?? map.set(k, []).get(k)!).push(r);
    }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, group]);

  const cols = canSend ? 10 : 9;
  const emailable = useMemo(() => sorted.filter((r) => r.email), [sorted]);
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

      {/* Search / group / sort toolbar — same look & behavior as the other lists. */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search client, contact, email, quote, sales…"
          className="h-8 w-64 rounded-md border bg-background px-3 text-sm"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Group by
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            {GROUP_OPTIONS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Sort by
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            {SORT_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2.5 text-sm hover:bg-accent"
          title={dir === "asc" ? "Ascending" : "Descending"}
        >
          {dir === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>
        <span className="text-xs text-muted-foreground">{sorted.length} shown</span>
      </div>

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
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={cols} className="py-8 text-center text-sm text-muted-foreground">
                  {query ? <>No follow-ups match &ldquo;{query}&rdquo;.</> : "No follow-ups due right now. 🎉"}
                </TableCell>
              </TableRow>
            ) : (
              groups.map((g) => (
                <React.Fragment key={g.key}>
                  {group !== "none" && (
                    <TableRow className="bg-muted/40">
                      <TableCell colSpan={cols} className="py-1.5">
                        <span className="text-sm font-semibold">{g.key || "—"}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{g.rows.length} client{g.rows.length === 1 ? "" : "s"}</span>
                      </TableCell>
                    </TableRow>
                  )}
                  {g.rows.map((r) => (
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
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
