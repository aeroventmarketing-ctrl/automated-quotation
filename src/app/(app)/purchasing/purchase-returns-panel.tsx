"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PurchaseReturnView } from "@/lib/purchase-chain-row";
import { returnPurchaseItems, resolvePurchaseReturn } from "../orders/actions";

/**
 * "Returns to supplier" panel: lists items disapproved on inspection and sent
 * back for replacement, lets an inspector raise a new return, and lets the
 * purchaser/warehouse mark the replacement received. Shared by the individual
 * chain rows and the combined-PO card. `prId` is the request (or anchor) to act
 * on. Read-only on the order page (list only).
 */
export function PurchaseReturnsPanel({
  prId,
  returns,
  canRaiseReturn,
  canResolveReturn,
  readOnly = false,
}: {
  prId: string;
  returns: PurchaseReturnView[];
  canRaiseReturn: boolean;
  canResolveReturn: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const unresolved = returns.filter((r) => !r.resolved).length;

  async function raise() {
    if (!items.trim() || !reason.trim()) { setErr("Fill in the item(s) and the reason."); return; }
    setBusy("raise"); setErr(null);
    try {
      await returnPurchaseItems(prId, { items, reason });
      setItems(""); setReason(""); setOpen(false);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function resolve(id: string) {
    const note = window.prompt("Note (optional) — e.g. replacement received, credited:", "") ?? undefined;
    setBusy(id); setErr(null);
    try {
      await resolvePurchaseReturn(prId, id, note);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  if (readOnly && returns.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {returns.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Returns to supplier{unresolved > 0 ? ` · ${unresolved} awaiting replacement` : " · all resolved"}
          </p>
          <ul className="mt-1 space-y-1.5">
            {returns.map((r) => (
              <li key={r.id} className="text-xs">
                <div className="font-medium text-foreground">{r.items}</div>
                <div className="text-muted-foreground">Reason: {r.reason}</div>
                <div className="text-muted-foreground">Returned by {r.raised}</div>
                {r.resolved ? (
                  <div className="text-emerald-700">✓ {r.resolved}</div>
                ) : (
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="font-medium text-amber-700">Awaiting replacement from supplier</span>
                    {!readOnly && canResolveReturn && (
                      <button
                        type="button"
                        onClick={() => resolve(r.id)}
                        disabled={busy === r.id}
                        className="rounded border border-emerald-600/50 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-600/10"
                      >
                        {busy === r.id ? "…" : "Replacement received"}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!readOnly && canRaiseReturn && (
        open ? (
          <div className="space-y-2 rounded-md border p-2">
            <div className="text-xs font-medium">Return item(s) to supplier</div>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Item(s) &amp; quantity being returned</span>
              <Input className="h-8" value={items} onChange={(e) => setItems(e.target.value)} placeholder="e.g. 3 pcs GI sheet 24ga — dented" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Reason for disapproval</span>
              <Input className="h-8" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. failed quality check / wrong specification" />
            </label>
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={busy === "raise"} onClick={raise}>
                {busy === "raise" ? "Saving…" : "Return to supplier"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-600/50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-600/10"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Return item to supplier
          </button>
        )
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
