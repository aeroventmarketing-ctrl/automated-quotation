"use client";

/**
 * "Lost" tickbox on the quotation header. Ticking it marks the quotation's inquiry
 * LOST — which stops the follow-up email/SMS nudges (the runner excludes WON/LOST)
 * and sends the one-shot "lost" thank-you (if enabled in admin). Unticking reopens
 * the inquiry to SENT. Hidden once an order is Won.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markInquiryLost, reopenInquiry } from "@/app/(app)/inquiries/actions";

export function LostQuotationToggle({ inquiryId, inquiryStatus }: { inquiryId: string; inquiryStatus: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lost, setLost] = useState(inquiryStatus === "LOST");
  const [err, setErr] = useState<string | null>(null);

  // A won order can't be marked lost from here.
  if (inquiryStatus === "WON") return null;

  function toggle(checked: boolean) {
    setErr(null);
    if (
      checked &&
      !window.confirm(
        "Mark this quotation as LOST?\n\nFollow-up email/SMS nudges will stop, and the lost thank-you message (if enabled) will be sent to the client.",
      )
    ) {
      return; // controlled checkbox snaps back to `lost`
    }
    setLost(checked);
    start(async () => {
      try {
        if (checked) await markInquiryLost(inquiryId);
        else await reopenInquiry(inquiryId);
        router.refresh();
      } catch (e) {
        setLost(!checked); // revert on failure
        setErr(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  return (
    <label className="flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent">
      <input type="checkbox" checked={lost} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
      <span className={lost ? "font-medium text-destructive" : "text-muted-foreground"}>Lost</span>
      {pending && <span className="text-xs text-muted-foreground">…</span>}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </label>
  );
}
