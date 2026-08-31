"use client";

import { useMemo, useState } from "react";
import { Search, X, CheckCircle2, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ApprovalTrail, approvalStamp } from "@/components/approval-trail";
import type { ApprovalRecord } from "@/lib/approval-history";

/**
 * The decided-request record, searchable.
 *
 * Client-side filtering over an already-loaded page of rows: a record is read by
 * looking something up ("who approved the belt price?"), and a round trip per
 * keystroke would buy nothing on a few hundred rows.
 */
export function ApprovalList({ records }: { records: ApprovalRecord[] }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"all" | "inventory" | "products">("all");
  const needle = q.trim().toLowerCase();

  const shown = useMemo(
    () =>
      records.filter((r) => {
        if (source !== "all" && r.source !== source) return false;
        if (!needle) return true;
        const hay = [r.title, r.summary, r.kindLabel, r.raisedBy.name, ...r.steps.map((s) => s.name)]
          .filter(Boolean).join(" ").toLowerCase();
        return hay.includes(needle);
      }),
    [records, needle, source],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[18rem] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search by item, change or person…" value={q} onChange={(e) => setQ(e.target.value)} />
          {needle !== "" && (
            <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Screen
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            <option value="all">Both</option>
            <option value="inventory">Inventory</option>
            <option value="products">Products</option>
          </select>
        </label>
        <span className="text-xs text-muted-foreground">
          {shown.length === records.length ? `${records.length} decided` : `${shown.length} of ${records.length}`}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {records.length === 0 ? "Nothing has been decided yet. Approved and rejected requests appear here." : "No record matches that search."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={`${r.source}-${r.id}`} className="rounded-md border p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {r.outcome === "applied" ? (
                  <Badge variant="success" className="gap-1 font-normal"><CheckCircle2 className="h-3 w-3" /> Approved</Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1 font-normal"><XCircle className="h-3 w-3" /> Rejected</Badge>
                )}
                <Badge variant="secondary" className="font-normal">{r.sourceLabel}</Badge>
                <span className="font-medium text-foreground">{r.title}</span>
                <span className="text-muted-foreground">{r.kindLabel}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{approvalStamp(r.decidedAt)}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{r.summary}</p>
              <ApprovalTrail className="mt-1.5" raisedBy={r.raisedBy} steps={r.steps} />
              {r.rejectReason && <p className="mt-1 text-[11px] text-destructive">Reason: {r.rejectReason}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
