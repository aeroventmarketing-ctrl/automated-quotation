"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PLAN_TYPES,
  PLAN_EDIT_FIELD_LABEL,
  PLAN_SORT_OPTIONS,
  PLAN_GROUP_OPTIONS,
  DUE_TONE_LABEL,
  planEditChange,
  purchaseDueTone,
  dueCountdown,
  groupPlan,
  purchaseDoneTone,
  doneSummary,
  type DueTone,
  type PlanEditField,
  type PlanGroupKey,
  type PlanSortKey,
  type SortDir,
  type PurchaserPlanRow,
} from "@/lib/purchaser-plan";
import { savePlanType, savePlanClientDue } from "./actions";

/** "Oct 13, 2026" — the sheet spells dates out; so does this. */
const fmtDay = (ymd: string | null) => {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
};
/** "Oct 11, 10:25 AM" — when somebody set a value. */
const fmtStamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** Status colour, by the Purchasing tab it names. */
const STATUS_VARIANT: Record<string, "secondary" | "warning" | "success" | "destructive"> = {
  Pending: "warning",
  Approved: "secondary",
  Budgeted: "success",
  Completed: "success",
  // After the goods are in stock — see `afterReceipt` in lib/purchaser-plan.
  "Received in stock · awaiting release": "success",
  "Partly released": "warning",
  "Released · awaiting confirmation": "secondary",
  Rejected: "destructive",
  Cancelled: "destructive",
};

const COLUMNS: { key: PlanSortKey; label: string }[] = [
  { key: "type", label: "Type" },
  { key: "orderNo", label: "Order no." },
  { key: "orderedDate", label: "Ordered date" },
  { key: "accountHolder", label: "Account holder" },
  { key: "mrfNo", label: "MRF no." },
  { key: "mrfStatus", label: "MRF status" },
  { key: "purchaseDue", label: "Purchase due date" },
  { key: "clientDue", label: "Client due date" },
];

/**
 * The owner's four colours. "Amber" is drawn in ORANGE shades: Tailwind's own
 * amber sits a hair away from yellow, and two bands nobody can tell apart at a
 * glance would defeat the point of having two.
 */
const TONE_CLASS: Record<DueTone, string> = {
  overdue: "border-red-400 bg-red-200 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  due3: "border-orange-400 bg-orange-200 text-orange-950 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
  due7: "border-yellow-400 bg-yellow-100 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  ontime: "border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};
/** Received after its due date: history, not an alarm — so grey, with the days in words. */
const LATE_CLASS = "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
const TONE_NAME: Record<DueTone, string> = { overdue: "Red", due3: "Amber", due7: "Yellow", ontime: "Green" };
const TONES: DueTone[] = ["overdue", "due3", "due7", "ontime"];

/** Rows shown before "Show N more" — the same ten as the Rejected / Cancelled box. */
const FIRST_ROWS = 10;

/** Per-viewer convenience: the last sort / group chosen, kept in this browser only. */
const VIEW_KEY = "purchase-plan:view";
type View = { sortKey: PlanSortKey; dir: SortDir; groupKey: PlanGroupKey };
const DEFAULT_VIEW: View = { sortKey: "purchaseDue", dir: "asc", groupKey: "none" };
const isSortKey = (v: unknown): v is PlanSortKey => COLUMNS.some((c) => c.key === v);
const isGroupKey = (v: unknown): v is PlanGroupKey => PLAN_GROUP_OPTIONS.some((g) => g.key === v);

/** Who last set a value, and when — the owner's "show who edited, date and time". */
function Stamp({ by, at }: { by: string | null; at: string | null }) {
  if (!by || !at) return null;
  return <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{by} · {fmtStamp(at)}</div>;
}

/**
 * Everyone who ever changed this field, newest first — the owner's *"Record
 * every person who made the edit for tracking purposes."* The stamp above shows
 * the latest; this opens the whole trail, which is kept append-only.
 */
