"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApproverHighlight } from "@/components/approver-highlight";
import { workflowRoleLabel } from "@/lib/workflow-roles";
import { closeDocsState, plantCloseState, deliveryUnsignedDocTypes, type SaleDoc } from "@/lib/sale";
import { CloseDocuments } from "./close-documents";
import { DeliveryDocsForm } from "./delivery-docs-form";
import { DeliveredForm } from "./delivered-form";
import { PickupPodForm } from "./pickup-pod-form";
import { PlantDocStep } from "./plant-doc-step";
import { FinalPaymentProof } from "./final-payment-proof";
import { BillingStatement } from "./billing-statement";
import { RecordPaymentBox } from "./record-payment-box";
import {
  notifyClientReady,
  checkFinalPayment,
  confirmFinalPayment,
  qaTest,
  qaPlantCheck,
  qaTransfer,
  qaSalesCheck,
  approveDelivery,
  surrenderDeliveryDocs,
  confirmDocsReceived,
} from "../actions";

/** A recorded sale payment surfaced (read-only) for the approver to review. */
export interface RecordedPayment {
  label: string;
  proof: SaleDoc | null;
}

interface Perms {
  canNotify: boolean;
  canCheckPay: boolean;
  canConfirmPay: boolean;
  canQaTest: boolean;
  canQaPlant: boolean;
  canQaTransfer: boolean;
  canQaSales: boolean;
  canPrepDocs: boolean;
  canDeliver: boolean;
  canApproveDelivery: boolean;
  canSurrender: boolean;
  canFile: boolean;
  canApproveComm: boolean;
  canAccountingComm: boolean;
}

