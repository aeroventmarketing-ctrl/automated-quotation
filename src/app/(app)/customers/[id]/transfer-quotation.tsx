"use client";

import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { isNextControlFlowError } from "@/lib/utils";
import { transferQuotation } from "../actions";

/**
 * Per-row control to move a quotation to another client. Collapsed to a small
 * "Transfer" link; expands to a client picker. On success the server redirects
 * to the destination client's profile.
 */
export function TransferQuotation({
  quotationId,
  customers,
}: {
  quotationId: string;
  customers: { id: string; company: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [toId, setToId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!toId) return;
    setBusy(true);
    setErr(null);
    try {
      await transferQuotation(quotationId, toId);
      // server redirects to the target client on success
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      setErr(e instanceof Error ? e.message : "Transfer failed");
      setBusy(false);
    }
  }

  if (customers.length === 0) return null;

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setOpen(true)}>
        <ArrowRightLeft className="h-3.5 w-3.5" />
        Transfer
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <Select value={toId} onChange={(e) => setToId(e.target.value)} className="h-8 min-w-[12rem] text-sm">
          <option value="">— choose client —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.company}</option>
          ))}
        </Select>
        <Button size="sm" className="h-8" disabled={busy || !toId} onClick={submit}>{busy ? "Moving…" : "Move"}</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => { setOpen(false); setToId(""); setErr(null); }}>Cancel</Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
