"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markCommissionPaid } from "./actions";

export function MarkPaid({ id, paid }: { id: string; paid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Once paid, the commission stays paid — there's no "mark unpaid" any more.
  if (paid) return null;

  async function markPaid() {
    setBusy(true);
    try {
      await markCommissionPaid(id, true);
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={markPaid}>
      {busy ? "…" : "Mark paid"}
    </Button>
  );
}
