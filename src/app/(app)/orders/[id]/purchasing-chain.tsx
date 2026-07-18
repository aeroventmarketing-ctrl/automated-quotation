"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { advancePurchaseRequest, receivePurchaseRequest, cancelPurchaseRequest, deletePurchaseRequest } from "../actions";
import { StockMatchPanel, type StockOpt } from "./stock-match-panel";
import { PurchaseOrderPanel } from "./purchase-order-panel";
import type { POLine, PurchaseOrder } from "@/lib/purchase-order";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import type { CatalogSuppliers, CatalogPrices } from "@/lib/po-catalog";

interface ActionOpt {
  key: string;
  label: string;
  canAct: boolean;
  roleLabel: string;
}
interface PRRow {
  id: string;
  deptLabel: string;
  mrfNo?: string | null;
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
  canCancel?: boolean;
  canDelete?: boolean;
}

export function PurchasingChain({
  requests,
  stockItems,
  orderId,
  poDefaultRemarks,
  suppliers,
  paymentTerms,
  canManagePO,
  catalogSuppliers = {},
  catalogPrices = {},
  readOnly = false,
  poRoute = "order",
}: {
  requests: PRRow[];
  stockItems: StockOpt[];
  orderId: string;
  poDefaultRemarks: string;
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  canManagePO: boolean;
  catalogSuppliers?: CatalogSuppliers;
  catalogPrices?: CatalogPrices;
  /** Monitoring only — hide every action/PO editor (used on the order page). */
  readOnly?: boolean;
  /**
   * Which PO print route to build. "order" uses the order-scoped route (needs
   * orderId); "purchasing" uses the generic route (department requisitions /
   * combined POs not tied to an order). A plain string, not a function — a
   * Server Component can't pass a function prop to this Client Component.
   */
  poRoute?: "order" | "purchasing";
}) {
  const printHref = (prId: string) =>
    poRoute === "purchasing" ? `/purchasing/po/${prId}/xlsx` : `/orders/${orderId}/po/${prId}/xlsx`;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [poEditId, setPoEditId] = useState<string | null>(null);

  async function cancel(prId: string) {
    if (!window.confirm("Cancel this purchase order / request?")) return;
    setBusy(prId + "cancel");
    setErr(null);
    try { await cancelPurchaseRequest(prId); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function del(prId: string) {
    if (!window.confirm("Permanently delete this purchase request / PO?")) return;
    setBusy(prId + "delete");
    setErr(null);
    try { await deletePurchaseRequest(prId); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function run(prId: string, stepKey: string) {
    setBusy(prId + stepKey);
    setErr(null);
    try {
      await advancePurchaseRequest(prId, stepKey);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
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
              <span className="text-sm font-medium">
                {r.deptLabel}
                {r.mrfNo && <span className="ml-2 font-normal text-muted-foreground">MRF #{r.mrfNo}</span>}
              </span>
              <Badge variant={r.variant}>{r.statusLabel}</Badge>
            </div>
            <ul className="ml-4 list-disc text-sm text-muted-foreground">
              {r.items.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
            {r.note && <p className="mt-1 text-xs text-muted-foreground">Note: {r.note}</p>}
            {r.trail.length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">{r.trail.join(" · ")}</div>
            )}
            {readOnly ? (
              r.status !== "REJECTED" && r.status !== "COMPLETED" && r.actions[0] ? (
                <div className="mt-2 text-xs text-muted-foreground">Waiting on {r.actions[0].roleLabel} — process in Purchasing</div>
              ) : null
            ) : receivingId === r.id ? (
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
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Approval/rejection/voucher can't proceed until the PO exists —
                    hide those buttons (rather than showing them disabled) and
                    show a hint instead, so nothing dead is clickable. */}
                {actionable
                  .filter((a) => !(((a.key === "approve" || a.key === "reject" || a.key === "voucher")) && !r.po))
                  .map((a) => (
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
                {actionable.some((a) => a.key === "approve" || a.key === "reject" || a.key === "voucher") && !r.po && (
                  <span className="text-xs text-muted-foreground">Create the Purchase Order first.</span>
                )}
              </div>
            ) : awaiting ? (
              <div className="mt-2 text-xs text-muted-foreground">Awaiting {awaiting.roleLabel}</div>
            ) : null}

            {/* Supplier Purchase Order — a rejected request can't get a new PO. */}
            {(r.status !== "REJECTED" || r.po) && (
            <div className="mt-2 border-t pt-2">
              {!readOnly && poEditId === r.id ? (
                <PurchaseOrderPanel
                  prId={r.id}
                  orderId={orderId}
                  po={r.po}
                  defaultLines={r.poDefaultLines}
                  defaultRemarks={poDefaultRemarks}
                  suppliers={suppliers}
                  paymentTerms={paymentTerms}
                  canManageTerms={canManagePO}
                  catalogSuppliers={catalogSuppliers}
                  catalogPrices={catalogPrices}
                  onDone={() => setPoEditId(null)}
                />
              ) : r.po ? (
                <div className="flex flex-wrap items-end justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">PO {r.po.poNumber}</Badge>
                    {r.po.supplier.company && <span className="text-muted-foreground">{r.po.supplier.company}</span>}
                    <a
                      href={printHref(r.id)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#c2141a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]/40"
                    >
                      <Printer className="h-3.5 w-3.5" /> Print PO &amp; 2307
                    </a>
                  </div>
                  {!readOnly && r.canManagePO && (
                    <button
                      type="button"
                      onClick={() => setPoEditId(r.id)}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#ED1C24] px-3 py-1.5 text-xs font-semibold text-[#ED1C24] transition-colors hover:bg-[#ED1C24]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]/40"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                </div>
              ) : readOnly ? (
                <span className="text-xs text-muted-foreground">No purchase order yet.</span>
              ) : r.canManagePO ? (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPoEditId(r.id)}>Create Purchase Order</Button>
              ) : (
                <span className="text-xs text-muted-foreground">No purchase order yet.</span>
              )}
            </div>
            )}

            {!readOnly && (r.canCancel || r.canDelete) && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {r.canCancel && (
                  <button type="button" onClick={() => cancel(r.id)} disabled={busy === r.id + "cancel"}
                    className="text-xs font-medium text-muted-foreground hover:text-destructive">
                    {busy === r.id + "cancel" ? "…" : "Cancel this PO"}
                  </button>
                )}
                {r.canDelete && (
                  <button type="button" onClick={() => del(r.id)} disabled={busy === r.id + "delete"}
                    className="text-xs font-medium text-destructive hover:underline">
                    {busy === r.id + "delete" ? "…" : "Delete"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
