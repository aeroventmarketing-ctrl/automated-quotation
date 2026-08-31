"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { prMainIndex, type PRBucket, type PRStatus } from "@/lib/purchasing";
import type { PurchaseChainRow } from "@/lib/purchase-chain-row";
import type { StockOpt } from "../orders/[id]/stock-match-panel";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import { PurchasingChain } from "../orders/[id]/purchasing-chain";

/** A chain row plus the extra fields the list searches and sorts on. */
export type RequisitionRow = PurchaseChainRow & { createdAt: string; requestor: string };

/**
 * "budgeted" is a display-only split of the shared "approved" bucket, matching
 * the Purchasing workspace: once the voucher & check are SIGNED
 * (`VOUCHER_SIGNED` onward) the money is committed, so the request moves out of
 * Approved into its own Budgeted tab.
 */
type DisplayBucket = PRBucket | "budgeted";
type Tab = DisplayBucket | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "budgeted", label: "Budgeted" },
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
const BUCKET_ORDER: Record<DisplayBucket, number> = { pending: 0, approved: 1, budgeted: 2, rejected: 3, cancelled: 4 };

/**
 * A finished requisition: **received and added to stock by the Warehouse**, the
 * last rung of the chain (`PLANT_APPROVED → COMPLETED`). These leave the tabs
 * entirely for the collapsed "Completed requisitions" section, exactly as the
 * Purchasing workspace does with its completed department POs.
 *
 * The one exception is the same one Purchasing makes: a completed requisition
 * still carrying an **unresolved supplier return** stays in the tabs, because the
 * replacement is still being chased and its buttons are still live. `done` on a
 * return view is `stage === "approved"`, the same test as `hasUnresolvedReturn`.
 */
function isCompletedRequisition(r: PurchaseChainRow): boolean {
  return r.status === "COMPLETED" && !(r.returns ?? []).some((rt) => !rt.done);
}

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
  admin = false,
  showAmounts = true,
  showSupplier = true,
  canCheckStock = false,
  canIssueStock = false,
}: {
  rows: RequisitionRow[];
  stockItems: StockOpt[];
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  poDefaultRemarks: string;
  admin?: boolean;
  showAmounts?: boolean;
  showSupplier?: boolean;
  /** Warehouse / Purchaser / Payment Approver / admin — show the stock lookup. */
  canCheckStock?: boolean;
  /** Warehouse / admin — may also issue a requisition line from stock. */
  canIssueStock?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("pending");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [group, setGroup] = useState<GroupKey>("none");
  const [completedOpen, setCompletedOpen] = useState(false);

  // Finished requisitions live in their own collapsed section below, not in the
  // tabs — so a completed one is never counted twice, and every tab (All
  // included) means "still moving".
  const completedRows = useMemo(() => rows.filter(isCompletedRequisition), [rows]);
  const openRows = useMemo(() => rows.filter((r) => !isCompletedRequisition(r)), [rows]);

  // My Requisitions: "Approved" means Plant-Manager-approved — once the request is
  // APPROVED it leaves Pending, even before the Purchase Order is raised. (The
  // purchasing workspace keeps its own "pending until PO" bucketing separately.)
  // Past the signed voucher the money is committed, so it moves on to Budgeted.
  const bucketOf = (r: RequisitionRow): DisplayBucket =>
    r.status === "PENDING_APPROVAL" ? "pending"
    : r.status === "REJECTED" ? "rejected"
    : r.status === "CANCELLED" ? "cancelled"
    : prMainIndex(r.status as PRStatus) >= prMainIndex("VOUCHER_SIGNED") ? "budgeted"
    : "approved";

  // One search box filters the tabs and the completed section alike.
  const matches = (r: RequisitionRow, q: string) =>
    !q ||
    [r.deptLabel, r.requestor, r.note ?? "", r.statusLabel, r.po?.poNumber ?? "", ...r.items]
      .join(" · ").toLowerCase().includes(q);

  const counts: Record<Tab, number> = { pending: 0, approved: 0, budgeted: 0, rejected: 0, cancelled: 0, all: 0 };
  for (const r of openRows) counts[bucketOf(r)]++;
  counts.all = openRows.length;

  const shownCompleted = useMemo(
    () => completedRows.filter((r) => matches(r, query.trim().toLowerCase())),
    [completedRows, query],
  );

  const visible = useMemo(() => {
    const bkt = bucketOf;
    const q = query.trim().toLowerCase();
    let list = openRows.filter((r) => tab === "all" || bkt(r) === tab);
    if (q) list = list.filter((r) => matches(r, q));
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
  }, [openRows, tab, query, sort]);

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

  const chainProps = { stockItems, suppliers, paymentTerms, poDefaultRemarks, admin, showAmounts, showSupplier, showStockCheck: canCheckStock, canIssueStock };

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
                <PurchasingChain requests={g.rows} orderId="" canManagePO={false} readOnly poRoute="purchasing" deptApprovalHere {...chainProps} />
              </CardContent>
            </Card>
          </div>
        ))
      )}

      {/* Completed requisitions — received and added to stock by the Warehouse,
          the last rung of the chain. Kept viewable in a collapsed section at the
          bottom, independent of the tab filter, exactly as the Purchasing
          workspace keeps its completed department POs: a finished requisition
          stays readable instead of vanishing from the tab it was last seen in.
          The chain is terminal here — nothing left to press but View / Print. */}
      {completedRows.length > 0 && (
        <details
          className="rounded-lg border bg-card"
          open={completedOpen}
          onToggle={(e) => setCompletedOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Completed requisitions ({completedRows.length})
          </summary>
          <div className="border-t p-4">
            {shownCompleted.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No completed requisitions match your search.</p>
            ) : (
              <PurchasingChain requests={shownCompleted} orderId="" canManagePO={false} readOnly poRoute="purchasing" {...chainProps} />
            )}
          </div>
        </details>
      )}
    </div>
  );
}
