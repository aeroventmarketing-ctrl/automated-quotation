"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmNotDuplicate } from "../actions";
import type { DuplicateHit } from "@/lib/duplicate-requests";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * "Possible duplicate" on a purchase request (lib/duplicate-requests) — the item
 * was already asked for on this order. A warning only; the Purchaser, Payment
 * Approver or admin presses **Not a duplicate** once they've checked.
 */
export function DuplicateNotice({ prId, hits, canConfirm }: { prId: string; hits: DuplicateHit[]; canConfirm: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (hits.length === 0) return null;

  async function confirm() {
    if (!window.confirm("Confirm this is NOT a duplicate request? The notice will be removed for everyone.")) return;
    setBusy(true);
    setErr(null);
    try {
      await confirmNotDuplicate(prId);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="mb-2 rounded-md border border-orange-400 bg-orange-50 p-2 text-xs dark:bg-orange-950/30" data-testid="duplicate-notice">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-semibold text-orange-900 dark:text-orange-200">
            <Copy className="h-3.5 w-3.5 shrink-0" />
            Possible duplicate request — already requested on this order
          </div>
          <ul className="mt-1 space-y-0.5 text-orange-900/90 dark:text-orange-200/90">
            {hits.map((h, i) => (
              <li key={i}>
                <b>{h.item}</b> ({h.qty} here) — first requested on <b>{h.firstRef}</b> · {when(h.firstAt)}
                <span className="text-orange-900/70 dark:text-orange-200/70"> ({h.firstQty}, {h.firstDept})</span>
              </li>
            ))}
          </ul>
        </div>
        {canConfirm && (
          <Button size="sm" variant="outline" className="h-7 shrink-0 border-orange-400 px-2 text-xs" disabled={busy} onClick={confirm}>
            {busy ? "…" : "Not a duplicate"}
          </Button>
        )}
      </div>
      {err && <p className="mt-1 text-destructive">{err}</p>}
    </div>
  );
}
