"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Eye, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StockActionView } from "@/lib/stock-action";
import { approveStockAction, rejectStockAction } from "./stock-action-actions";

const viewUrl = (path: string, name: string) => `/api/transfer-uploads/view?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;

/** Compact, flashing "awaiting approval" chip — names the missing approver's
 *  designation + people, small enough not to crowd the row. */
export function PendingChip({ pending }: { pending: StockActionView[] }) {
  if (pending.length === 0) return null;
  return (
    <span
      className="animate-approver-blink inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-200"
      title="Awaiting double-handshake approval"
    >
      <BellRing className="h-3 w-3 shrink-0" />
      {pending.length > 1 ? `${pending.length} pending` : "Pending"}
    </span>
  );
}

/** The expandable list of an item's pending double-handshake actions. */
export function PendingStockActions({ pending }: { pending: StockActionView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 py-1">
      {pending.map((a) => {
        const awaiting = [
          a.warehouseByName ? null : "Warehouseman",
          a.purchaserByName ? null : "Purchaser",
        ].filter(Boolean) as string[];
        return (
          <div key={a.id} className="rounded-md border border-amber-300 bg-amber-50/60 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/20">
            <div className="flex flex-wrap items-center gap-2">
              {/* Small flashing badge naming who still has to approve. */}
              <span className="animate-approver-blink inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-200">
                <BellRing className="h-3 w-3" /> AWAITING · {awaiting.join(" + ") || "applying…"}
              </span>
              <span className="font-medium text-foreground">{a.kindLabel}</span>
              <span className="text-muted-foreground">{a.summary}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>Proposed by {a.proposedByName}</span>
              <span className={a.warehouseByName ? "text-emerald-700" : ""}>Warehouse: {a.warehouseByName ?? "—"}</span>
              <span className={a.purchaserByName ? "text-emerald-700" : ""}>Purchaser: {a.purchaserByName ?? "—"}</span>
              {a.proof && (
                <a href={viewUrl(a.proof.path, a.proof.name)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Eye className="h-3.5 w-3.5" /> View form
                </a>
              )}
            </div>
            {(a.canApproveWarehouse || a.canApprovePurchaser) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" className="h-7 text-xs" disabled={busy === a.id + "ok"} onClick={() => run(a.id + "ok", () => approveStockAction(a.id))}>
                  <Check className="mr-1 h-3.5 w-3.5" /> {busy === a.id + "ok" ? "…" : "Approve"}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === a.id + "no"}
                  onClick={() => { const r = window.prompt("Reason for rejection (optional):", "") ?? undefined; run(a.id + "no", () => rejectStockAction(a.id, r)); }}>
                  <X className="mr-1 h-3.5 w-3.5" /> Reject
                </Button>
              </div>
            )}
            {err && busy === null && <p className="mt-1 text-destructive">{err}</p>}
          </div>
        );
      })}
    </div>
  );
}
