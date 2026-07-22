"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { statusBucket, type PRBucket } from "@/lib/purchasing";
import { poTotals } from "@/lib/purchase-order";
import { formatCurrency } from "@/lib/utils";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import type { PurchaseChainRow } from "@/lib/purchase-chain-row";
import { advancePurchaseRequest } from "../orders/actions";
import type { CatalogPrices, CatalogSuppliers } from "@/lib/po-catalog";
import type { ScanProduct } from "@/lib/product-scan";
import { PurchasingChain } from "../orders/[id]/purchasing-chain";
import { CombinedPurchasing, type BatchCard, type CombinableItem, type SupplierSuggestion } from "./combined-purchasing";
import type { StockOpt } from "../orders/[id]/stock-match-panel";

export interface OrderGroup {
  id: string;
  title: string;
  subtitle: string;
  rows: PurchaseChainRow[];
}

type Tab = PRBucket | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

type SortKey = "default" | "customer" | "amount_desc" | "amount_asc";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "default", label: "Default order" },
  { key: "customer", label: "Customer (A–Z)" },
  { key: "amount_desc", label: "Amount (high→low)" },
  { key: "amount_asc", label: "Amount (low→high)" },
];

type GroupKey = "none" | "customer" | "status";
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "customer", label: "Group by customer" },
  { key: "status", label: "Group by status" },
];
const BUCKET_ORDER: Record<PRBucket, number> = { pending: 0, approved: 1, rejected: 2, cancelled: 3 };
const BUCKET_LABEL: Record<PRBucket, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };

/** Loose text match: substring, plus a separators-ignored match so "AFBM 0002"
 *  finds "AFBM00002-…". */
function textMatch(haystack: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const h = haystack.toLowerCase();
  if (h.includes(q.toLowerCase())) return true;
  const cq = q.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cq.length > 0 && h.replace(/[^a-z0-9]/g, "").includes(cq);
}

