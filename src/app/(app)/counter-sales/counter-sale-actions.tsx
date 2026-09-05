"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CounterSaleStatusKey } from "@/lib/counter-sale";
import { completeCounterSale, voidCounterSale, deleteCounterSaleDraft, markCounterPaymentCleared, setCounterPaymentDue } from "./actions";

/**
 * The action controls on a counter sale: complete a draft (with stock deduction
 * and an admin override when short), discard a draft, mark a non-cash payment
 * cleared / set its expected clearing date, and void a completed sale (admin).
 */
export function CounterSaleActions({
  saleId,
  status,
  adhocDescriptions = [],
  admin,
  nonCash,
  paymentCleared,
  paymentDue,
}: {
  saleId: string;
  status: CounterSaleStatusKey;
  /**
   * The lines that carry no inventory item, named. Completing the sale will not
   * deduct them, so the button says so before it happens rather than leaving it
   * to be discovered in the stock record later.
   */
  adhocDescriptions?: string[];
  admin: boolean;
  nonCash: boolean;
  paymentCleared: boolean;
  paymentDue: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [override, setOverride] = useState(false);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setErr(null);
    try { await fn(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status === "DRAFT" && (
          <>
            {admin && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" className="h-3.5 w-3.5" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                Override Stock
              </label>
            )}
            <Button
              size="sm"
              disabled={busy === "complete"}
              onClick={() => {
                // Say what will NOT happen, before it does not happen. A line
                // whose item was typed rather than picked sells the goods and
                // leaves the on-hand untouched — correct for a genuine ad-hoc
                // item, and a nasty surprise for a mis-keyed one.
                if (adhocDescriptions.length > 0 && !window.confirm(
                  `${adhocDescriptions.length} ${adhocDescriptions.length === 1 ? "line is" : "lines are"} not linked to an inventory item, so completing this sale will NOT deduct ${adhocDescriptions.length === 1 ? "it" : "them"} from stock:\n\n` +
                  `${adhocDescriptions.map((d) => `  • ${d}`).join("\n")}\n\n` +
                  "Complete the sale anyway?",
                )) return;
                run("complete", () => completeCounterSale(saleId, { overrideStock: override }));
              }}
            >
              {busy === "complete" ? "Completing…" : "Complete Sale"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy === "discard"} onClick={() => { if (window.confirm("Discard this draft sale?")) run("discard", () => deleteCounterSaleDraft(saleId)); }}>
              Discard
            </Button>
          </>
        )}
        {status === "COMPLETED" && nonCash && !paymentCleared && (
          <Button size="sm" variant="outline" disabled={busy === "clear"} onClick={() => run("clear", () => markCounterPaymentCleared(saleId))}>
            {busy === "clear" ? "Saving…" : "Mark Payment Cleared"}
          </Button>
        )}
        {status !== "VOID" && admin && status === "COMPLETED" && (
          <Button size="sm" variant="destructive" disabled={busy === "void"} onClick={() => { if (window.confirm("Void this sale? Its stock will be returned to inventory.")) run("void", () => voidCounterSale(saleId)); }}>
            Void
          </Button>
        )}
      </div>
      {/* Expected clearing date for an uncleared non-cash payment. */}
      {status === "COMPLETED" && nonCash && !paymentCleared && (
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Expected Clearing
          <Input type="date" className="h-7 w-auto text-xs" defaultValue={paymentDue} onChange={(e) => run("due", () => setCounterPaymentDue(saleId, e.target.value || null))} />
        </label>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
