"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { advanceOrderStage } from "./actions";
import type { OrderStage, OrderStepKey } from "@/lib/order-workflow";

const STAGE_VARIANT: Record<OrderStage, "secondary" | "warning" | "success"> = {
  payment_review: "secondary",
  docs_checked: "warning",
  released: "success",
  in_production: "warning",
  jo_received: "warning",
  producing: "warning",
  production_finished: "success",
  final_pay_review: "secondary",
  final_pay_checked: "warning",
  final_pay_cleared: "warning",
  delivery_docs_ready: "warning",
  delivered: "warning",
  closed: "success",
};

/** Order stage badge + the current Phase 1 approval action (role-gated server-side). */
export function OrderStageActions({
  orderId,
  stage,
  stageLabel,
  nextStep,
  nextLabel,
  canAct,
  blockedReason = null,
  awaiting,
  hideStage,
}: {
  orderId: string;
  stage: OrderStage;
  stageLabel: string;
  nextStep: OrderStepKey | null;
  nextLabel: string | null;
  canAct: boolean;
  blockedReason?: string | null;
  awaiting: string | null;
  hideStage?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act() {
    if (!nextStep) return;
    setBusy(true);
    setErr(null);
    try {
      await advanceOrderStage(orderId, nextStep);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (hideStage) {
    return <span className="text-xs text-muted-foreground">In process</span>;
  }

  return (
    <div className="space-y-1">
      <Badge variant={STAGE_VARIANT[stage]}>{stageLabel}</Badge>
      {nextStep && canAct && (
        <div>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !!blockedReason} onClick={act}
            title={blockedReason ?? undefined}>
            {busy ? "Saving…" : nextLabel}
          </Button>
          {blockedReason && <div className="mt-0.5 text-[11px] text-amber-600">{blockedReason}</div>}
        </div>
      )}
      {!(nextStep && canAct) && awaiting && (
        <div className="text-[11px] text-muted-foreground">Awaiting {awaiting}</div>
      )}
      <div>
        <Link href={`/orders/${orderId}`} className="text-[11px] text-primary hover:underline">
          Workflow →
        </Link>
      </div>
      {err && <div className="text-[11px] text-destructive">{err}</div>}
    </div>
  );
}
