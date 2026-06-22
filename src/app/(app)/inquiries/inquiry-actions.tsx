"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { isNextControlFlowError } from "@/lib/utils";
import { deleteInquiry } from "./actions";

export function InquiryActions({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (
      !confirm(
        `Delete inquiry "${label}"?\n\nThis also deletes its quotations. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await deleteInquiry(id);
      router.refresh();
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      alert(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-1">
      <Button asChild size="sm" variant="ghost" title="Edit / manage">
        <Link href={`/inquiries/${id}`}><Pencil className="h-4 w-4" /></Link>
      </Button>
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