export function FulfillmentActions({
  orderId,
  stage,
  perms,
  officePickup = false,
  plantPickup = false,
  fromStock = false,
  boughtIn = false,
  closeDocs,
  vatInclusive,
  zeroRated = false,
  canEditCloseDocs,
  recordedPayments = [],
  admin = false,
  approvers = {},
  restricted = false,
  canRecordPayment = false,
  currency = "PHP",
  orderAmount = 0,
  amountPaid = 0,
}: {
  orderId: string;
  stage: string;
  perms: Perms;
  /** Office-pickup order — from-stock fulfilment with a pickup-flavoured Phase 5. */
  officePickup?: boolean;
  /** Plant-pickup order — client collects at the plant; Warehouseman-driven tail. */
  plantPickup?: boolean;
  /** From-stock delivery order — the Warehouse runs the quality & quantity test. */
  fromStock?: boolean;
  /** Bought-in order — skips the plant quality steps; Sales does the single QC. */
  boughtIn?: boolean;
  closeDocs: Record<string, SaleDoc[]>;
  vatInclusive: boolean;
  /** Zero-rated order — also requires the Certificate of VAT Exempt/Zero Rated. */
  zeroRated?: boolean;
  canEditCloseDocs: boolean;
  recordedPayments?: RecordedPayment[];
  admin?: boolean;
  /** Workflow role key → assigned approver names, for the blinking highlight. */
  approvers?: Record<string, string[]>;
  /** Client-restricted (shop-floor) viewers don't see payment amounts / proof. */
  restricted?: boolean;
  /** Accounting / Payment Approver / Engineer / admin may record a payment. */
  canRecordPayment?: boolean;
  currency?: string;
  orderAmount?: number;
  amountPaid?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // A blinking, highlighted "awaiting approval" affordance that names the role(s)
  // and the assigned people. `roleKeys` resolve to names via the `approvers` map;
  // `salesRole` adds the Sales team (which isn't a workflow role). `detail` is the
  // action ("to confirm the final payment").
  const awaiting = (detail: string, roleKeys: string[] = [], salesRole = false) => {
    const names = [...new Set(roleKeys.flatMap((r) => approvers[r] ?? []))];
    const roleLabel = [salesRole ? "Sales" : null, ...roleKeys.map(workflowRoleLabel)].filter(Boolean).join(" / ");
    return <ApproverHighlight role={roleLabel || undefined} names={names} detail={detail} />;
  };

  return (
    <div className="space-y-2">
      {/* Record a payment (amount + optional proof) — reflects here and on the
          quotation tab. Available any time, including after delivery, so the
          balance can be collected. Accounting / Payment Approver / Engineer / admin. */}
      {!restricted && canRecordPayment && (
        <RecordPaymentBox orderId={orderId} currency={currency} orderAmount={orderAmount} amountPaid={amountPaid} />
      )}
      {/* Phase 5 */}
      {stage === "production_finished" &&
        (perms.canNotify ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => notifyClientReady(orderId))}>
            {busy ? "Saving…" : "Notify Client - Order Ready"}
          </Button>
        ) : awaiting("to notify the client the order is ready", [], true))}

      {/* Payments already recorded on the sale (incl. a one-time full payment) —
          read-only proof links so the approver can view the payment made before
          pressing "Final payment checked". */}
      {(stage === "final_pay_review" || stage === "final_pay_checked") && recordedPayments.length > 0 && (
        <div className="space-y-1 rounded-md border bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment made — for review</p>
          <div className="space-y-1">
            {recordedPayments.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="min-w-[13rem] font-medium">{p.label}</span>
                {p.proof ? (
                  <span className="inline-flex items-center gap-1.5">
                    <a href={`/api/sale-uploads/view?path=${encodeURIComponent(p.proof.path)}&name=${encodeURIComponent(p.proof.name)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                      <FileText className="h-3.5 w-3.5" /> {p.proof.name}
                    </a>
                    <a href={`/api/sale-uploads/view?path=${encodeURIComponent(p.proof.path)}&name=${encodeURIComponent(p.proof.name)}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View" aria-label="View">
                      <Eye className="h-3.5 w-3.5" />
                    </a>
                    <a href={`/api/sale-uploads?path=${encodeURIComponent(p.proof.path)}&download=1&name=${encodeURIComponent(p.proof.name)}`} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No proof attached.</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final payment proof — uploaded for the approver to review, then archived.
          Hidden from client-restricted (shop-floor) viewers like the rest of the
          payment/money data. */}
      {!restricted && (stage === "final_pay_review" || stage === "final_pay_checked") && (
        <>
          <BillingStatement orderId={orderId} initialFiles={closeDocs["billing_statement"] ?? []} canEdit={canEditCloseDocs} admin={admin} />
          <FinalPaymentProof orderId={orderId} initialFiles={closeDocs["final_payment"] ?? []} canEdit={canEditCloseDocs} admin={admin} />
        </>
      )}

      {stage === "final_pay_review" &&
        (perms.canCheckPay ? (
          <div className="space-y-1">
            {(closeDocs["final_payment"]?.length ?? 0) === 0 && (
              <p className="text-[11px] text-muted-foreground">Upload the final payment proof to enable Final Payment Checked.</p>
            )}
            <Button size="sm" disabled={busy || (closeDocs["final_payment"]?.length ?? 0) === 0} onClick={() => run(() => checkFinalPayment(orderId))}>
              {busy ? "Saving…" : "Final Payment Checked"}
            </Button>
          </div>
        ) : awaiting("to check the final payment", ["accounting"]))}

      {stage === "final_pay_checked" &&
        (perms.canConfirmPay ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => confirmFinalPayment(orderId))}>
            {busy ? "Saving…" : "Final Payment Confirmed"}
          </Button>
        ) : awaiting("to confirm the final payment", ["payment_approver"]))}

      {/* Quality assurance & transfer (after final payment is confirmed) */}
      {stage === "final_pay_cleared" &&
        (perms.canQaTest ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Quality testing</p>
            <p className="text-xs text-muted-foreground">{officePickup ? "The item undergoes quality testing by the 2nd Quality Inspector." : fromStock ? "The item undergoes quality & quantity testing by the Warehouse." : "The item undergoes quality testing by the Technical Head or an approved Quality Inspector."}</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => qaTest(orderId))}>
              {busy ? "Saving…" : "Quality Tested-Passed"}
            </Button>
          </div>
        ) : awaiting("to test quality", officePickup ? ["quality_inspector_2"] : fromStock ? ["warehouse"] : ["technical_head", "quality_inspector"], officePickup))}

      {/* Office pickup skips the plant-QC / transfer / Sales-2nd-QC steps and goes
          straight from the quality test to preparing the delivery documents. */}
      {stage === "qa_tested" && officePickup &&
        (perms.canPrepDocs ? (
          <DeliveryDocsForm orderId={orderId} initialDocs={closeDocs} vatInclusive={vatInclusive} admin={admin} officePickup={officePickup} />
        ) : awaiting("to prepare the delivery documents", ["accounting"]))}

      {stage === "qa_tested" && !officePickup &&
        (perms.canQaPlant ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Plant Manager quality &amp; quantity check</p>
            <p className="text-xs text-muted-foreground">The Plant Manager quality- and quantity-checks the order; only approved quality is transferred to the office.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => qaPlantCheck(orderId))}>
              {busy ? "Saving…" : "Quality & Quantity Approved"}
            </Button>
          </div>
        ) : awaiting("to quality & quantity check", ["plant_manager"]))}

      {/* Plant pick up: Warehouseman makes the delivery form (attaches the DR). */}
      {stage === "qa_plant_checked" && plantPickup &&
        (perms.canQaTransfer ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Make the delivery form</p>
            <p className="text-xs text-muted-foreground">The Warehouseman prepares and attaches the delivery form.</p>
            <PlantDocStep orderId={orderId} kind="form" initialFiles={closeDocs["delivery_form"] ?? []} admin={admin} />
          </div>
        ) : awaiting("to make the delivery form", ["warehouse"]))}

      {stage === "qa_plant_checked" && !plantPickup &&
        (perms.canQaTransfer ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Transfer items to office</p>
            <p className="text-xs text-muted-foreground">Logistics transfers the approved items to the office.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => qaTransfer(orderId))}>
              {busy ? "Saving…" : "Transferred to Office"}
            </Button>
          </div>
        ) : awaiting("to transfer the items to the office", ["logistics"]))}

      {/* Plant pick up: Plant Manager approves the delivery. */}
      {stage === "qa_transferred" && plantPickup &&
        (perms.canQaSales ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Approve delivery</p>
            <p className="text-xs text-muted-foreground">The Plant Manager approves the delivery form.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => qaSalesCheck(orderId))}>
              {busy ? "Saving…" : "Approve Delivery"}
            </Button>
          </div>
        ) : awaiting("to approve the delivery", ["plant_manager"]))}

      {stage === "qa_transferred" && !plantPickup &&
        (perms.canQaSales ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Sales quality &amp; quantity check</p>
            <p className="text-xs text-muted-foreground">The Sales in-charge makes {boughtIn ? "the" : "a 2nd"} quality and quantity check — any Sales team member or the Sales head can cover if the in-charge is absent or on leave.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => qaSalesCheck(orderId))}>
              {busy ? "Saving…" : boughtIn ? "Quality & Quantity Checked" : "Quality & Quantity Re-Checked"}
            </Button>
          </div>
        ) : awaiting(`to make the ${boughtIn ? "" : "2nd "}quality & quantity check`, ["quality_inspector_2"], true))}

      {/* Plant pick up: Warehouseman uploads the delivery form + proof of pick up. */}
      {stage === "qa_sales_checked" && plantPickup &&
        (perms.canDeliver ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Upload delivery form &amp; proof of pick up</p>
            <p className="text-xs text-muted-foreground">The Warehouseman uploads the signed delivery form and the proof of pick up.</p>
            <PlantDocStep orderId={orderId} kind="pod" initialFiles={closeDocs["pod"] ?? []} admin={admin} />
          </div>
        ) : awaiting("to upload the proof of pick up", ["warehouse"]))}

      {/* Phase 6 */}
      {stage === "qa_sales_checked" && !plantPickup &&
        (perms.canPrepDocs ? (
          <DeliveryDocsForm orderId={orderId} initialDocs={closeDocs} vatInclusive={vatInclusive} admin={admin} officePickup={officePickup} />
        ) : awaiting("to prepare the delivery documents", ["accounting"]))}

      {stage === "delivery_docs_ready" && (
        <div className="space-y-2">
          {/* Unsigned client documents attached at the prep step — stay visible
              so Logistics can print/carry them for signing on delivery. */}
          <div className="space-y-1">
            {deliveryUnsignedDocTypes(vatInclusive).map((t) => {
              const files = closeDocs[t.key] ?? [];
              if (!files.length) return null;
              return (
                <div key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="min-w-[13rem] font-medium">{t.label}</span>
                  {files.map((f) => (
                    <span key={f.path} className="inline-flex items-center gap-1.5">
                      <a href={`/api/sale-uploads/view?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(f.name)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                        <FileText className="h-3.5 w-3.5" /> {f.name}
                      </a>
                      <a href={`/api/sale-uploads/view?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(f.name)}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View" aria-label="View">
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                      <a href={`/api/sale-uploads?path=${encodeURIComponent(f.path)}&download=1&name=${encodeURIComponent(f.name)}`} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
          {officePickup ? (
            perms.canApproveDelivery ? (
              <PickupPodForm orderId={orderId} initialFiles={closeDocs["pod"] ?? []} admin={admin} />
            ) : awaiting("to upload the proof of pick up and approve", [], true)
          ) : perms.canDeliver ? (
            <DeliveredForm orderId={orderId} initialFiles={closeDocs["pod"] ?? []} admin={admin} />
          ) : awaiting("to deliver", ["logistics"])}
        </div>
      )}

      {/* Post-delivery closeout */}
      {stage === "delivered" &&
        (perms.canApproveDelivery ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{plantPickup ? "Approve proof of pick up" : "Approve proof of delivery"}</p>
            <p className="text-xs text-muted-foreground">{plantPickup ? "Sales approves the proof of pick up and marks the pick up successful." : "Sales approves the proof of delivery and marks the delivery successful."}</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => approveDelivery(orderId))}>
              {busy ? "Saving…" : plantPickup ? "Approve POD - Successful Pick Up" : "Approve POD-Successful Delivery"}
            </Button>
          </div>
        ) : awaiting(plantPickup ? "to approve the proof of pick up" : "to approve the proof of delivery", [], true))}

      {/* Plant pick up skips the surrender step — Accounting confirms receipt directly. */}
      {stage === "delivery_confirmed" && plantPickup &&
        (perms.canFile ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Confirm documents received</p>
            <p className="text-xs text-muted-foreground">Accounting confirms it received the client-signed documents before the order can be filed and closed.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => confirmDocsReceived(orderId))}>
              {busy ? "Saving…" : "Confirm Documents Received"}
            </Button>
          </div>
        ) : awaiting("to confirm it received the documents", ["accounting"]))}

      {stage === "delivery_confirmed" && !plantPickup &&
        ((officePickup ? perms.canApproveDelivery : perms.canSurrender) ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Surrender signed documents</p>
            <p className="text-xs text-muted-foreground">{officePickup ? "Sales surrenders the client-signed documents to accounting." : "Logistics surrenders the client-signed documents to accounting."}</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => surrenderDeliveryDocs(orderId))}>
              {busy ? "Saving…" : "Documents Surrendered to Accounting"}
            </Button>
          </div>
        ) : awaiting("to surrender the signed documents to accounting", officePickup ? [] : ["logistics"], officePickup))}

      {/* Two-party handshake: Logistics surrendered; Accounting must confirm
          receipt before the file-and-close step appears. */}
      {stage === "docs_surrendered" &&
        (perms.canFile ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Confirm documents received</p>
            <p className="text-xs text-muted-foreground">Logistics has surrendered the signed documents. Accounting confirms receipt before the order can be filed and closed.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => confirmDocsReceived(orderId))}>
              {busy ? "Saving…" : "Confirm Documents Received"}
            </Button>
          </div>
        ) : awaiting("to confirm it received the documents", ["accounting"]))}

      {stage === "docs_received" && (
        <CloseDocuments
          orderId={orderId}
          initialDocs={closeDocs}
          vatInclusive={vatInclusive}
          zeroRated={zeroRated}
          canEdit={canEditCloseDocs}
          canFile={perms.canFile}
          admin={admin}
          plantPickup={plantPickup}
        />
      )}

      {/* Closed but documents still incomplete — no commission yet; show the
          amber "File documents — close order (incomplete)" affordance + slots. */}
      {stage === "closed" && !(plantPickup ? plantCloseState(closeDocs, vatInclusive, zeroRated) : closeDocsState(closeDocs, vatInclusive, zeroRated)).complete && (
        <CloseDocuments
          orderId={orderId}
          initialDocs={closeDocs}
          vatInclusive={vatInclusive}
          zeroRated={zeroRated}
          canEdit={canEditCloseDocs}
          canFile={perms.canFile}
          admin={admin}
          plantPickup={plantPickup}
          closed
        />
      )}

      {stage === "closed" && (plantPickup ? plantCloseState(closeDocs, vatInclusive, zeroRated) : closeDocsState(closeDocs, vatInclusive, zeroRated)).complete && (
        <p className="text-sm text-emerald-600">Order complete — all documents filed.</p>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
