"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markCommissionPaid } from "./actions";

export function MarkPaid({ id, paid }: { id: string; paid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await markCommissionPaid(id, !paid);
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant={paid ? "outline" : "default"} className="h-7 text-xs" disabled={busy} onClick={toggle}>
      {busy ? "…" : paid ? "Mark unpaid" : "Mark paid"}
    </Button>
  );
}
