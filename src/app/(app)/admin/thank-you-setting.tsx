"use client";

/**
 * Admin editor for the WON / LOST "thank you" messages. Each side has its own
 * enable switch, an email (subject + body) and an SMS, using the same
 * {placeholders} as follow-ups. The branded email shell (signature + opt-out) is
 * added automatically. A shared dry-run switch computes without sending. The
 * message is sent once, automatically, when an inquiry is marked Won or Lost.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { THANK_YOU_PLACEHOLDERS, type ThankYouConfig, type ThankYouSide } from "@/lib/thank-you";

function SideEditor({
  title,
  hint,
  side,
  onChange,
  idp,
  outcome,
  onTest,
  defaultTestEmail,
}: {
  title: string;
  hint: string;
  side: ThankYouSide;
  onChange: (patch: Partial<ThankYouSide>) => void;
  idp: string;
  outcome: "won" | "lost";
  onTest?: (input: { outcome: "won" | "lost"; toEmail: string; subject: string; body: string }) => Promise<{ ok: true; to: string }>;
  defaultTestEmail?: string;
}) {
  const seg = Math.max(1, Math.ceil((side.sms || "").length / 160));
  const [testEmail, setTestEmail] = useState(defaultTestEmail ?? "");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function sendTest() {
    if (!onTest) return;
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await onTest({ outcome, toEmail: testEmail.trim(), subject: side.subject, body: side.body });
      setTestMsg({ ok: true, text: `Test sent to ${res.to}. Check your inbox (it uses the copy above).` });
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to send test" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={side.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          Enabled
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="space-y-1">
        <Label htmlFor={`${idp}-subj`} className="text-xs">Email subject</Label>
        <Input id={`${idp}-subj`} value={side.subject} onChange={(e) => onChange({ subject: e.target.value })} className="h-9" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idp}-body`} className="text-xs">Email message</Label>
        <Textarea id={`${idp}-body`} value={side.body} onChange={(e) => onChange({ body: e.target.value })} rows={6} placeholder="Include your own greeting. Separate paragraphs with a blank line." />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idp}-sms`} className="text-xs">SMS message <span className="font-normal text-muted-foreground">({side.sms.length} chars · {seg} segment{seg === 1 ? "" : "s"})</span></Label>
        <Textarea id={`${idp}-sms`} value={side.sms} onChange={(e) => onChange({ sms: e.target.value })} rows={3} placeholder="Keep it short — one 160-char segment is one SMS credit." />
      </div>

      {onTest && (
        <div className="space-y-1 border-t pt-2">
          <Label htmlFor={`${idp}-test`} className="text-xs text-muted-foreground">Send a test email (uses the copy above — no client is emailed)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id={`${idp}-test`} type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" className="h-9 w-56" />
            <Button type="button" size="sm" variant="outline" onClick={sendTest} disabled={testing}>{testing ? "Sending…" : "Send test"}</Button>
            {testMsg && <span className={`text-xs ${testMsg.ok ? "text-emerald-600" : "text-destructive"}`}>{testMsg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ThankYouSetting({
  initial,
  onSave,
  onTest,
  defaultTestEmail,
}: {
  initial: ThankYouConfig;
  onSave: (input: ThankYouConfig) => Promise<ThankYouConfig>;
  onTest?: (input: { outcome: "won" | "lost"; toEmail: string; subject: string; body: string }) => Promise<{ ok: true; to: string }>;
  defaultTestEmail?: string;
}) {
  const [cfg, setCfg] = useState<ThankYouConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await onSave(cfg);
      setCfg(saved);
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Thank-you messages (Won / Lost)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Sent <strong>once, automatically</strong>, to the client when an inquiry is marked <strong>Won</strong>
          {" "}(order confirmed via the sale flow) or <strong>Lost</strong> (the <em>Mark as lost</em> button on the
          inquiry). Email + SMS use the same delivery setup as follow-ups, respect the same per-client opt-out, and
          never repeat. Turn each side on below.
        </p>

        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={cfg.dryRun} onChange={(e) => setCfg((c) => ({ ...c, dryRun: e.target.checked }))} />
          <span><strong>Dry-run</strong> — compute &amp; log but don&apos;t actually send (turn off to send for real)</span>
        </label>

        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Placeholders</span> (auto-filled per client):{" "}
          {THANK_YOU_PLACEHOLDERS.map((p) => (
            <code key={p} className="mx-0.5 rounded bg-background px-1 py-0.5 text-[11px]">{p}</code>
          ))}
        </div>

        <SideEditor
          title="Won — thank-you"
          hint="A warm thank-you for a client whose order pushed through."
          side={cfg.won}
          idp="ty-won"
          outcome="won"
          onTest={onTest}
          defaultTestEmail={defaultTestEmail}
          onChange={(patch) => setCfg((c) => ({ ...c, won: { ...c.won, ...patch } }))}
        />
        <SideEditor
          title="Lost — thank-you"
          hint="A gracious note for a client who didn't proceed, keeping the door open."
          side={cfg.lost}
          idp="ty-lost"
          outcome="lost"
          onTest={onTest}
          defaultTestEmail={defaultTestEmail}
          onChange={(patch) => setCfg((c) => ({ ...c, lost: { ...c.lost, ...patch } }))}
        />

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy} size="sm">{busy ? "Saving…" : "Save thank-you messages"}</Button>
          {msg && <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-destructive"}`}>{msg.text}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
