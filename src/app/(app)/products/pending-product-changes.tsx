"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Check, X, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProductChangeView } from "@/lib/product-change";
import { approveProductChange, rejectProductChange, withdrawProductChange, type ProductSaveResult } from "./actions";

/** Re-throw a failed action's real reason so the caller's catch can display it.
 *  (Server Actions strip thrown messages in production, so we return them.) */
async function unwrap(p: Promise<ProductSaveResult>): Promise<void> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
}

/**
 * Product adds / saves / removals waiting on the Admin or Payment Approver.
 *
 * Shown to everyone who can manage products, not only to the person who decides:
 * the proposer needs to see that their save is queued and not lost, which is the
 * whole difference between "held for approval" and "silently didn't work".
 */
export function PendingProductChanges({ changes }: { changes: ProductChangeView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (changes.length === 0) return null;

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

  const mine = changes.filter((c) => c.mine).length;
  const decidable = changes.some((c) => c.canDecide);

  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="animate-approver-blink inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-200">
          <BellRing className="h-3 w-3" /> {changes.length} awaiting approval
        </span>
        <span className="text-muted-foreground">
          {decidable
            ? "Product changes need your confirmation before they reach the catalogue."
            : `Waiting on an Admin / the Payment Approver${mine > 0 ? ` — ${mine} of them yours` : ""}.`}
        </span>
      </div>

      {changes.map((c) => (
        <div key={c.id} className="rounded-md border bg-background/70 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{c.kindLabel}</span>
            <span className="font-medium">{c.productName}</span>
            {c.touchesPrice && (
              <span className="rounded-full border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-200">
                Price change
              </span>
            )}
            <span className="text-muted-foreground">
              Proposed by {c.proposedByName} · {new Date(c.proposedAt).toLocaleString()}
            </span>
          </div>

          {/* A change is confirmed field by field, not by its title. A CREATE or
              DELETE has nothing to compare, so it shows the stored summary. */}
          {c.diff.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {c.diff.map((d) => (
                <li key={d.field} className="text-muted-foreground">
                  <span className="font-medium text-foreground">{d.field}:</span>{" "}
                  <span className="line-through">{d.before}</span> → <span className="text-foreground">{d.after}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">{c.summary}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {c.canDecide && (
              <>
                <Button size="sm" className="h-7 text-xs" disabled={busy === c.id + "ok"} onClick={() => run(c.id + "ok", () => unwrap(approveProductChange(c.id)))}>
                  <Check className="mr-1 h-3.5 w-3.5" /> {busy === c.id + "ok" ? "…" : "Approve"}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === c.id + "no"}
                  onClick={() => { const r = window.prompt("Reason for rejection (optional):", "") ?? undefined; run(c.id + "no", () => unwrap(rejectProductChange(c.id, r))); }}>
                  <X className="mr-1 h-3.5 w-3.5" /> Reject
                </Button>
              </>
            )}
            {c.mine && !c.canDecide && (
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === c.id + "wd"} onClick={() => run(c.id + "wd", () => unwrap(withdrawProductChange(c.id)))}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> {busy === c.id + "wd" ? "…" : "Withdraw"}
              </Button>
            )}
          </div>
        </div>
      ))}
      {err && busy === null && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
