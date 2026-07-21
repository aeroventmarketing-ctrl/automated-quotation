"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setCustomerTerms } from "../actions";

/**
 * Admin-only per-client "Terms client" switch. When on, a Purchase Order alone
 * confirms the sale and enables "Save sale"; when off, the client must submit all
 * core documents (PO, Computation, Quotation, RFQ/BOQ) plus a payment first.
 */
export function TermsToggle({ customerId, terms: initial }: { customerId: string; terms: boolean }) {
  const [terms, setTerms] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      setTerms(await setCustomerTerms(customerId, !terms));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Terms client (admin)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <label className="flex cursor-pointer items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={terms}
            disabled={busy}
            onClick={toggle}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${terms ? "bg-primary" : "bg-muted"} ${busy ? "opacity-60" : ""}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${terms ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          <span className="text-sm font-medium">{terms ? "On — PO alone can confirm the sale" : "Off — all documents required"}</span>
        </label>
        <p className="text-xs text-muted-foreground">
          {terms
            ? "This client is on terms: a Purchase Order alone enables Save sale and confirms the order."
            : "Regular client: the Purchase Order, Computation, Quotation and RFQ/BOQ (plus a down or full payment) must be attached before Save sale."}
        </p>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
