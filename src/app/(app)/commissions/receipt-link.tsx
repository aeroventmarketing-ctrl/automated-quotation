"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, HandCoins } from "lucide-react";
import { confirmCommissionReceipt } from "./actions";
import { actionError } from "@/lib/action-result";
import { ProofList } from "./proof-of-payment";
import type { CommissionProofDoc } from "@/lib/commission-proof";

/**
 * The salesperson's own "I received this".
 *
 * Deliberately not a quiet tick in a table row. It is the one control on this
 * page that only its owner may press, it cannot be undone, and what it produces
 * is evidence — so it says the amount out loud, it says what pressing it means,
 * and it asks a second time before writing.
 *
 * Nobody else sees it: a manager looking at the same page sees the stamp it
 * leaves behind (`ReceivedStamp`), never the button.
 */
export function ReceiptLink({
  total,
  count,
  currency,
  proof = [],
  salespersonId,
}: {
  total: number;
  count: number;
  currency: string;
  /** The slips Accounting attached — the payee may open their own. */
  proof?: CommissionProofDoc[];
  salespersonId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const peso = (n: number) =>
    `${currency === "PHP" ? "₱" : `${currency} `}${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      const refusal = actionError(await confirmCommissionReceipt());
      if (refusal) { setErr(refusal); setBusy(false); setConfirming(false); return; }
      router.refresh();
    } catch {
      setErr("Couldn't record your confirmation. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            <HandCoins className="h-4 w-4 flex-none" />
            {peso(total)} has been released to you
          </p>
          <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-300/80">
            {count === 1 ? "One commission" : `${count} commissions`} — confirm below once the money is in your hands.
            Your confirmation is the record that you received it, so only you can give it, and it can&apos;t be taken back.
          </p>
          <p className="mt-1.5">
            <ProofList
              docs={proof}
              salespersonId={salespersonId}
              emptyNote="No proof of payment attached yet — ask Accounting if you haven't received it."
            />
          </p>
        </div>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-emerald-900 dark:text-emerald-200">Received {peso(total)}?</span>
            <button
              type="button"
              disabled={busy}
              onClick={confirm}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Recording…" : "Yes, I received it"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              Not yet
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-800 underline-offset-2 hover:bg-emerald-600/10 hover:underline dark:text-emerald-200"
          >
            Confirm I received this
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}

/**
 * What the link leaves behind — shown to everyone who can see the row, which is
 * the whole point of it. Until it exists, a paid row says so plainly rather than
 * saying nothing: "awaiting" is information too.
 */
export function ReceivedStamp({ receivedAt, receivedByName }: { receivedAt: string | null; receivedByName: string | null }) {
  if (!receivedAt) {
    return <span className="text-[10px] text-muted-foreground">Awaiting the payee&apos;s confirmation</span>;
  }
  const d = new Date(receivedAt);
  const when = d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
      <BadgeCheck className="h-3 w-3" />
      Received{receivedByName ? ` by ${receivedByName}` : ""} · {when}
    </span>
  );
}
