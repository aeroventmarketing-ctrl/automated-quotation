"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { advancePurchaseRequest, receivePurchaseRequest } from "../actions";
import { StockMatchPanel, type StockOpt } from "./stock-match-panel";
import { PurchaseOrderPanel } from "./purchase-order-panel";
import type { POLine, PurchaseOrder } from "@/lib/purchase-order";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";

interface ActionOpt {
  key: string;
  label: string;
  canAct: boolean;
  roleLabel: string;
}
interface PRRow {
  id: string;
  deptLabel: string;
  items: string[];
  note?: string | null;
  status: string;
  statusLabel: string;
  variant: "secondary" | "warning" | "success" | "destructive";
  trail: string[];
  actions: ActionOpt[];
  po: PurchaseOrder | null;
  poDefaultLines: POLine[];
  canManagePO: boolean;
}

export function PurchasingChain({
  requests,
  stockItems,
  orderId,
  poDefaultRemarks,
  suppliers,
  paymentTerms,
  canManagePO,
}: {
  requests: PRRow[];
  stockItems: StockOpt[];
  orderId: string;
  poDefaultRemarks: string;
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  canManagePO: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [poEditId, setPoEditId] = useState<string | null>(null);

  async function run(prId: string, stepKey: string) {
    setBusy(prId + stepKey);
    setErr(null);
    try {
      await advancePurchaseRequest(prId, stepKey);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(null);
    }
  }

  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">No purchase requests. They appear here when the warehouse marks a material request &ldquo;For purchasing.&rdquo;</p>;
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => {
        const actionable = r.actions.filter((a) => a.canAct);
        const awaiting = r.actions.find((a) => !a.canAct);
        return (
          <div key={r.id} className="rounded-md border p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{r.deptLabel}</span>
              <Badge variant={r.variant}>{r.statusLabel}</Badge>
            </div>
            <ul className="ml-4 list-disc text-sm text-muted-foreground">
              {r.items.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
            {r.note && <p className="mt-1 text-xs text-muted-foreground">Note: {r.note}</p>}
            {r.trail.length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">{r.trail.join(" · ")}</div>
            )}
            {receivingId === r.id ? (
              <StockMatchPanel
                lines={r.items.map((it) => ({ label: it, qtyDefault: "" }))}
                stockItems={stockItems}
                submitLabel="Receive & add to stock"
                onCancel={() => setReceivingId(null)}
                onSubmit={async (matches) => {
                  await receivePurchaseRequest(r.id, matches);
                  setReceivingId(null);
                  router.refresh();
                }}
              />
            ) : actionable.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {actionable.map((a) => (
                  <Button
                    key={a.key}
                    size="sm"
                    variant={a.key === "reject" ? "outline" : "default"}
                    className="h-7 text-xs"
                    disabled={busy === r.id + a.key}
                    onClick={() => (a.key === "receive" ? setReceivingId(r.id) : run(r.id, a.key))}
                  >
                    {busy === r.id + a.key ? "Saving…" : a.label}
                  </Button>
                ))}
              </div>
            ) : awaiting ? (
              <div className="mt-2 text-xs text-muted-foreground">Awaiting {awaiting.roleLabel}</div>
            ) : null}

            {/* Supplier Purchase Order */}
            <div className="mt-2 border-t pt-2">
              {poEditId === r.id ? (
                <PurchaseOrderPanel
                  prId={r.id}
                  orderId={orderId}
                  po={r.po}
                  defaultLines={r.poDefaultLines}
                  defaultRemarks={poDefaultRemarks}
                  suppliers={suppliers}
                  paymentTerms={paymentTerms}
                  canManageTerms={canManagePO}
                  onDone={() => setPoEditId(null)}
                />
              ) : r.po ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="success">PO {r.po.poNumber}</Badge>
                  {r.po.supplier.company && <span className="text-muted-foreground">{r.po.supplier.company}</span>}
                  <Link href={`/orders/${orderId}/po/${r.id}`} target="_blank" className="text-primary hover:underline">Print PO</Link>
                  {r.canManagePO && (
                    <button type="button" onClick={() => setPoEditId(r.id)} className="text-muted-foreground hover:text-foreground">Edit</button>
                  )}
                </div>
              ) : r.canManagePO ? (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPoEditId(r.id)}>Create Purchase Order</Button>
              ) : (
                <span className="text-xs text-muted-foreground">No purchase order yet.</span>
              )}
            </div>
          </div>
        );
      })}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
