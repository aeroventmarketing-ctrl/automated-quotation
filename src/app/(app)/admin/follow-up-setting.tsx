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
  inquiryEnabled: boolean;
  inquiryEveryDays: number;
  inquiryMaxNudges: number;
  maxPerRun: number;
  campaignStartAt: string | null;
}

interface RunItem {
  quoteNumber: string;
  company: string;
  nudge: number;
  action: "sent" | "preview" | "skipped";
  reason?: string;
  kind?: "quote" | "inquiry";
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
  inquiryEnabled: initInquiryEnabled,
  inquiryEveryDays: initInquiryEveryDays,
  inquiryMaxNudges: initInquiryMaxNudges,
  maxPerRun: initMaxPerRun,
  campaignStartAt: initCampaignStartAt,
  scheduleMode: initScheduleMode = "daily",
  sendHour: initSendHour = 9,
  intervalHours: initIntervalHours = 24,
  onSave,
  onPreview,
  onTest,
  onCampaign,
  onSchedule,
  defaultTestEmail = "",
}: {
  offsetsDays: number[];
  maxNudges: number;
  enabled: boolean;
  dryRun: boolean;
  inquiryEnabled: boolean;
  inquiryEveryDays: number;
  inquiryMaxNudges: number;
  maxPerRun: number;
  campaignStartAt: string | null;
  onSave: (input: Config) => Promise<Config>;
  onPreview: () => Promise<RunResult>;
  onTest: (nudge: number, toEmail?: string) => Promise<{ ok: boolean; to: string }>;
  onCampaign: (start: boolean) => Promise<Config>;
  scheduleMode?: "daily" | "interval";
  sendHour?: number;
  intervalHours?: number;
  onSchedule: (input: { scheduleMode: "daily" | "interval"; sendHour: number; intervalHours: number }) => Promise<{ scheduleMode: "daily" | "interval"; sendHour: number; intervalHours: number }>;
  defaultTestEmail?: string;
}) {
  const [daysStr, setDaysStr] = useState(offsetsDays.join(", "));
  const [max, setMax] = useState(String(maxNudges));
  const [enabled, setEnabled] = useState(initEnabled);
  const [dryRun, setDryRun] = useState(initDryRun);
  const [inquiryEnabled, setInquiryEnabled] = useState(initInquiryEnabled);
  const [inquiryEvery, setInquiryEvery] = useState(String(initInquiryEveryDays));
  const [inquiryMax, setInquiryMax] = useState(String(initInquiryMaxNudges));
  const [maxPerRun, setMaxPerRun] = useState(String(initMaxPerRun));
  const [campaignAt, setCampaignAt] = useState<string | null>(initCampaignStartAt);
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [schedMode, setSchedMode] = useState<"daily" | "interval">(initScheduleMode);
  const [schedHour, setSchedHour] = useState(initSendHour);
  const [schedInterval, setSchedInterval] = useState(initIntervalHours);
  const [schedBusy, setSchedBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testNudge, setTestNudge] = useState(1);
  const [testTo, setTestTo] = useState(defaultTestEmail);
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
      const wantEvery = parseInt(inquiryEvery, 10);
      const wantInqMax = parseInt(inquiryMax, 10);
      const wantPerRun = parseInt(maxPerRun, 10);
      const saved = await onSave({
        offsetsDays: offsets,
        maxNudges: Number.isFinite(wantMax) && wantMax >= 1 ? wantMax : offsets.length,
        enabled: next?.enabled ?? enabled,
        dryRun: next?.dryRun ?? dryRun,
        inquiryEnabled: next?.inquiryEnabled ?? inquiryEnabled,
        inquiryEveryDays: Number.isFinite(wantEvery) && wantEvery > 0 ? wantEvery : 30,
        inquiryMaxNudges: Number.isFinite(wantInqMax) && wantInqMax >= 1 ? wantInqMax : 6,
        maxPerRun: Number.isFinite(wantPerRun) && wantPerRun >= 1 ? wantPerRun : 100,
        campaignStartAt: campaignAt,
      });
      setDaysStr(saved.offsetsDays.join(", "));
      setMax(String(saved.maxNudges));
      setEnabled(saved.enabled);
      setDryRun(saved.dryRun);
      setInquiryEnabled(saved.inquiryEnabled);
      setInquiryEvery(String(saved.inquiryEveryDays));
      setInquiryMax(String(saved.inquiryMaxNudges));
      setMaxPerRun(String(saved.maxPerRun));
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

  async function sendTest() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await onTest(testNudge, testTo.trim() || undefined);
      setMsg({ ok: true, text: `Test (nudge #${testNudge}) sent to ${r.to}. Check that inbox (and spam folder). No client received it.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Test send failed" });
    } finally {
      setTesting(false);
    }
  }

  async function campaign(start: boolean) {
    if (start && !window.confirm("Start the backlog campaign today? Every open sent quote becomes due for its first follow-up now (throttled by Max emails per run).")) return;
    setCampaignBusy(true);
    setMsg(null);
    try {
      const saved = await onCampaign(start);
      setCampaignAt(saved.campaignStartAt);
      setMsg({ ok: true, text: start ? "Campaign started — the whole backlog is now due for its first nudge." : "Campaign stopped — back to the normal cadence." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setCampaignBusy(false);
    }
  }

  async function saveSchedule() {
    setSchedBusy(true);
    setMsg(null);
    try {
      const saved = await onSchedule({ scheduleMode: schedMode, sendHour: schedHour, intervalHours: schedInterval });
      setSchedMode(saved.scheduleMode);
      setSchedHour(saved.sendHour);
      setSchedInterval(saved.intervalHours);
      setMsg({ ok: true, text: "Send schedule saved." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save schedule" });
    } finally {
      setSchedBusy(false);
    }
  }
  const hourOpts = Array.from({ length: 24 }, (_, h) => h);
  const hour12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

  // How many nudges the cadence currently has — drives the test-nudge picker.
  const nudgeCount = Math.max(1, parseInt(max, 10) || parseDays().length || 1);
  const campaignOn = !!campaignAt;
  const campaignDateLabel = campaignAt ? new Date(campaignAt).toLocaleDateString() : "";

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
            <div className="space-y-1">
              <Label htmlFor="fu-perrun" className="text-xs">Max emails per run</Label>
              <Input id="fu-perrun" type="number" min={1} max={100} value={maxPerRun} onChange={(e) => setMaxPerRun(e.target.value)} className="h-9 w-28" />
            </div>
            <Button onClick={() => save()} disabled={busy} size="sm">
              {busy ? "Saving…" : "Save cadence"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            <strong>Max emails per run</strong> throttles each send for domain warm-up — e.g. set it to
            <strong> 24</strong> to email 24 clients per run; the rest stay due for the next run (max 100).
          </p>

          {/* Backlog campaign — make the whole open-sent-quote backlog due for its
              first nudge today, then let the throttle work through it. */}
          <div className={`mt-1 rounded-md border px-3 py-2 ${campaignOn ? "border-primary/40 bg-primary/5" : "border-dashed bg-muted/30"}`}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm">
                <div className="font-medium">Backlog follow-up campaign</div>
                <div className="text-xs text-muted-foreground">
                  {campaignOn
                    ? `Active since ${campaignDateLabel} — every open sent quote is due for its first nudge; later nudges are spaced from each client's first send.`
                    : "Off — only quotes that just crossed a cadence day (3, 7, 14…) are due."}
                </div>
              </div>
              {campaignOn ? (
                <Button size="sm" variant="outline" className="ml-auto" disabled={campaignBusy} onClick={() => campaign(false)}>
                  {campaignBusy ? "…" : "Stop campaign"}
                </Button>
              ) : (
                <Button size="sm" className="ml-auto" disabled={campaignBusy} onClick={() => campaign(true)}>
                  {campaignBusy ? "…" : "Start campaign today"}
                </Button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Use with <strong>Max emails per run</strong> (e.g. 24) to send the whole backlog gradually.
              Clients with no email are skipped automatically.
            </p>
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

          {/* Send schedule — when the automatic scheduler runs. */}
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="text-sm font-medium">Send schedule</div>
            <p className="mb-2 text-xs text-muted-foreground">When the automatic scheduler emails due clients.</p>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={schedMode}
                onChange={(e) => setSchedMode(e.target.value as "daily" | "interval")}
                disabled={schedBusy}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="daily">Once a day</option>
                <option value="interval">Every N hours</option>
              </select>
              {schedMode === "daily" ? (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  at
                  <select value={schedHour} onChange={(e) => setSchedHour(parseInt(e.target.value, 10))} disabled={schedBusy} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
                    {hourOpts.map((h) => <option key={h} value={h}>{hour12(h)}</option>)}
                  </select>
                  <span>Manila</span>
                </label>
              ) : (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  every
                  <input type="number" min={1} max={24} value={schedInterval} onChange={(e) => setSchedInterval(parseInt(e.target.value, 10) || 1)} disabled={schedBusy} className="h-8 w-20 rounded-md border bg-background px-2 text-sm" />
                  hours
                </label>
              )}
              <Button size="sm" variant="outline" disabled={schedBusy} onClick={saveSchedule}>
                {schedBusy ? "Saving…" : "Save schedule"}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The scheduler checks hourly and sends on this schedule (up to <strong>Max emails per run</strong> each time).
              Hourly checking needs a Vercel plan that runs the cron hourly; otherwise it effectively sends once a day.
            </p>
          </div>

          {/* Test-to-self: sends the real follow-up template to the logged-in admin
              only — safe way to check formatting + deliverability before going live.
              The nudge picker previews each nudge's own message. */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-muted-foreground">
              Preview nudge{" "}
              <select
                value={testNudge}
                onChange={(e) => setTestNudge(parseInt(e.target.value, 10) || 1)}
                disabled={testing}
                className="ml-1 h-8 rounded-md border bg-background px-2 text-sm"
              >
                {Array.from({ length: nudgeCount }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>#{n}</option>
                ))}
              </select>
            </label>
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              disabled={testing}
              placeholder="send to (email)…"
              className="h-8 w-60 rounded-md border bg-background px-2 text-sm"
            />
            <Button onClick={sendTest} disabled={testing} size="sm" variant="outline">
              {testing ? "Sending…" : "Send test email"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Sends the real template for that nudge to the address above (defaults to your own) — no client is affected. Great for warming up different inboxes.
            </span>
          </div>
        </div>

        <hr className="border-border" />

        {/* Inquiry "constant communication" check-ins */}
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">Inquiry check-ins (clients not yet quoted)</div>
            <p className="text-xs text-muted-foreground">
              Keep in touch with clients who have an open inquiry but no quotation sent yet — a periodic
              &ldquo;just checking in&rdquo; email for constant communication. Independent of the quote
              follow-ups above; still respects dry-run, opt-out, and the Resend setup.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="fu-inq-every" className="text-xs">Days between check-ins</Label>
              <Input id="fu-inq-every" type="number" min={1} value={inquiryEvery} onChange={(e) => setInquiryEvery(e.target.value)} className="h-9 w-32" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fu-inq-max" className="text-xs">Max check-ins</Label>
              <Input id="fu-inq-max" type="number" min={1} value={inquiryMax} onChange={(e) => setInquiryMax(e.target.value)} className="h-9 w-24" />
            </div>
            <Button onClick={() => save()} disabled={busy} size="sm">
              {busy ? "Saving…" : "Save check-in cadence"}
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={inquiryEnabled} disabled={busy} onChange={() => save({ inquiryEnabled: !inquiryEnabled })} />
            <div>
              <div className="text-sm font-medium">Automatic inquiry check-ins</div>
              <div className="text-xs text-muted-foreground">Emails un-quoted inquiry clients on the cadence above (still off while dry-run is on).</div>
            </div>
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
                        {it.kind === "inquiry" && <span className="ml-1 rounded bg-sky-500/15 px-1 py-0.5 text-[10px] text-sky-700">check-in</span>}
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
