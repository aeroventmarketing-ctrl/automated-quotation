"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { statusBucket, type PRBucket } from "@/lib/purchasing";
import type { PurchaseChainRow } from "@/lib/purchase-chain-row";
import type { StockOpt } from "../orders/[id]/stock-match-panel";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import { PurchasingChain } from "../orders/[id]/purchasing-chain";

/** A chain row plus the extra fields the list searches and sorts on. */
export type RequisitionRow = PurchaseChainRow & { createdAt: string; requestor: string };

type Tab = PRBucket | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

type SortKey = "newest" | "oldest" | "department" | "status";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "department", label: "Department" },
  { key: "status", label: "Status" },
];

type GroupKey = "none" | "department" | "status";
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "department", label: "Group by department" },
  { key: "status", label: "Group by status" },
];

// Order status buckets sensibly when sorting/grouping by status.
const BUCKET_ORDER: Record<PRBucket, number> = { pending: 0, approved: 1, rejected: 2, cancelled: 3 };

/**
 * The "My requisitions" list: status tabs plus a search box and sort / group
 * controls. All filtering, searching, sorting and grouping happen client-side
 * over the rows the page already fetched.
 */
export function RequisitionsList({
  rows,
  stockItems,
  suppliers,
  paymentTerms,
  poDefaultRemarks,
}: {
  rows: RequisitionRow[];
  stockItems: StockOpt[];
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  poDefaultRemarks: string;
}) {
  const [tab, setTab] = useState<Tab>("pending");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [group, setGroup] = useState<GroupKey>("none");

  // A material/MRF requisition stays "pending" until its Purchase Order exists.
  const bucketOf = (r: RequisitionRow) => statusBucket(r.status, { isDept: r.isDept, hasPo: !!r.po });

  const counts: Record<Tab, number> = { pending: 0, approved: 0, rejected: 0, cancelled: 0, all: 0 };
  for (const r of rows) counts[bucketOf(r)]++;
  counts.all = rows.length;

  const visible = useMemo(() => {
    const bkt = (r: RequisitionRow) => statusBucket(r.status, { isDept: r.isDept, hasPo: !!r.po });
    const q = query.trim().toLowerCase();
    let list = rows.filter((r) => tab === "all" || bkt(r) === tab);
    if (q) {
      list = list.filter((r) =>
        [r.deptLabel, r.requestor, r.note ?? "", r.statusLabel, ...r.items].join("  ").toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.createdAt.localeCompare(b.createdAt);
        case "department":
          return a.deptLabel.localeCompare(b.deptLabel) || b.createdAt.localeCompare(a.createdAt);
        case "status":
          return BUCKET_ORDER[bkt(a)] - BUCKET_ORDER[bkt(b)] || b.createdAt.localeCompare(a.createdAt);
        case "newest":
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return sorted;
  }, [rows, tab, query, sort]);

  // Break the visible rows into groups (a single "" group when grouping is off).
  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", rows: visible }];
    const map = new Map<string, RequisitionRow[]>();
    for (const r of visible) {
      const key = group === "department" ? r.deptLabel : r.statusLabel;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return [...map.entries()].map(([key, rs]) => ({ key, rows: rs }));
  }, [visible, group]);

  const chainProps = { stockItems, suppliers, paymentTerms, poDefaultRemarks };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${tab === t.key ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search item, department, requestor…"
            className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Group
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
            {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No requisitions match.</CardContent></Card>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="space-y-2">
            {g.key && (
              <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.key}<span className="text-muted-foreground/70">({g.rows.length})</span>
              </div>
            )}
            <Card>
              <CardContent className="pt-6">
                <PurchasingChain requests={g.rows} orderId="" canManagePO={false} readOnly poRoute="purchasing" {...chainProps} />
              </CardContent>
            </Card>
          </div>
        ))
      )}
    </div>
  );
}
