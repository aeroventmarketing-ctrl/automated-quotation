"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  notifyClientReady,
  checkFinalPayment,
  confirmFinalPayment,
  prepareDeliveryDocs,
  markDelivered,
  fileDocuments,
} from "../actions";

interface Perms {
  canNotify: boolean;
  canCheckPay: boolean;
  canConfirmPay: boolean;
  canPrepDocs: boolean;
  canDeliver: boolean;
  canFile: boolean;
}

export function FulfillmentActions({
  orderId,
  stage,
  perms,
  documents,
}: {
  orderId: string;
  stage: string;
  perms: Perms;
  documents: { dr?: string; si?: string; or?: string; pod?: string };
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

      {/* Phase 6 */}
      {stage === "final_pay_cleared" &&
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

      {stage === "delivered" &&
        (perms.canFile ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => fileDocuments(orderId))}>
            {busy ? "Saving…" : "File documents — close order"}
          </Button>
        ) : awaiting("Accounting to file the documents"))}

      {stage === "closed" && (
        <p className="text-sm text-emerald-600">
          Order complete. DR {documents.dr || "—"} · SI {documents.si || "—"} · OR {documents.or || "—"}
          {documents.pod ? ` · POD ${documents.pod}` : ""}
        </p>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
