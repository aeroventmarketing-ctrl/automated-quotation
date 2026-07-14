"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Config {
  offsetsDays: number[];
  maxNudges: number;
  enabled: boolean;
  dryRun: boolean;
}

interface RunItem {
  quoteNumber: string;
  company: string;
  nudge: number;
  action: "sent" | "preview" | "skipped";
  reason?: string;
}
interface RunResult {
  due: number;
  previewed: number;
  sent: number;
  skipped: number;
  live: boolean;
  reason?: string;
  items: RunItem[];
  errors: string[];
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"} ${disabled ? "opacity-60" : ""}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

/** Admin card for the client follow-up cadence + automated-sending controls. */
export function FollowUpSetting({
  offsetsDays,
  maxNudges,
  enabled: initEnabled,
  dryRun: initDryRun,
  onSave,
  onPreview,
}: {
  offsetsDays: number[];
  maxNudges: number;
  enabled: boolean;
  dryRun: boolean;
  onSave: (input: Config) => Promise<Config>;
  onPreview: () => Promise<RunResult>;
}) {
  const [daysStr, setDaysStr] = useState(offsetsDays.join(", "));
  const [max, setMax] = useState(String(maxNudges));
  const [enabled, setEnabled] = useState(initEnabled);
  const [dryRun, setDryRun] = useState(initDryRun);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);

  function parseDays(): number[] {
    return daysStr
      .split(/[\s,]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  async function save(next?: Partial<Config>) {
    setBusy(true);
    setMsg(null);
    try {
      const offsets = parseDays();
      if (offsets.length === 0) throw new Error("Enter at least one follow-up day, e.g. 3, 7, 14.");
      const wantMax = parseInt(max, 10);
      const saved = await onSave({
        offsetsDays: offsets,
        maxNudges: Number.isFinite(wantMax) && wantMax >= 1 ? wantMax : offsets.length,
        enabled: next?.enabled ?? enabled,
        dryRun: next?.dryRun ?? dryRun,
      });
      setDaysStr(saved.offsetsDays.join(", "));
      setMax(String(saved.maxNudges));
      setEnabled(saved.enabled);
      setDryRun(saved.dryRun);
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setPreviewing(true);
    setRun(null);
    try {
      setRun(await onPreview());
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Preview failed" });
    } finally {
      setPreviewing(false);
    }
  }

  const sendingLive = enabled && !dryRun;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Client follow-up cadence &amp; automatic emails</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cadence */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            When a quote is sent but not yet won, follow-ups are due on these days after it was sent,
            up to the maximum. Stops automatically once the deal is won or the quote expires.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="fu-days" className="text-xs">Follow-up days after sending</Label>
              <Input id="fu-days" value={daysStr} onChange={(e) => setDaysStr(e.target.value)} placeholder="3, 7, 14" className="h-9 w-48" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fu-max" className="text-xs">Max nudges</Label>
              <Input id="fu-max" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} className="h-9 w-24" />
            </div>
            <Button onClick={() => save()} disabled={busy} size="sm">
              {busy ? "Saving…" : "Save cadence"}
            </Button>
          </div>
        </div>

        <hr className="border-border" />

        {/* Delivery controls */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch checked={enabled} disabled={busy} onChange={() => save({ enabled: !enabled })} />
            <div>
              <div className="text-sm font-medium">Automatic follow-up emails</div>
              <div className="text-xs text-muted-foreground">Master switch for the daily scheduler.</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={dryRun} disabled={busy || !enabled} onChange={() => save({ dryRun: !dryRun })} />
            <div>
              <div className="text-sm font-medium">Dry run (don&apos;t actually send)</div>
              <div className="text-xs text-muted-foreground">
                Keep this on while testing — the scheduler computes and logs but sends nothing.
              </div>
            </div>
          </div>

          <div
            className={`rounded-md border px-3 py-2 text-xs ${
              sendingLive
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-dashed bg-muted/40 text-muted-foreground"
            }`}
          >
            {sendingLive ? (
              <>Live sending is <strong>ON</strong> — the daily scheduler will email clients who are due (needs a Resend key + sender address to actually deliver).</>
            ) : (
              <>Live sending is <strong>OFF</strong> — nothing is emailed automatically. Turn on the master switch and turn off dry-run to go live.</>
            )}
          </div>
        </div>

        <hr className="border-border" />

        {/* Preview run */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Button onClick={preview} disabled={previewing} size="sm" variant="outline">
              {previewing ? "Running…" : "Preview run now"}
            </Button>
            <span className="text-xs text-muted-foreground">Lists who is due today. Never sends.</span>
          </div>
          {run && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-2 font-medium text-foreground">
                {run.due} due · {run.previewed} would be emailed · {run.skipped} skipped
                {run.errors.length > 0 && ` · ${run.errors.length} errors`}
              </div>
              {run.items.length === 0 ? (
                <p className="text-muted-foreground">No follow-ups due right now.</p>
              ) : (
                <ul className="space-y-1">
                  {run.items.slice(0, 10).map((it, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        {it.company} <span className="text-muted-foreground">· {it.quoteNumber} · nudge #{it.nudge}</span>
                      </span>
                      <span className={it.action === "skipped" ? "text-amber-600" : "text-emerald-600"}>
                        {it.action === "preview" ? "would email" : it.action}
                        {it.reason ? ` (${it.reason})` : ""}
                      </span>
                    </li>
                  ))}
                  {run.items.length > 10 && (
                    <li className="text-muted-foreground">…and {run.items.length - 10} more</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-destructive"}`}>{msg.text}</p>}
      </CardContent>
    </Card>
  );
}
