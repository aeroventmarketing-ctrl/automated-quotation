"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { statusBucket, type PRBucket } from "@/lib/purchasing";
import type { PurchaseChainRow } from "@/lib/purchase-chain-row";
import type { StockOpt } from "../orders/[id]/stock-match-panel";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import { PurchasingChain } from "../orders/[id]/purchasing-chain";

type Tab = PRBucket | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

/**
 * The "My requisitions" list with Pending / Approved / Rejected / Cancelled / All
 * status tabs. Filtering is client-side over the rows the page already fetched.
 */
export function RequisitionsList({
  rows,
  stockItems,
  suppliers,
  paymentTerms,
  poDefaultRemarks,
}: {
  rows: PurchaseChainRow[];
  stockItems: StockOpt[];
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  poDefaultRemarks: string;
}) {
  const [tab, setTab] = useState<Tab>("pending");

  const counts: Record<Tab, number> = { pending: 0, approved: 0, rejected: 0, cancelled: 0, all: 0 };
  for (const r of rows) counts[statusBucket(r.status)]++;
  counts.all = rows.length;

  const filtered = tab === "all" ? rows : rows.filter((r) => statusBucket(r.status) === tab);

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

      {filtered.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No {tab === "all" ? "" : `${tab} `}requisitions.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <PurchasingChain
              requests={filtered}
              stockItems={stockItems}
              orderId=""
              poDefaultRemarks={poDefaultRemarks}
              suppliers={suppliers}
              paymentTerms={paymentTerms}
              canManagePO={false}
              readOnly
              poRoute="purchasing"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