export function PurchasingWorkspace({
  batches,
  combinable,
  suggestions,
  orderGroups,
  suppliers,
  paymentTerms,
  stockItems,
  canManagePO,
  poDefaultRemarks,
  catalogPrices,
  catalogSuppliers,
  scanProducts,
}: {
  batches: BatchCard[];
  combinable: CombinableItem[];
  suggestions: SupplierSuggestion[];
  orderGroups: OrderGroup[];
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  stockItems: StockOpt[];
  canManagePO: boolean;
  poDefaultRemarks: string;
  catalogPrices: CatalogPrices;
  catalogSuppliers: CatalogSuppliers;
  scanProducts: ScanProduct[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  const inTab = (bucket: PRBucket) => tab === "all" || tab === bucket;
  // A material/MRF requisition stays "pending" until its Purchase Order exists.
  const rowBucket = (r: PurchaseChainRow) => statusBucket(r.status, { isDept: r.isDept, poApproved: r.poApproved });

  // Cross-order selection: tick material requests across every order to total
  // their PO amounts and approve them together.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allRows = orderGroups.flatMap((g) => g.rows);
  const selectedRows = allRows.filter((r) => selected.has(r.id));
  const selTotals = selectedRows
    .filter((r) => r.po)
    .reduce(
      (acc, r) => {
        const t = poTotals(r.po!);
        return { total: acc.total + t.total, ewt: acc.ewt + t.ewt, net: acc.net + t.net };
      },
      { total: 0, ewt: 0, net: 0 },
    );
  // The next forward step this user can run on a request — approve when it's
  // pending, otherwise whatever the current stage's action is (voucher, sign,
  // buy, …). Never bulk-reject, and never "receive" (that needs the per-item
  // stock-matching panel). Approve/voucher need the PO to exist first.
  const forwardStep = (r: PurchaseChainRow) => {
    const a = r.actions.find((x) => x.canAct && x.key !== "reject" && x.key !== "reject_po" && x.key !== "receive");
    if (!a) return null;
    const needsPo = a.key === "voucher" || a.key === "approve_po" || (a.key === "approve" && !r.isDept);
    if (needsPo && !r.po) return null;
    return a;
  };
  const actionableRows = selectedRows
    .map((r) => ({ r, step: forwardStep(r) }))
    .filter((x): x is { r: PurchaseChainRow; step: NonNullable<ReturnType<typeof forwardStep>> } => x.step !== null);
  // Label the button after the shared step (e.g. "Approve purchase"); fall back
  // to a generic label when the selection spans different stages.
  const stepKeys = [...new Set(actionableRows.map((x) => x.step.key))];
  const bulkLabel = actionableRows.length === 0 ? "Approve selected" : stepKeys.length === 1 ? actionableRows[0].step.label : "Advance selected";

  async function bulkApprove() {
    if (actionableRows.length === 0) return;
    if (!window.confirm(`${bulkLabel} — ${actionableRows.length} request(s)?`)) return;
    setApproving(true);
    setBulkMsg(null);
    let ok = 0;
    let failed = 0;
    for (const { r, step } of actionableRows) {
      try {
        await advancePurchaseRequest(r.id, step.key);
        ok++;
      } catch {
        failed++;
      }
    }
    setApproving(false);
    setSelected(new Set());
    setBulkMsg(`${ok} done${failed ? ` · ${failed} could not be processed` : ""}.`);
    router.refresh();
  }

  // Counts per tab (POs = combined-PO cards + individual request rows).
  const counts: Record<Tab, number> = { pending: 0, approved: 0, rejected: 0, cancelled: 0, all: 0 };
  for (const b of batches) counts[statusBucket(b.status)]++;
  for (const g of orderGroups) for (const r of g.rows) counts[rowBucket(r)]++;
  counts.all = counts.pending + counts.approved + counts.rejected + counts.cancelled;

  const showBuilder = tab === "pending" || tab === "all";

  // Search / sort / group over the batches and per-order requisition cards.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("default");
  const [group, setGroup] = useState<GroupKey>("none");

  const batchText = (b: BatchCard) =>
    [b.poNumber, b.supplierCompany, ...b.members.flatMap((m) => [m.orderLabel, m.deptLabel, m.mrfNo ?? "", ...m.items])].join("  ");
  const batchAmount = (b: BatchCard) => poTotals({ lines: b.lines, ewtPct: b.ewtPct, ewtMode: b.ewtMode, ewtAmount: b.ewtAmount }).total;
  const groupText = (g: OrderGroup) =>
    [g.title, g.subtitle, ...g.rows.flatMap((r) => [r.deptLabel, r.mrfNo ?? "", ...r.items, r.po?.poNumber ?? "", r.po?.supplier.company ?? ""])].join("  ");
  const groupAmount = (g: OrderGroup) => g.rows.reduce((s, r) => s + (r.po ? poTotals(r.po).total : 0), 0);
  const groupBucket = (g: OrderGroup): PRBucket =>
    (["pending", "approved", "rejected", "cancelled"] as PRBucket[])[
      g.rows.reduce((min, r) => Math.min(min, BUCKET_ORDER[rowBucket(r)]), 3)
    ];

  const filteredBatches = batches
    .filter((b) => inTab(statusBucket(b.status)))
    .filter((b) => textMatch(batchText(b), query));

  let filteredGroups = orderGroups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => inTab(rowBucket(r))) }))
    .filter((g) => g.rows.length > 0)
    .filter((g) => textMatch(groupText(g), query));

  if (sort !== "default") {
    filteredGroups = [...filteredGroups].sort((a, b) => {
      if (sort === "customer") return a.title.localeCompare(b.title) || a.subtitle.localeCompare(b.subtitle);
      if (sort === "amount_desc") return groupAmount(b) - groupAmount(a);
      return groupAmount(a) - groupAmount(b); // amount_asc
    });
  }

  // Cluster the order cards into sections when grouping is on (a single unnamed
  // section otherwise). Section order follows the sorted group order.
  const sections: { key: string; groups: typeof filteredGroups }[] =
    group === "none"
      ? [{ key: "", groups: filteredGroups }]
      : (() => {
          const map = new Map<string, typeof filteredGroups>();
          for (const g of filteredGroups) {
            const key = group === "customer" ? g.title : BUCKET_LABEL[groupBucket(g)];
            const arr = map.get(key) ?? [];
            arr.push(g);
            map.set(key, arr);
          }
          return [...map.entries()].map(([key, groups]) => ({ key, groups }));
        })();

  const nothing = filteredBatches.length === 0 && filteredGroups.length === 0 && !(showBuilder && combinable.length > 0 && !query.trim());

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
            placeholder="Search order #, PO #, supplier, department, item…"
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

      {(filteredBatches.length > 0 || (showBuilder && combinable.length > 0 && !query.trim())) && (
        <CombinedPurchasing
          combinable={showBuilder && !query.trim() ? combinable : []}
          batches={filteredBatches}
          suggestions={showBuilder && !query.trim() ? suggestions : []}
          suppliers={suppliers}
          paymentTerms={paymentTerms}
          stockItems={stockItems}
          canManagePO={canManagePO}
          poDefaultRemarks={poDefaultRemarks}
          catalogPrices={catalogPrices}
          catalogSuppliers={catalogSuppliers}
          scanProducts={scanProducts}
        />
      )}

      {(() => {
        let idx = 0; // running index for alternating card colours across sections
        return sections.map((section) => (
          <div key={section.key || "all"} className="space-y-3">
            {section.key && (
              <div className="flex items-center gap-2 px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.key}
                <span className="text-muted-foreground/70">({section.groups.length})</span>
              </div>
            )}
            {section.groups.map((g) => {
              const even = idx++ % 2 === 0;
              return (
                <Card
                  key={g.id}
                  className={
                    even
                      ? "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/20"
                      : "border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/20"
                  }
                >
                  <CardContent className="space-y-3 pt-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Link href={`/orders/${g.id}`} className="font-semibold hover:underline">{g.title}</Link>
                        <span className="ml-2 text-xs text-muted-foreground">{g.subtitle}</span>
                      </div>
                      <Link href={`/orders/${g.id}`} className="text-xs font-medium text-primary hover:underline">Open order →</Link>
                    </div>
                    <PurchasingChain
                      requests={g.rows}
                      stockItems={stockItems}
                      orderId={g.id}
                      poDefaultRemarks={poDefaultRemarks}
                      suppliers={suppliers}
                      paymentTerms={paymentTerms}
                      canManagePO={canManagePO}
                      catalogSuppliers={catalogSuppliers}
                      catalogPrices={catalogPrices}
                      scanProducts={scanProducts}
                      hideRequisitionApproval
                      selectedIds={selected}
                      onToggleSelect={toggleSelect}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ));
      })()}

      {nothing && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No {tab === "all" ? "" : tab + " "}purchase orders.</CardContent></Card>
      )}

      {/* Cross-order selection bar — totals the ticked material requests across
          every order and lets an approver approve them together. */}
      {selected.size > 0 && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-medium text-primary hover:underline">
              Clear
            </button>
            {selectedRows.some((r) => r.po) && (
              <span className="tabular-nums text-muted-foreground">
                Total <span className="font-semibold text-foreground">{formatCurrency(selTotals.total, "PHP")}</span>
                {selTotals.ewt > 0 && <> · less EWT {formatCurrency(selTotals.ewt, "PHP")}</>}
                {" · "}Net <span className="font-semibold text-foreground">{formatCurrency(selTotals.net, "PHP")}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {bulkMsg && <span className="text-xs text-muted-foreground">{bulkMsg}</span>}
            <Button
              size="sm"
              className="h-8"
              disabled={approving || actionableRows.length === 0}
              onClick={bulkApprove}
              title={actionableRows.length === 0 ? "None of the selected requests have a step you can act on" : undefined}
            >
              {approving ? "Processing…" : `${bulkLabel}${actionableRows.length ? ` (${actionableRows.length})` : ""}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
