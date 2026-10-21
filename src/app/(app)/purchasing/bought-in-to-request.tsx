"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestBoughtInItems, cancelAutoRaisedBoughtInRequests } from "../orders/actions";
import type { BoughtInToRequest } from "@/lib/bought-in-pending-data";

/**
 * Bought-in orders whose items nobody has requested yet — nothing is requested
 * automatically any more (*"System must not automatically request any
 * material"*), so the Purchaser requests each one here or on the order page.
 *
 * For an admin, once: the requests the system DID raise by itself that are still
 * awaiting the Payment Approver, with a button to cancel them all.
 */
export function BoughtInToRequestPanel({
  orders,
  canRequest,
  autoRaisedAwaiting,
  admin,
}: {
  orders: BoughtInToRequest[];
  canRequest: boolean;
  autoRaisedAwaiting: number;
  admin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (orders.length === 0 && !(admin && autoRaisedAwaiting > 0) && !note) return null;

  async function request(o: BoughtInToRequest) {
    if (!window.confirm(`Request the bought-in items for order ${o.quoteNumber}? The request goes to the Payment Approver for purchase approval.`)) return;
    setBusy(o.id); setErr(null);
    try {
      const res = await requestBoughtInItems(o.id);
      if (res?.error) setErr(`${o.quoteNumber}: ${res.error}`);
      else router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally { setBusy(null); }
  }

  async function cancelAuto() {
    if (!window.confirm(`Cancel the ${autoRaisedAwaiting} request${autoRaisedAwaiting === 1 ? "" : "s"} the system raised automatically that the Payment Approver hasn't approved yet? Each order's items will then wait for the Purchaser to request them.`)) return;
    setBusy("auto"); setErr(null);
    try {
      const res = await cancelAutoRaisedBoughtInRequests();
      if (res?.error) setErr(res.error);
      else { setNote(`Cancelled ${res.cancelled ?? 0} automatically raised request${res.cancelled === 1 ? "" : "s"}.`); router.refresh(); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
      {admin && autoRaisedAwaiting > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 pb-2 text-sm dark:border-amber-900/60">
          <span>
            <b>{autoRaisedAwaiting}</b> bought-in request{autoRaisedAwaiting === 1 ? " was" : "s were"} raised automatically when payment cleared and {autoRaisedAwaiting === 1 ? "is" : "are"} still awaiting purchase approval.
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === "auto"} onClick={cancelAuto}>
            {busy === "auto" ? "Cancelling…" : "Cancel them"}
          </Button>
        </div>
      )}
      {note && <p className="text-xs text-emerald-700 dark:text-emerald-400">{note}</p>}
      {orders.length > 0 && (
        <>
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Bought-in orders to request ({orders.length})
          </div>
          <p className="text-xs text-muted-foreground">
            Payment is cleared on these orders. Nothing is requested automatically — the Purchaser requests the items, and the request goes to the Payment Approver.
          </p>
          <ul className="divide-y rounded-md border bg-background">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-start justify-between gap-2 p-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline">{o.quoteNumber}</Link>
                  {o.company && <span className="text-muted-foreground"> · {o.company}</span>}
                  <ul className="mt-0.5 list-disc pl-5 text-xs text-muted-foreground">
                    {o.lines.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </div>
                {canRequest ? (
                  <Button size="sm" className="h-8 text-xs" disabled={busy === o.id} onClick={() => request(o)}>
                    <ShoppingCart className="mr-1 h-3.5 w-3.5" /> {busy === o.id ? "Requesting…" : "Request bought-in items"}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Waiting for the Purchaser</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
