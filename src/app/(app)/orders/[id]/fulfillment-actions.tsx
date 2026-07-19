"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { closeDocsState, type SaleDoc } from "@/lib/sale";
import type { OrderCommissionFlow } from "@/lib/order-workflow";
import { CloseDocuments } from "./close-documents";
import { CommissionFlow } from "./commission-flow";
import {
  notifyClientReady,
  checkFinalPayment,
  confirmFinalPayment,
  qaTest,
  qaPlantCheck,
  qaTransfer,
  qaSalesCheck,
  prepareDeliveryDocs,
  markDelivered,
  approveDelivery,
  surrenderDeliveryDocs,
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

interface CommissionInfo {
  amount: number;
  currency: string;
  salesMonth: string;
  dueLabel: string;
  flow: OrderCommissionFlow;
}

export function FulfillmentActions({
  orderId,
  stage,
  perms,
  documents,
  commission,
  closeDocs,
  vatInclusive,
  canEditCloseDocs,
}: {
  orderId: string;
  stage: string;
  perms: Perms;
  documents: { dr?: string; si?: string; or?: string; pod?: string };
  commission: CommissionInfo | null;
  closeDocs: Record<string, SaleDoc[]>;
  vatInclusive: boolean;
  canEditCloseDocs: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dr, setDr] = useState("");
  const [si, setSi] = useState("");
  const [or, setOr] = useState("");
  const [pod, setPod] = useState("");

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
          <div className="space-y-2">
            <p className="text-sm font-medium">Prepare delivery documents</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="space-y-1"><Label className="text-xs">Delivery Receipt #</Label><Input className="h-8" value={dr} onChange={(e) => setDr(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Sales Invoice #</Label><Input className="h-8" value={si} onChange={(e) => setSi(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Official Receipt #</Label><Input className="h-8" value={or} onChange={(e) => setOr(e.target.value)} /></div>
            </div>
            <Button size="sm" disabled={busy} onClick={() => run(() => prepareDeliveryDocs(orderId, { dr, si, or }))}>
              {busy ? "Saving…" : "Save documents & approve delivery"}
            </Button>
          </div>
        ) : awaiting("Accounting to prepare the delivery documents"))}

      {stage === "delivery_docs_ready" && (
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            DR {documents.dr || "—"} · SI {documents.si || "—"} · OR {documents.or || "—"}
          </div>
          {perms.canDeliver ? (
            <div className="space-y-2">
              <div className="space-y-1"><Label className="text-xs">Proof of delivery (ref / note)</Label><Input className="h-8" value={pod} onChange={(e) => setPod(e.target.value)} /></div>
              <Button size="sm" disabled={busy} onClick={() => run(() => markDelivered(orderId, pod))}>
                {busy ? "Saving…" : "Mark delivered"}
              </Button>
            </div>
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

      {stage === "docs_surrendered" && (
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
        <div className="space-y-3">
          <p className="text-sm text-emerald-600">
            Order complete. DR {documents.dr || "—"} · SI {documents.si || "—"} · OR {documents.or || "—"}
            {documents.pod ? ` · POD ${documents.pod}` : ""}
          </p>

          {/* Sales commission fulfillment */}
          {commission && (
            <CommissionFlow
              orderId={orderId}
              amount={commission.amount}
              currency={commission.currency}
              salesMonth={commission.salesMonth}
              dueLabel={commission.dueLabel}
              flow={commission.flow}
              canApprove={perms.canApproveComm}
              canAccounting={perms.canAccountingComm}
            />
          )}
        </div>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
