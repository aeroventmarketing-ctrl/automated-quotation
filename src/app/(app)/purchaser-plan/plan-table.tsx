"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowUp, ArrowDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PLAN_TYPES, type PurchaserPlanRow } from "@/lib/purchaser-plan";
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
  Rejected: "destructive",
  Cancelled: "destructive",
};

type SortKey = "type" | "orderNo" | "orderedDate" | "accountHolder" | "mrfNo" | "mrfStatus" | "purchaseDue" | "clientDue";
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "type", label: "Type" },
  { key: "orderNo", label: "Order no." },
  { key: "orderedDate", label: "Ordered date" },
  { key: "accountHolder", label: "Account holder" },
  { key: "mrfNo", label: "MRF no." },
  { key: "mrfStatus", label: "MRF status" },
  { key: "purchaseDue", label: "Purchase due date" },
  { key: "clientDue", label: "Client due date" },
];

/** Who last set a value, and when — the owner's "show who edited, date and time". */
function Stamp({ by, at }: { by: string | null; at: string | null }) {
  if (!by || !at) return null;
  return <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{by} · {fmtStamp(at)}</div>;
}

export function PurchaserPlanTable({ rows: initial, canEdit, tableMissing }: { rows: PurchaserPlanRow[]; canEdit: boolean; tableMissing: boolean }) {
  // Saved values are patched in place, so a change shows at once without a reload.
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  // Default: the owner's sheet sorts Purchase due date, soonest first — and the
  // server already handed the rows over in that order, so "none" keeps it.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ key: string; msg: string } | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q
      ? rows.filter((r) =>
          [r.orderNo, r.accountHolder, r.mrfNo, r.mrfStatus, PLAN_TYPES.find((t) => t.key === r.type)?.label ?? ""]
            .join("  ")
            .toLowerCase()
            .includes(q),
        )
      : rows;
    if (sort) {
      const val = (r: PurchaserPlanRow): string =>
        sort.key === "type" ? (PLAN_TYPES.find((t) => t.key === r.type)?.label ?? "") : String(r[sort.key] ?? "");
      out = [...out].sort((a, b) => {
        const av = val(a), bv = val(b);
        // Blanks always last, whichever way the column is sorted.
        if (!av !== !bv) return av ? -1 : 1;
        return av.localeCompare(bv, undefined, { numeric: true }) * sort.dir;
      });
    }
    return out;
  }, [rows, query, sort]);

  function patch(key: string, fields: Partial<PurchaserPlanRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...fields } : r)));
  }

  async function setType(r: PurchaserPlanRow, value: string) {
    setBusy(`${r.key}:type`); setErr(null);
    const res = await savePlanType(r.quotationId, r.mrfId, value);
    setBusy(null);
    if (!res.ok) { setErr({ key: r.key, msg: res.error }); return; }
    patch(r.key, { type: (value || null) as PurchaserPlanRow["type"], typeByName: res.byName, typeAt: res.at });
  }

  async function setClientDue(r: PurchaserPlanRow, value: string) {
    if ((r.clientDue ?? "") === value) return;
    setBusy(`${r.key}:due`); setErr(null);
    const res = await savePlanClientDue(r.quotationId, r.mrfId, value);
    setBusy(null);
    if (!res.ok) { setErr({ key: r.key, msg: res.error }); return; }
    patch(r.key, { clientDue: value || null, clientDueByName: res.byName, clientDueAt: res.at });
  }

  const header = (c: { key: SortKey; label: string }) => {
    const active = sort?.key === c.key;
    return (
      <th key={c.key} className="px-2.5 py-2 text-left align-bottom font-semibold">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-left hover:text-primary"
          onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}
          title="Sort"
        >
          {c.label}
          {active && (sort!.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
        </button>
      </th>
    );
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        {tableMissing && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Type and Client due date can&apos;t be saved yet — the database needs migration <b>0060_purchaser_plan</b>. Everything else below is live.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search order no., account holder, MRF, status…"
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {shown.length === rows.length ? `${rows.length} open MRF${rows.length === 1 ? "" : "s"}` : `${shown.length} of ${rows.length}`}
          </span>
          {sort && (
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setSort(null)}>
              Reset sort (purchase due date first)
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>{COLUMNS.map(header)}</tr>
            </thead>
            <tbody className="divide-y">
              {shown.length === 0 && (
                <tr><td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted-foreground">
                  {rows.length === 0 ? "No open MRFs on paid orders." : "Nothing matches that search."}
                </td></tr>
              )}
              {shown.map((r) => (
                <tr key={r.key} className="align-top hover:bg-accent/40">
                  <td className="px-2.5 py-2">
                    {canEdit ? (
                      <select
                        value={r.type ?? ""}
                        disabled={busy === `${r.key}:type`}
                        onChange={(e) => setType(r, e.target.value)}
                        className="h-8 w-36 rounded-md border bg-background px-2 text-sm"
                        aria-label={`Type for MRF #${r.mrfNo}`}
                      >
                        <option value="">—</option>
                        {PLAN_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    ) : (
                      <span>{PLAN_TYPES.find((t) => t.key === r.type)?.label ?? "—"}</span>
                    )}
                    <Stamp by={r.typeByName} at={r.typeAt} />
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2">
                    <Link href={r.href} className="font-mono text-xs font-semibold text-primary hover:underline" title={`Open MRF #${r.mrfNo}`}>
                      {r.orderNo}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2">{fmtDay(r.orderedDate) ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-2.5 py-2">{r.accountHolder}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 tabular-nums">#{r.mrfNo}</td>
                  <td className="px-2.5 py-2"><Badge variant={STATUS_VARIANT[r.mrfStatus] ?? "secondary"} className="whitespace-nowrap font-normal">{r.mrfStatus}</Badge></td>
                  <td className="whitespace-nowrap px-2.5 py-2">{fmtDay(r.purchaseDue) ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-2.5 py-2">
                    {canEdit ? (
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
                    {err?.key === r.key && <div className="mt-0.5 text-[11px] text-destructive">{err.msg}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
