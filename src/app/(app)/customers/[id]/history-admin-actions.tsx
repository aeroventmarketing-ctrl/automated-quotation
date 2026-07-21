"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNextControlFlowError } from "@/lib/utils";
import { deleteCustomerQuotation, clearCustomerOrder } from "../actions";

/** Admin Edit link — opens the quotation builder for a quote/order. */
function EditLink({ quotationId }: { quotationId: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
      <Link href={`/quotations/${quotationId}`}>
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Link>
    </Button>
  );
}

/** Inline confirm + destructive action, shared by the two row controls. */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
        <Trash2 className="h-3.5 w-3.5" />
        {label}
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{confirmLabel}</span>
        <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={busy} onClick={run}>{busy ? "…" : "Yes"}</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setConfirming(false); setErr(null); }}>No</Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

/** Admin controls for a Quotation-history row: Edit + Delete (removes the quote). */
export function QuotationRowActions({ customerId, quotationId }: { customerId: string; quotationId: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center justify-end gap-1">
      <EditLink quotationId={quotationId} />
      <ConfirmButton
        label="Delete"
        confirmLabel="Delete quote?"
        onConfirm={async () => { await deleteCustomerQuotation(customerId, quotationId); router.refresh(); }}
      />
    </div>
  );
}

/** Admin controls for an Order-history row: Edit + Remove order (clears the sale). */
export function OrderRowActions({ customerId, quotationId }: { customerId: string; quotationId: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center justify-end gap-1">
      <EditLink quotationId={quotationId} />
      <ConfirmButton
        label="Remove"
        confirmLabel="Remove order?"
        onConfirm={async () => { await clearCustomerOrder(customerId, quotationId); router.refresh(); }}
      />
    </div>
  );
}
