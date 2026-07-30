"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { advancePurchaseRequest, receivePurchaseRequest, cancelPurchaseRequest, deletePurchaseRequest } from "../actions";
import { ApproverHighlight } from "@/components/approver-highlight";
import { PurchaseReturnsPanel } from "../../purchasing/purchase-returns-panel";
import { PurchaseReconcilePanel } from "../../purchasing/purchase-reconcile-panel";
import { AdminPurchaseOverride } from "../../purchasing/admin-purchase-override";
import { StockAvailabilityLookup } from "@/components/stock-availability-lookup";
import { RequisitionStockCheck } from "../../requisitions/requisition-stock-check";
import { AdminPrEditDelete } from "../../purchasing/admin-pr-manage";
import type { PurchaseReturnView, PurchaseReconcileView } from "@/lib/purchase-chain-row";
import { canReconcileAt } from "@/lib/purchase-reconcile";
import type { PRStatus } from "@/lib/purchasing";
import { StockMatchPanel, type StockOpt } from "./stock-match-panel";
import { PurchaseOrderPanel } from "./purchase-order-panel";
import { poTotals, poHasEwt, parseIssuedFromStockLine, isToPurchaseLine, stripToPurchasePrefix, type POLine, type PurchaseOrder } from "@/lib/purchase-order";
import { formatCurrency } from "@/lib/utils";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import type { CatalogSuppliers, CatalogPrices } from "@/lib/po-catalog";
import type { ScanProduct } from "@/lib/product-scan";

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
  returns?: PurchaseReturnView[];
  canRaiseReturn?: boolean;
  returnAdvanceRoles?: string[];
  returnAdmin?: boolean;
  reconcile?: PurchaseReconcileView;
  canRecordReconcile?: boolean;
  canSettleReconcile?: boolean;
  canEscalateReconcile?: boolean;
  canApproveReconcile?: boolean;
  canOverride?: boolean;
  priorStatuses?: { key: string; label: string }[];
  isDept?: boolean;
  poApproved?: boolean;
}

/** Normalise a description for loose matching (lower-case, single-spaced). */
const normDesc = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Parse a request line "20 pc · CRS ROD…" → { qty, desc }. */
function parseReqLine(it: string): { qty: number; desc: string } {
  const dot = it.indexOf("·");
  if (dot >= 0) {
    const head = it.slice(0, dot).trim();
    return { qty: Number((head.match(/^[\d.]+/) ?? ["0"])[0]) || 0, desc: normDesc(it.slice(dot + 1)) };
  }
  return { qty: 0, desc: normDesc(it) };
}

/**
 * Total quantity of a line still out on an unresolved supplier return — so the
 * "Receive & add to stock" default is the good quantity (ordered − returned).
 * Return text looks like "5 pc CRS ROD…; 3 pc G.I BOLT…".
 */
