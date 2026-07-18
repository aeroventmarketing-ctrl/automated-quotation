"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { statusBucket, type PRBucket } from "@/lib/purchasing";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import type { PurchaseChainRow } from "@/lib/purchase-chain-row";
import type { CatalogPrices, CatalogSuppliers } from "@/lib/po-catalog";
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
}) {
  const [tab, setTab] = useState<Tab>("pending");
  const inTab = (bucket: PRBucket) => tab === "all" || tab === bucket;

  // Counts per tab (POs = combined-PO cards + individual request rows).
  const counts: Record<Tab, number> = { pending: 0, approved: 0, rejected: 0, cancelled: 0, all: 0 };
  for (const b of batches) counts[statusBucket(b.status)]++;
  for (const g of orderGroups) for (const r of g.rows) counts[statusBucket(r.status)]++;
  counts.all = counts.pending + counts.approved + counts.rejected + counts.cancelled;

  const showBuilder = tab === "pending" || tab === "all";
  const filteredBatches = batches.filter((b) => inTab(statusBucket(b.status)));
  const filteredGroups = orderGroups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => inTab(statusBucket(r.status))) }))
    .filter((g) => g.rows.length > 0);

  const nothing = filteredBatches.length === 0 && filteredGroups.length === 0 && !(showBuilder && combinable.length > 0);

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

      {(filteredBatches.length > 0 || (showBuilder && combinable.length > 0)) && (
        <CombinedPurchasing
          combinable={showBuilder ? combinable : []}
          batches={filteredBatches}
          suggestions={showBuilder ? suggestions : []}
          suppliers={suppliers}
          paymentTerms={paymentTerms}
          stockItems={stockItems}
          canManagePO={canManagePO}
          poDefaultRemarks={poDefaultRemarks}
          catalogPrices={catalogPrices}
          catalogSuppliers={catalogSuppliers}
        />
      )}

      {filteredGroups.map((g) => (
        <Card key={g.id}>
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
            />
          </CardContent>
        </Card>
      ))}

      {nothing && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No {tab === "all" ? "" : tab + " "}purchase orders.</CardContent></Card>
      )}
    </div>
  );
}
