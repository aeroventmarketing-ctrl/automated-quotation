"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Search, FileSpreadsheet, FileText, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emailSalesSummary } from "./actions";

/**
 * From/To range picker + Print / Excel / PDF / Email for the Sales Summary view
 * — the same controls as the WON Sales Report. Changing the range reloads the
 * same sheet with the new dates (payment-date basis is fixed). Hidden when
 * printing.
 */
export function SummaryControls({ from, to, emailReady }: { from: string; to: string; emailReady: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [showEmail, setShowEmail] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t);
  const qs = `from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;

  function apply() {
    router.push(`/reports/sales-summary?${qs}`);
  }

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await emailSalesSummary(f, t, recipient);
      setMsg({ ok: r.ok, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Send failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full space-y-3 print:hidden">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={f} max={t} onChange={(e) => setF(e.target.value)} className="h-9 w-[9.5rem]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={t} min={f} onChange={(e) => setT(e.target.value)} className="h-9 w-[9.5rem]" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={apply} disabled={!valid}>
            <Search className="h-4 w-4" /> View
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button asChild size="sm" variant="outline" disabled={!valid}>
            <a href={`/reports/sales-summary/xlsx?${qs}`}><FileSpreadsheet className="h-4 w-4" /> Excel</a>
          </Button>
          <Button asChild size="sm" variant="outline" disabled={!valid}>
            <a href={`/reports/sales-summary/pdf?${qs}`}><FileText className="h-4 w-4" /> PDF</a>
          </Button>
          <Button size="sm" variant="outline" disabled={!valid} onClick={() => setShowEmail((v) => !v)}>
            <Mail className="h-4 w-4" /> Email
          </Button>
        </div>
      </div>

      {showEmail && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label className="text-xs">Send report (PDF) to</Label>
            <Input type="email" className="h-9 w-64" placeholder="name@example.com" value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={!emailReady} />
          </div>
          <Button size="sm" onClick={send} disabled={busy || !emailReady || !recipient.trim()}>{busy ? "Sending…" : "Send email"}</Button>
          {!emailReady && <span className="text-xs text-amber-700">Email isn&rsquo;t configured yet (RESEND_API_KEY / FOLLOW_UP_FROM_EMAIL).</span>}
        </div>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-destructive"}`}>{msg.text}</p>}
    </div>
  );
}
