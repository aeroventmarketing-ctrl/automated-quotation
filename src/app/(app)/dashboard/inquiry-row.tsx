"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InquiryStatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/utils";
import { isNextControlFlowError } from "@/lib/utils";
import { Pencil, Trash2 } from "lucide-react";
import { deleteInquiry } from "../inquiries/actions";

export interface RecentInquiry {
  id: string;
  company: string;
  itemCount: number;
  source: string;
  createdAt: string;
  status: string;
}

export function InquiryRow({ inq, isAdmin }: { inq: RecentInquiry; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (
      !confirm(
        `Delete inquiry "${inq.company}"?\n\nThis also deletes its quotations. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await deleteInquiry(inq.id);
      router.refresh();
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      alert(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-md border p-3 hover:bg-accent">
      <Link href={`/inquiries/${inq.id}`} className="min-w-0 flex-1">
        <div className="font-medium">{inq.company}</div>
        <div className="text-xs text-muted-foreground">
          {inq.itemCount} item(s) · {inq.source} · {formatDate(inq.createdAt)}
        </div>
      </Link>
      <div className="flex items-center gap-2 pl-3">
        <InquiryStatusBadge status={inq.status as never} />
        {isAdmin && (
          <>
            <Button asChild size="sm" variant="ghost" title="Edit / manage">
              <Link href={`/inquiries/${inq.id}`}><Pencil className="h-4 w-4" /></Link>
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
          </>
        )}
      </div>
    </div>
  );
}
