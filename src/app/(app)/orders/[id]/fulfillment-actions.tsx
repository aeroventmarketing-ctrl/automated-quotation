"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { closeDocsState, deliveryUnsignedDocTypes, type SaleDoc } from "@/lib/sale";
import { CloseDocuments } from "./close-documents";
import { DeliveryDocsForm } from "./delivery-docs-form";
import { DeliveredForm } from "./delivered-form";
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
  closeDocs,
  vatInclusive,
  canEditCloseDocs,
}: {
  orderId: string;
  stage: string;
  perms: Perms;
  closeDocs: Record<string, SaleDoc[]>;
  vatInclusive: boolean;
  canEditCloseDocs: boolean;
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

  const awaiting = (who: string) => <p className="text-sm text-muted-foreground">Awaiting {who}.</p>;

  return (
    <div className="space-y-2">
      {/* Phase 5 */}
      {stage === "production_finished" &&
        (perms.canNotify ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => notifyClientReady(orderId))}>
            {busy ? "Saving…" : "Notify client — order ready"}
          </Button>
        ) : awaiting("Sales to notify the client"))}

      {stage === "final_pay_review" &&
        (perms.canCheckPay ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => checkFinalPayment(orderId))}>
            {busy ? "Saving…" : "Final payment checked"}
          </Button>
        ) : awaiting("Accounting to check the final payment"))}

      {stage === "final_pay_checked" &&
        (perms.canConfirmPay ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => confirmFinalPayment(orderId))}>
            {busy ? "Saving…" : "Confirm final payment"}
          </Button>
        ) : awaiting("the Payment Approver to confirm"))}

      {/* Quality assurance & transfer (after final payment is confirmed) */}
      {stage === "final_pay_cleared" &&
        (perms.canQaTest ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Quality testing</p>
            <p className="text-xs text-muted-foreground">The item undergoes quality testing by the Technical Head or an approved Quality Inspector.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => qaTest(orderId))}>
              {busy ? "Saving…" : "Quality tested — pass"}
            </Button>
          </div>
        ) : awaiting("the Technical Head / Quality Inspector to test quality"))}

      {stage === "qa_tested" &&
        (perms.canQaPlant ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Plant Manager quality &amp; quantity check</p>
            <p className="text-xs text-muted-foreground">The Plant Manager quality- and quantity-checks the order; only approved quality is transferred to the office.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => qaPlantCheck(orderId))}>
              {busy ? "Saving…" : "Quality & quantity approved"}
            </Button>
          </div>
        ) : awaiting("the Plant Manager to quality & quantity check"))}

      {stage === "qa_plant_checked" &&
        (perms.canQaTransfer ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Transfer items to office</p>
            <p className="text-xs text-muted-foreground">Logistics transfers the approved items to the office.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => qaTransfer(orderId))}>
              {busy ? "Saving…" : "Transferred to office"}
            </Button>
          </div>
        ) : awaiting("Logistics to transfer the items to the office"))}

      {stage === "qa_transferred" &&
        (perms.canQaSales ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Sales 2nd quality &amp; quantity check</p>
            <p className="text-xs text-muted-foreground">The Sales in-charge makes a 2nd quality and quantity check — any Sales team member or the Sales head can cover if the in-charge is absent or on leave.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => qaSalesCheck(orderId))}>
              {busy ? "Saving…" : "Quality & quantity re-checked"}
            </Button>
          </div>
        ) : awaiting("the Sales in-charge (or any Sales team member) to make the 2nd quality & quantity check"))}

      {/* Phase 6 */}
      {stage === "qa_sales_checked" &&
        (perms.canPrepDocs ? (
          <DeliveryDocsForm orderId={orderId} initialDocs={closeDocs} vatInclusive={vatInclusive} />
        ) : awaiting("Accounting to prepare the delivery documents"))}

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
                      <a href={`/api/sale-uploads?path=${encodeURIComponent(f.path)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                        <FileText className="h-3.5 w-3.5" /> {f.name}
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
          {perms.canDeliver ? (
            <DeliveredForm orderId={orderId} initialFiles={closeDocs["pod"] ?? []} />
          ) : awaiting("Logistics to deliver")}
        </div>
      )}

      {/* Post-delivery closeout */}
      {stage === "delivered" &&
        (perms.canApproveDelivery ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Approve proof of delivery</p>
            <p className="text-xs text-muted-foreground">Sales approves the proof of delivery and marks the delivery successful.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => approveDelivery(orderId))}>
              {busy ? "Saving…" : "Approve POD — successful delivery"}
            </Button>
          </div>
        ) : awaiting("Sales to approve the proof of delivery"))}

      {stage === "delivery_confirmed" &&
        (perms.canSurrender ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Surrender signed documents</p>
            <p className="text-xs text-muted-foreground">Logistics surrenders the client-signed documents to accounting.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => surrenderDeliveryDocs(orderId))}>
              {busy ? "Saving…" : "Documents surrendered to accounting"}
            </Button>
          </div>
        ) : awaiting("Logistics to surrender the signed documents to accounting"))}

      {/* Two-party handshake: Logistics surrendered; Accounting must confirm
          receipt before the file-and-close step appears. */}
      {stage === "docs_surrendered" &&
        (perms.canFile ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Confirm documents received</p>
            <p className="text-xs text-muted-foreground">Logistics has surrendered the signed documents. Accounting confirms receipt before the order can be filed and closed.</p>
            <Button size="sm" disabled={busy} onClick={() => run(() => confirmDocsReceived(orderId))}>
              {busy ? "Saving…" : "Confirm documents received"}
            </Button>
          </div>
        ) : awaiting("Accounting to confirm it received the documents"))}

      {stage === "docs_received" && (
        <CloseDocuments
          orderId={orderId}
          initialDocs={closeDocs}
          vatInclusive={vatInclusive}
          canEdit={canEditCloseDocs}
          canFile={perms.canFile}
        />
      )}

      {/* Closed but documents still incomplete — no commission yet; show the
          amber "File documents — close order (incomplete)" affordance + slots. */}
      {stage === "closed" && !closeDocsState(closeDocs, vatInclusive).complete && (
        <CloseDocuments
          orderId={orderId}
          initialDocs={closeDocs}
          vatInclusive={vatInclusive}
          canEdit={canEditCloseDocs}
          canFile={perms.canFile}
          closed
        />
      )}

      {stage === "closed" && closeDocsState(closeDocs, vatInclusive).complete && (
        <p className="text-sm text-emerald-600">Order complete — all documents filed.</p>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