function returnedQtyForLine(desc: string, returns: PurchaseReturnView[]): number {
  const target = desc;
  let sum = 0;
  for (const rt of returns) {
    if (rt.resolved) continue; // replacement received → back in the count
    for (const entry of (rt.items ?? "").split(";")) {
      const m = entry.trim().match(/^([\d.]+)\s+\S+\s+(.*)$/);
      if (!m) continue;
      const q = Number(m[1]) || 0;
      const rdesc = normDesc(m[2]);
      if (q > 0 && (rdesc.includes(target) || target.includes(rdesc))) sum += q;
    }
  }
  return sum;
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
  scanProducts = [],
  readOnly = false,
  poRoute = "order",
  hideRequisitionApproval = false,
  selectedIds,
  onToggleSelect,
  deptApprovalHere = false,
  admin = false,
  showAmounts = true,
  showSupplier = true,
  showStockCheck = false,
  canIssueStock = false,
  adminManage = false,
}: {
  requests: PRRow[];
  stockItems: StockOpt[];
  orderId: string;
  poDefaultRemarks: string;
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  canManagePO: boolean;
  admin?: boolean;
  catalogSuppliers?: CatalogSuppliers;
  catalogPrices?: CatalogPrices;
  /** Catalogue for the PO editor's "Scan product barcode" quick-add. */
  scanProducts?: ScanProduct[];
  /** Monitoring only — hide every action/PO editor (used on the order page). */
  readOnly?: boolean;
  /**
   * Which PO print route to build. "order" uses the order-scoped route (needs
   * orderId); "purchasing" uses the generic route (department requisitions /
   * combined POs not tied to an order). A plain string, not a function — a
   * Server Component can't pass a function prop to this Client Component.
   */
  poRoute?: "order" | "purchasing";
  /**
   * Hide the initial approve/reject buttons for material/department requisitions.
   * Order material requests are approved by the Plant Manager on the order's
   * Phase 3 Materials tab (workflow step 16), so the Purchasing workspace doesn't
   * duplicate that action for them.
   */
  hideRequisitionApproval?: boolean;
  /**
   * Controlled selection (the cross-order Purchasing workspace owns the set so it
   * can sum & bulk-approve across every order). When omitted, the chain manages
   * its own selection and shows its own per-chain total bar.
   */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /**
   * These are standalone department requisitions (raised from Requisitions, not
   * an order) — so the Plant Manager approves/rejects them right here rather than
   * on a non-existent order Materials tab. Renders the approve/reject buttons in
   * the otherwise read-only list.
   */
  deptApprovalHere?: boolean;
  /** Whether the viewer may see PO money amounts (totals, net, line prices). */
  showAmounts?: boolean;
  /** Whether the viewer may see the supplier's name. */
  showSupplier?: boolean;
  /** Show the read-only stock-availability lookup on each row (requisitions). */
  showStockCheck?: boolean;
  /** Warehouse/admin may also issue requisition lines from stock (requisitions tab). */
  canIssueStock?: boolean;
  /** Admin manage: show per-row "Edit item lines" (Purchasing workspace only). */
  adminManage?: boolean;
}) {
  const printHref = (prId: string) =>
    poRoute === "purchasing" ? `/purchasing/po/${prId}/xlsx` : `/orders/${orderId}/po/${prId}/xlsx`;
  const viewHref = (prId: string) =>
    poRoute === "purchasing" ? `/purchasing/po/${prId}/view` : `/orders/${orderId}/po/${prId}/view`;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [poEditId, setPoEditId] = useState<string | null>(null);
  // Selection for summing PO amounts (tick the MRFs to total). Controlled by the
  // parent when `selectedIds` is passed (the Purchasing workspace sums/approves
  // across orders); otherwise this chain keeps its own selection + summary bar.
  const [internalSel, setInternalSel] = useState<Set<string>>(new Set());
  const controlled = !!selectedIds;
  const sel = selectedIds ?? internalSel;
  const toggleSel =
    onToggleSelect ??
    ((id: string) =>
      setInternalSel((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }));

  // Rows that carry a Purchase Order can be selected and summed.
  const poRows = requests.filter((r) => r.po);
  const selectedPoRows = poRows.filter((r) => sel.has(r.id));
  const selTotals = selectedPoRows.reduce(
    (acc, r) => {
      const t = poTotals(r.po!);
      return { total: acc.total + t.total, ewt: acc.ewt + t.ewt, net: acc.net + t.net };
    },
    { total: 0, ewt: 0, net: 0 },
  );
  const allSelected = poRows.length > 0 && selectedPoRows.length === poRows.length;
  const toggleAll = () =>
    setInternalSel(allSelected ? new Set() : new Set(poRows.map((r) => r.id)));

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
        // Order material requests are approved on the order's Phase 3 Materials
        // tab — drop their approve/reject here so it isn't done in two places.
        const hideApproval = hideRequisitionApproval && !!r.isDept;
        const shownActions = hideApproval ? r.actions.filter((a) => a.key !== "approve" && a.key !== "reject") : r.actions;
        const actionable = shownActions.filter((a) => a.canAct);
        const awaiting = shownActions.find((a) => !a.canAct);
        const awaitingPlantApproval = hideApproval && r.status === "PENDING_APPROVAL";
        // A material/department requisition's PO is only created after the Plant
        // Manager approves the request — the Purchaser can't create it while it's
        // still pending, and "awaiting voucher" doesn't apply until the PO exists.
        const requisitionNeedsApproval = !!r.isDept && r.status === "PENDING_APPROVAL";
        const requisitionAwaitingPO = !!r.isDept && r.status === "APPROVED" && !r.po;
        // Dept/MRF at APPROVED with a PO but not yet PO-approved: the Plant
        // Manager approved the MRF and the PO is raised — now it awaits the
        // Approver's purchase-order approval.
        const requisitionAwaitingApproval = !!r.isDept && r.status === "APPROVED" && !!r.po && !r.poApproved;
        const statusLabel = requisitionAwaitingPO
          ? "Approved — awaiting Purchase Order"
          : requisitionAwaitingApproval
          ? "Plant Manager approved — awaiting purchase approval"
          : r.statusLabel;
        // Standalone department requisitions (Requisitions page): the Plant Manager
        // approves/rejects here, since there's no order Materials tab to do it on.
        const deptApproveActions =
          deptApprovalHere && r.status === "PENDING_APPROVAL"
            ? r.actions.filter((a) => (a.key === "approve" || a.key === "reject") && a.canAct)
            : [];
        return (
          <div key={r.id} className="rounded-md border bg-card p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                {(() => {
                  // A completed / rejected / cancelled request is done — its tick
                  // box is disabled so it can't be selected (for any role).
                  const locked = r.status === "COMPLETED" || r.status === "REJECTED" || r.status === "CANCELLED";
                  return (
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[#ED1C24] disabled:cursor-not-allowed disabled:opacity-40"
                      checked={sel.has(r.id)}
                      disabled={locked}
                      onChange={() => !locked && toggleSel(r.id)}
                      title={locked ? "This request is already completed" : "Select this material request"}
                      aria-label={`Select ${r.deptLabel}${r.mrfNo ? ` MRF #${r.mrfNo}` : ""}`}
                    />
                  );
                })()}
                {r.deptLabel}
                {r.mrfNo && <span className="font-normal text-muted-foreground">MRF #{r.mrfNo}</span>}
              </span>
              <Badge variant={r.variant}>{statusLabel}</Badge>
            </div>
            <ul className="ml-4 list-disc text-sm text-muted-foreground">
              {r.items.map((it, i) => {
                const issued = parseIssuedFromStockLine(it);
                if (issued) {
                  return (
                    <li key={i} className="marker:text-emerald-600">
                      {issued.desc}
                      <span className="ml-2 rounded bg-emerald-600/15 px-1.5 py-0.5 text-[10px] text-emerald-700">
                        Issued {issued.qty}{issued.unit ? ` ${issued.unit}` : ""} from stock
                      </span>
                    </li>
                  );
                }
                if (isToPurchaseLine(it)) {
                  return (
                    <li key={i} className="marker:text-amber-600">
                      {stripToPurchasePrefix(it)}
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700">To purchase</span>
                    </li>
                  );
                }
                return <li key={i}>{it}</li>;
              })}
            </ul>
            {/* Admin: edit the item lines in place (delete lives in the actions row). */}
            {adminManage && admin && !readOnly && <AdminPrEditDelete prId={r.id} items={r.items} showDelete={false} />}
            {/* Stock availability lookup — plus per-line issue-from-stock for the
                warehouse/admin on a requisition that hasn't been PO'd yet (issuing
                removes the line so the Purchaser only buys what's left). */}
            {showStockCheck && (
              canIssueStock && !r.po && (r.status === "PENDING_APPROVAL" || r.status === "APPROVED")
                ? <RequisitionStockCheck prId={r.id} items={r.items} stockItems={stockItems} canIssue />
                : <StockAvailabilityLookup terms={r.items} />
            )}
            {r.note && <p className="mt-1 text-xs text-muted-foreground">Note: {r.note}</p>}
            {r.trail.length > 0 && (
              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {r.trail.map((s, i) => <div key={i}>{s}</div>)}
              </div>
            )}
            {readOnly ? (
              deptApprovalHere && requisitionNeedsApproval ? (
                deptApproveActions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {deptApproveActions[0] && <ApproverHighlight role={deptApproveActions[0].roleLabel} />}
                    {deptApproveActions.map((a) => (
                      <Button
                        key={a.key}
                        size="sm"
                        variant={a.key === "reject" ? "outline" : "default"}
                        className="h-7 text-xs"
                        disabled={busy === r.id + a.key}
                        onClick={() => run(r.id, a.key)}
                      >
                        {busy === r.id + a.key ? "Saving…" : a.key === "approve" ? "Approve Material Request" : a.label}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Awaiting Plant Manager approval.</div>
                )
              ) : requisitionNeedsApproval ? (
                <div className="mt-2 text-xs text-muted-foreground">Awaiting Plant Manager approval on the order&rsquo;s Materials tab.</div>
              ) : requisitionAwaitingPO ? (
                <div className="mt-2 text-xs text-muted-foreground">Waiting on the Purchaser to prepare the Purchase Order — process in Purchasing</div>
              ) : r.status !== "REJECTED" && r.status !== "COMPLETED" && r.actions[0] ? (
                <div className="mt-2"><ApproverHighlight role={r.actions[0].roleLabel} detail="— process in Purchasing" /></div>
              ) : null
            ) : receivingId === r.id ? (
              <StockMatchPanel
                lines={r.items.map((it) => {
                  // Default the received qty to the good quantity: ordered minus any
                  // quantity still out on an unresolved supplier return. Editable.
                  const { qty, desc } = parseReqLine(it);
                  const returned = returnedQtyForLine(desc, r.returns ?? []);
                  return { label: it, qtyDefault: returned > 0 && qty > 0 ? String(Math.max(0, qty - returned)) : "" };
                })}
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
                {/* Always name who must act (designation + name), alongside the buttons. */}
                {shownActions[0] && <ApproverHighlight role={shownActions[0].roleLabel} />}
                {/* Approval/rejection/voucher can't proceed until the PO exists —
                    hide those buttons (rather than showing them disabled) and
                    show a hint instead, so nothing dead is clickable. EXCEPTION:
                    a warehouse/material requisition is approved (or rejected) by
                    the Plant Manager as the request itself (step 16), before the
                    Purchaser prepares the PO (step 17) — so those don't wait for a PO. */}
                {actionable
                  .filter((a) => !((a.key === "voucher" || a.key === "approve_po" || a.key === "reject_po" || ((a.key === "approve" || a.key === "reject") && !r.isDept)) && !r.po))
                  .map((a) => (
                    <Button
                      key={a.key}
                      size="sm"
                      variant={a.key === "reject" || a.key === "reject_po" ? "outline" : "default"}
                      className="h-7 text-xs"
                      disabled={busy === r.id + a.key}
                      onClick={() => (a.key === "receive" ? setReceivingId(r.id) : run(r.id, a.key))}
                    >
                      {busy === r.id + a.key ? "Saving…" : a.label}
                    </Button>
                  ))}
                {actionable.some((a) => a.key === "voucher" || a.key === "approve_po" || a.key === "reject_po" || ((a.key === "approve" || a.key === "reject") && !r.isDept)) && !r.po && (
                  <span className="text-xs text-muted-foreground">Create the Purchase Order first.</span>
                )}
              </div>
            ) : awaiting ? (
              <div className="mt-2"><ApproverHighlight role={awaiting.roleLabel} /></div>
            ) : awaitingPlantApproval ? (
              <div className="mt-2 text-xs text-muted-foreground">Awaiting Plant Manager approval on the order&rsquo;s Materials tab.</div>
            ) : null}

            {/* Supplier returns — disapproved items sent back for replacement.
                Like reconciliation, interactivity follows the row's own return
                permissions so it works on monitoring surfaces (e.g. Requisitions)
                for whoever may raise/resolve a return. */}
            <PurchaseReturnsPanel
              prId={r.id}
              returns={r.returns ?? []}
              canRaiseReturn={r.canRaiseReturn ?? false}
              advanceRoles={r.returnAdvanceRoles ?? []}
              readOnly={!(r.canRaiseReturn || (r.returnAdvanceRoles?.length ?? 0) > 0)}
              admin={admin}
              lineItems={r.items}
            />

            {/* Voucher reconciliation — actual spend vs the issued voucher.
                Only meaningful once the item is purchased (or already recorded),
                so it stays hidden through approval / PO / voucher preparation.
                Interactivity is driven by the row's own reconcile permissions,
                not the chain's read-only flag, so it works on monitoring
                surfaces (e.g. Requisitions) for whoever may reconcile. */}
            {showAmounts && r.reconcile && (canReconcileAt(r.status as PRStatus) || r.reconcile.recorded != null) && (
              <PurchaseReconcilePanel
                prId={r.id}
                reconcile={r.reconcile}
                canRecord={r.canRecordReconcile ?? false}
                canSettle={r.canSettleReconcile ?? false}
                canEscalate={r.canEscalateReconcile ?? false}
                canApprove={r.canApproveReconcile ?? false}
                readOnly={!(r.canRecordReconcile || r.canSettleReconcile || r.canEscalateReconcile || r.canApproveReconcile)}
                admin={admin}
              />
            )}

            {/* Supplier Purchase Order — a rejected request can't get a new PO, and
                a material/department requisition can't get one until the Plant
                Manager has approved the request (step 16 before step 17). */}
            {(r.status !== "REJECTED" || r.po) && !requisitionNeedsApproval && (
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
                  scanProducts={scanProducts}
                  onDone={() => setPoEditId(null)}
                />
              ) : r.po ? (
                <div className="flex flex-wrap items-end justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">{r.po.poNumber}</Badge>
                    {showSupplier && r.po.supplier.company && <span className="text-muted-foreground">{r.po.supplier.company}</span>}
                    {showAmounts && <span className="font-semibold tabular-nums">{formatCurrency(poTotals(r.po).total, "PHP")}</span>}
                    {showAmounts && poHasEwt(r.po) && (
                      <span className="text-muted-foreground tabular-nums">· Net {formatCurrency(poTotals(r.po).net, "PHP")}</span>
                    )}
                    {/* The PO document reveals supplier + amounts — only the roles
                        allowed to see those may open / print it. */}
                    {showSupplier && (
                    <a
                      href={viewHref(r.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#ED1C24] px-3 py-1.5 text-xs font-semibold text-[#ED1C24] transition-colors hover:bg-[#ED1C24]/10"
                    >
                      <Eye className="h-3.5 w-3.5" /> View PO
                    </a>
                    )}
                    {showSupplier && (
                    <a
                      href={printHref(r.id)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#c2141a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]/40"
                    >
                      <Printer className="h-3.5 w-3.5" /> Print PO &amp; 2307
                    </a>
                    )}
                  </div>
                  {/* Once approved, only an admin may edit the PO. */}
                  {!readOnly && r.canManagePO && (!r.poApproved || admin) && (
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

            {r.canOverride && <AdminPurchaseOverride prId={r.id} priorStatuses={r.priorStatuses ?? []} />}
          </div>
        );
      })}

      {/* Tick the POs above to add up their amounts (e.g. the total to release
          for several material requests at once). Hidden when a parent controls
          selection (the workspace shows one combined cross-order bar instead). */}
      {!controlled && poRows.length > 0 && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={toggleAll} className="font-medium text-primary hover:underline">
              {allSelected ? "Clear all" : "Select all"}
            </button>
            <span className="text-muted-foreground">
              {selectedPoRows.length} of {poRows.length} PO{poRows.length > 1 ? "s" : ""} selected
            </span>
          </div>
          {showAmounts && (
            <div className="tabular-nums">
              <span className="font-semibold">Total {formatCurrency(selTotals.total, "PHP")}</span>
              {selTotals.ewt > 0 && <span className="text-muted-foreground"> · less EWT {formatCurrency(selTotals.ewt, "PHP")}</span>}
              <span className="ml-1 font-semibold text-foreground"> · Net {formatCurrency(selTotals.net, "PHP")}</span>
            </div>
          )}
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
