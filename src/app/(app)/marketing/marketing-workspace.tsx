"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { MarketingConfig } from "@/lib/marketing";

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"} ${disabled ? "opacity-60" : ""}`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

/** The automatic recurring "keeping in touch" check-in (the campaign builder is separate). */
export function MarketingWorkspace({
  config,
  listCount,
  emailReady,
  onSaveSettings,
}: {
  config: MarketingConfig;
  listCount: number;
  emailReady: boolean;
  onSaveSettings: (input: MarketingConfig) => Promise<MarketingConfig>;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [dryRun, setDryRun] = useState(config.dryRun);
  const [every, setEvery] = useState(String(config.everyDays));
  const [max, setMax] = useState(String(config.maxNudges));
  const [rSubject, setRSubject] = useState(config.subject);
  const [rBody, setRBody] = useState(config.body);
  const [rBusy, setRBusy] = useState(false);
  const [rMsg, setRMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveRecurring(next?: Partial<MarketingConfig>) {
    setRBusy(true); setRMsg(null);
    try {
      const wantEvery = parseInt(every, 10);
      const wantMax = parseInt(max, 10);
      const saved = await onSaveSettings({
        enabled: next?.enabled ?? enabled,
        dryRun: next?.dryRun ?? dryRun,
        everyDays: Number.isFinite(wantEvery) && wantEvery > 0 ? wantEvery : 30,
        maxNudges: Number.isFinite(wantMax) && wantMax >= 1 ? wantMax : 6,
        subject: rSubject,
        body: rBody,
      });
      setEnabled(saved.enabled); setDryRun(saved.dryRun);
      setEvery(String(saved.everyDays)); setMax(String(saved.maxNudges));
      setRSubject(saved.subject); setRBody(saved.body);
      setRMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setRMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save" });
    } finally { setRBusy(false); }
  }

  const sendingLive = enabled && !dryRun;

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Automatic recurring check-ins</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Keep a gentle &ldquo;keeping in touch&rdquo; email going out to your <strong>marketing list</strong> ({listCount} client{listCount === 1 ? "" : "s"})
          on a schedule — set once, runs itself. Each client gets it at most every few weeks, up to the cap.
        </p>
        <div className="space-y-1">
          <Label className="text-xs">Subject</Label>
          <Input value={rSubject} onChange={(e) => setRSubject(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Message</Label>
          <Textarea rows={4} value={rBody} onChange={(e) => setRBody(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Days between check-ins</Label>
            <Input type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} className="h-9 w-32" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max check-ins per client</Label>
            <Input type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} className="h-9 w-24" />
          </div>
          <Button size="sm" onClick={() => saveRecurring()} disabled={rBusy}>{rBusy ? "Saving…" : "Save message & cadence"}</Button>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={enabled} disabled={rBusy} onChange={() => saveRecurring({ enabled: !enabled })} />
          <div><div className="text-sm font-medium">Automatic recurring check-ins</div><div className="text-xs text-muted-foreground">Emails the marketing list on the cadence above.</div></div>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={dryRun} disabled={rBusy || !enabled} onChange={() => saveRecurring({ dryRun: !dryRun })} />
          <div><div className="text-sm font-medium">Dry run (don&apos;t actually send)</div><div className="text-xs text-muted-foreground">Keep this on while testing — computes and logs but sends nothing.</div></div>
        </div>
        <div className={`rounded-md border px-3 py-2 text-xs ${sendingLive ? "border-amber-300 bg-amber-50 text-amber-800" : "border-dashed bg-muted/40 text-muted-foreground"}`}>
          {sendingLive
            ? <>Recurring check-ins are <strong>ON</strong> — the daily scheduler emails due marketing-list clients{emailReady ? "" : " (once a Resend key + sender are set)"}.</>
            : <>Recurring check-ins are <strong>OFF</strong> — nothing is emailed automatically. Turn the switch on and turn off dry-run to go live.</>}
        </div>
        {rMsg && <p className={`text-xs ${rMsg.ok ? "text-emerald-600" : "text-destructive"}`}>{rMsg.text}</p>}
      </CardContent>
    </Card>
  );
}
