"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFinishProduction } from "../actions";

/**
 * Admin-only "Mark production finished" for the whole order — closes every job
 * order still open and moves the order to "Production finished" in one press.
 * See `adminFinishProduction`.
 */
export function AdminFinishProduction({ orderId, openJobOrders }: { orderId: string; openJobOrders: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function press() {
    const what = openJobOrders > 0
      ? `This closes ${openJobOrders} open job order${openJobOrders === 1 ? "" : "s"} and moves the order to "Production finished".`
      : `There are no job orders on this order. It moves straight to "Production finished".`;
    if (!window.confirm(`${what}\n\nSales is then asked to notify the client. Continue?`)) return;
    setErr(null);
    start(async () => {
      const res = await adminFinishProduction(orderId);
      if (res.error) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
      <Button size="sm" onClick={press} disabled={pending}>
        <CheckCheck className="h-4 w-4" />
        {pending ? "Marking…" : "Mark production finished"}
      </Button>
      <span className="text-xs text-muted-foreground">
        Admin only — finishes production for the whole order{openJobOrders > 0 ? `, including ${openJobOrders} open job order${openJobOrders === 1 ? "" : "s"}` : ""}.
      </span>
      {err && <span className="w-full text-sm text-destructive">{err}</span>}
    </div>
  );
}
