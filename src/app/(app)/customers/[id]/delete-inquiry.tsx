"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNextControlFlowError } from "@/lib/utils";
import { deleteInquiry } from "../actions";

/**
 * Admin-only control to remove an inquiry from a client's history. Inquiries that
 * still carry quotations can't be removed, so the control is hidden for those.
 */
export function DeleteInquiry({ inquiryId, hasQuotes }: { inquiryId: string; hasQuotes: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (hasQuotes) {
    return <span className="text-xs text-muted-foreground">Has quotes</span>;
  }

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await deleteInquiry(inquiryId);
      router.refresh();
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      setErr(e instanceof Error ? e.message : "Remove failed");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
        <Trash2 className="h-3.5 w-3.5" />
        Remove
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Remove?</span>
        <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={busy} onClick={remove}>{busy ? "Removing…" : "Yes"}</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setConfirming(false); setErr(null); }}>No</Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