function History({ row, field }: { row: PurchaserPlanRow; field: PlanEditField }) {
  const [open, setOpen] = useState(false);
  const mine = row.edits.filter((e) => e.field === field);
  if (mine.length === 0) return null;
  return (
    <div className="mt-0.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-[10px] font-medium text-primary hover:underline" aria-expanded={open} aria-label={`${PLAN_EDIT_FIELD_LABEL[field]} history for MRF #${row.mrfNo}`}>
        {open ? "Hide history" : `History (${mine.length})`}
      </button>
      {open && (
        <ol className="mt-1 space-y-0.5 border-l-2 border-muted pl-2 text-[10px] leading-tight text-muted-foreground">
          {mine.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span className="text-foreground">{planEditChange(e)}</span>
              <br />
              {e.byName} · {fmtStamp(e.at)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function PurchaserPlanTable({
  rows: initial,
  canEditType,
  canEditClientDue,
  tableMissing,
  todayYMD,
}: {
  rows: PurchaserPlanRow[];
  canEditType: boolean;
  canEditClientDue: boolean;
  tableMissing: boolean;
  /** Today in Manila, from the server — so every viewer's colours agree. */
  todayYMD: string;
}) {
  // Saved values are patched in place, so a change shows at once without a reload.
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ key: string; msg: string } | null>(null);

  // Restore this viewer's last sort / group. Browser storage can be missing or
  // refuse (private window, blocked site data) — then the default simply stands.
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
      if (v && isSortKey(v.sortKey) && (v.dir === "asc" || v.dir === "desc") && isGroupKey(v.groupKey)) setView(v);
    } catch { /* default stands */ }
  }, []);
  const update = (patchView: Partial<View>) =>
    setView((v) => {
      const next = { ...v, ...patchView };
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(next)); } catch { /* not remembered, still applied */ }
      return next;
    });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? rows.filter((r) =>
          [r.orderNo, r.accountHolder, r.mrfNo, r.mrfStatus, PLAN_TYPES.find((t) => t.key === r.type)?.label ?? ""]
            .join("  ")
            .toLowerCase()
            .includes(q),
        )
      : rows;
  }, [rows, query]);
  const groups = useMemo(() => groupPlan(filtered, view.groupKey, view.sortKey, view.dir), [filtered, view]);

  // Ten rows, then "Show N more" — the owner: "show the 10 soon to due rows with
  // show more button at the bottom". The first ten in whatever order is chosen
  // (by default the soonest still-owed purchases); with grouping on, it is the
  // first ten rows across the groups, under their own headings.
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, filtered.length - FIRST_ROWS);
  const shownGroups = useMemo(() => {
    if (expanded || hiddenCount === 0) return groups;
    let left = FIRST_ROWS;
    const out: typeof groups = [];
    for (const g of groups) {
      if (left <= 0) break;
      const rs = g.rows.slice(0, left);
      out.push({ ...g, rows: rs });
      left -= rs.length;
    }
    return out;
  }, [groups, expanded, hiddenCount]);

  function patch(key: string, fields: Partial<PurchaserPlanRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...fields } : r)));
  }

  async function setType(r: PurchaserPlanRow, value: string) {
    setBusy(`${r.key}:type`); setErr(null);
    const res = await savePlanType(r.quotationId, r.mrfId, value);
    setBusy(null);
    if (!res.ok) { setErr({ key: r.key, msg: res.error }); return; }
    if (!res.edit) return; // unchanged — nothing was written, nothing to show
    patch(r.key, { type: (value || null) as PurchaserPlanRow["type"], typeByName: res.byName, typeAt: res.at, edits: [res.edit, ...r.edits] });
  }

  async function setClientDue(r: PurchaserPlanRow, value: string) {
    if ((r.clientDue ?? "") === value) return;
    setBusy(`${r.key}:due`); setErr(null);
    const res = await savePlanClientDue(r.quotationId, r.mrfId, value);
    setBusy(null);
    if (!res.ok) { setErr({ key: r.key, msg: res.error }); return; }
    if (!res.edit) return;
    patch(r.key, { clientDue: value || null, clientDueByName: res.byName, clientDueAt: res.at, edits: [res.edit, ...r.edits] });
  }

  // A header click is the same control as the Sort-by box: the same column again
  // flips the direction, a new column starts ascending.
  const header = (c: { key: PlanSortKey; label: string }) => {
    const active = view.sortKey === c.key;
    return (
      <th key={c.key} className="px-2.5 py-2 text-left align-bottom font-semibold" aria-sort={active ? (view.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className={`inline-flex items-center gap-1 text-left hover:text-primary ${active ? "text-foreground" : ""}`}
          onClick={() => update(active ? { dir: view.dir === "asc" ? "desc" : "asc" } : { sortKey: c.key, dir: "asc" })}
          title={`Sort by ${c.label}`}
        >
          {c.label}
          {active && (view.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
        </button>
      </th>
    );
  };

  const row = (r: PurchaserPlanRow) => {
    const tone = purchaseDueTone(r.purchaseDue, todayYMD);
    return (
      <tr key={r.key} className="align-top hover:bg-accent/40">
        <td className="px-2.5 py-2">
          {canEditType ? (
            <select
              value={r.type ?? ""}
              disabled={busy === `${r.key}:type`}
              onChange={(e) => setType(r, e.target.value)}
              className="h-8 w-auto rounded-md border bg-background px-2 text-sm"
              aria-label={`Type for MRF #${r.mrfNo}`}
            >
              <option value="">—</option>
              {PLAN_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          ) : (
            <span>{PLAN_TYPES.find((t) => t.key === r.type)?.label ?? "—"}</span>
          )}
          <Stamp by={r.typeByName} at={r.typeAt} />
          <History row={r} field="type" />
        </td>
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
        <td className="px-2.5 py-2"><Badge variant={STATUS_VARIANT[r.mrfStatus] ?? "secondary"} className="max-w-[11rem] whitespace-normal text-left font-normal leading-tight">{r.mrfStatus}</Badge></td>
        <td className="px-2.5 py-2">
          {r.receivedOn ? (
            // Received into stock: the countdown is over. Say how it went instead.
            <>
              <span
                className={`inline-block whitespace-nowrap rounded-md border px-2 py-0.5 font-medium ${purchaseDoneTone(r.purchaseDue, r.receivedOn) === "late" ? LATE_CLASS : TONE_CLASS.ontime}`}
                title={r.purchaseDue ? `Due ${fmtDay(r.purchaseDue)}` : "No due date was set"}
                data-tone={`received-${purchaseDoneTone(r.purchaseDue, r.receivedOn)}`}
              >
                {fmtDay(r.purchaseDue) ?? "—"}
              </span>
              <div className={`mt-0.5 max-w-[9rem] text-[10px] leading-tight ${purchaseDoneTone(r.purchaseDue, r.receivedOn) === "late" ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                Received {fmtDay(r.receivedOn)} · {doneSummary(r.purchaseDue, r.receivedOn)}
              </div>
            </>
          ) : r.purchaseDue && tone ? (
            <>
              <span
                className={`inline-block whitespace-nowrap rounded-md border px-2 py-0.5 font-medium ${TONE_CLASS[tone]}`}
                title={`${TONE_NAME[tone]} — ${DUE_TONE_LABEL[tone]}`}
                data-tone={tone}
              >
                {fmtDay(r.purchaseDue)}
              </span>
              {/* In words too — the colour is never the only signal. */}
              <div className="mt-0.5 text-[10px] text-muted-foreground">{dueCountdown(r.purchaseDue, todayYMD)}</div>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-2.5 py-2">
          {canEditClientDue ? (
            <input
              type="date"
              defaultValue={r.clientDue ?? ""}
              disabled={busy === `${r.key}:due`}
              onBlur={(e) => setClientDue(r, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="h-8 w-36 rounded-md border bg-background px-2 text-sm"
              aria-label={`Client due date for MRF #${r.mrfNo}`}
            />
          ) : (
            <span>{fmtDay(r.clientDue) ?? "—"}</span>
          )}
          <Stamp by={r.clientDueByName} at={r.clientDueAt} />
          <History row={r} field="clientDue" />
          {err?.key === r.key && <div className="mt-0.5 text-[11px] text-destructive">{err.msg}</div>}
        </td>
      </tr>
    );
  };

  const select = "h-9 rounded-md border bg-background px-2 text-sm";
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        {tableMissing && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Type and Client due date can&apos;t be saved yet — the database needs migration <b>0060_purchaser_plan</b>. Everything else below is live.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search order no., account holder, MRF, status…"
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Group by
            <select className={select} value={view.groupKey} onChange={(e) => update({ groupKey: e.target.value as PlanGroupKey })}>
              {PLAN_GROUP_OPTIONS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Sort by
            <select className={select} value={view.sortKey} onChange={(e) => update({ sortKey: e.target.value as PlanSortKey })}>
              {PLAN_SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              {/* MRF no. is sortable from its header; keep the box honest when it's chosen there. */}
              {view.sortKey === "mrfNo" && <option value="mrfNo">MRF no.</option>}
            </select>
          </label>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1 rounded-md border bg-background px-3 text-sm hover:bg-accent"
            onClick={() => update({ dir: view.dir === "asc" ? "desc" : "asc" })}
            title="Switch between ascending and descending"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {view.dir === "asc" ? "Ascending" : "Descending"}
          </button>
          <span className="text-xs text-muted-foreground">
            {filtered.length === rows.length ? `${rows.length} open MRF${rows.length === 1 ? "" : "s"}` : `${filtered.length} of ${rows.length}`}
          </span>
        </div>

        {/* What the colours on Purchase due date mean. */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>Purchase due date:</span>
          {TONES.map((t) => (
            <span key={t} className={`rounded border px-1.5 py-0.5 ${TONE_CLASS[t]}`}>
              {TONE_NAME[t]} · {DUE_TONE_LABEL[t].toLowerCase()}
            </span>
          ))}
          <span className={`rounded border px-1.5 py-0.5 ${LATE_CLASS}`}>Grey · received in stock, late</span>
          <span>— once received in stock, green means it arrived on time</span>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>{COLUMNS.map(header)}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 && (
                <tr><td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted-foreground">
                  {rows.length === 0 ? "No open MRFs on paid orders." : "Nothing matches that search."}
                </td></tr>
              )}
              {shownGroups.map((g) => (
                <Fragment key={g.key}>
                  {view.groupKey !== "none" && (
                    <tr className="bg-muted/40">
                      <td colSpan={COLUMNS.length} className="px-2.5 py-1.5 text-xs font-semibold">
                        {g.label} <span className="font-normal text-muted-foreground">({g.rows.length})</span>
                      </td>
                    </tr>
                  )}
                  {g.rows.map(row)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {hiddenCount > 0 && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-primary hover:underline" aria-expanded={expanded}>
            {expanded ? "Show less" : `Show ${hiddenCount} more`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
