"use client";

/**
 * Inquiry status control shown beside the status badge. Lets staff mark an inquiry
 * LOST (which sends the one-shot "lost" thank-you) or reopen a lost one. WON is set
 * through the sale flow on the quotation, so it isn't offered here.
 */
import { useState, useTransition } from "react";
import { XCircle, RotateCcw } from "lucide-react";
import { markInquiryLost, reopenInquiry } from "../actions";

export function InquiryStatusControl({ inquiryId, status }: { inquiryId: string; status: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<void>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setErr(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
      }
    });
  };

  if (status === "WON") return null;

  return (
    <div className="flex flex-col items-end gap-1">
      {status === "LOST" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => reopenInquiry(inquiryId))}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
        >
          <RotateCcw className="h-3.5 w-3.5" /> {pending ? "Reopening…" : "Reopen inquiry"}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => markInquiryLost(inquiryId),
              "Mark this inquiry as LOST? If a lost thank-you message is enabled, it will be sent to the client.",
            )
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
        >
          <XCircle className="h-3.5 w-3.5" /> {pending ? "Marking…" : "Mark as lost"}
        </button>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
