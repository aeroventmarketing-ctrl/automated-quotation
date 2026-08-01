"use client";

import { useState } from "react";
import { FileBarChart, FileSpreadsheet, FileText, Mail, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { emailSalesReport } from "./report/actions";

/** WON sales report generator — pick a date range, then view / print / export /
 *  email the deals each salesperson closed. Shown at the bottom of the WON tab. */
export function SalesReportPanel({ initialFrom, initialTo, emailReady }: { initialFrom: string; initialTo: string; emailReady: boolean }) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [showEmail, setShowEmail] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await emailSalesReport(from, to, recipient);
      setMsg({ ok: r.ok, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Send failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileBarChart className="h-4 w-4" /> Sales report — WON per salesperson
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Pick a date range; the report groups every WON inquiry by its salesperson with per-person and grand subtotals. View or print it, download Excel / PDF, or email it.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" disabled={!valid}>
              <a href={`/inquiries/report?${qs}`} target="_blank" rel="noopener noreferrer"><Eye className="h-4 w-4" /> View / Print</a>
            </Button>
            <Button asChild size="sm" variant="outline" disabled={!valid}>
              <a href={`/inquiries/report/xlsx?${qs}`}><FileSpreadsheet className="h-4 w-4" /> Excel</a>
            </Button>
            <Button asChild size="sm" variant="outline" disabled={!valid}>
              <a href={`/inquiries/report/pdf?${qs}`}><FileText className="h-4 w-4" /> PDF</a>
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
      </CardContent>
    </Card>
  );
}
