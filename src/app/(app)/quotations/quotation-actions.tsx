"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { isNextControlFlowError } from "@/lib/utils";
import { deleteQuotation } from "./actions";

export function QuotationActions({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm(`Delete quotation "${label}"?\n\nThis removes its line items and cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteQuotation(id);
      router.refresh();
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      alert(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end">
      <Button
        size="sm"
        variant="ghost"
        title="Delete"
        disabled={busy}
        onClick={onDelete}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
