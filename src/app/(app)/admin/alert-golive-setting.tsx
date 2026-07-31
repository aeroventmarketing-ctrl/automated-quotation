"use client";

import { useEffect, useState } from "react";
import { saveAlertGoLiveSetting } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MS_PH = 8 * 3600 * 1000; // Manila is UTC+8.

/** UTC ISO instant → "YYYY-MM-DDTHH:mm" as read in Manila (for the datetime input). */
function toManilaLocal(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + MS_PH).toISOString().slice(0, 16);
}

/** Manila "YYYY-MM-DDTHH:mm" → UTC ISO instant. */
function manilaToUtc(local: string): string | null {
  const d = new Date(`${local}:00+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Human label like "1 Aug 2026, 5:00 AM" for the stored UTC instant, in Manila. */
function manilaLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(t));
}

export function AlertGoLiveSetting({ on, at, onSave }: { on: boolean; at: string; onSave: typeof saveAlertGoLiveSetting }) {
  const [enabled, setEnabled] = useState(on);
  const [local, setLocal] = useState(toManilaLocal(at));
  const [savedAt, setSavedAt] = useState(at);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Live clock so the status line can tell whether the go-live moment has passed.
  // Null until mounted to avoid a server/client hydration mismatch.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const hasOpened = nowMs !== null && Date.parse(savedAt) <= nowMs;

  async function persist(nextEnabled: boolean, nextLocal: string) {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const utc = manilaToUtc(nextLocal);
      if (!utc) throw new Error("Enter a valid date and time.");
      const g = await onSave({ enabled: nextEnabled, at: utc });
      setEnabled(g.on);
      setSavedAt(g.at);
      setLocal(toManilaLocal(g.at));
      const passed = Date.parse(g.at) <= Date.now();
      setMsg(
        !g.on
          ? "Saved. The gate is off — alerts fire normally."
          : passed
            ? `Saved — but ${manilaLabel(g.at)} (Manila) is already in the past, so the gate has opened and alerts are live now. Set a future time to keep holding.`
            : `Saved. Alerts stay silent until ${manilaLabel(g.at)} (Manila), then only new ones fire.`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Alerts go-live — silence every alert until a launch moment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          When on, no notification or alert fires anywhere — approver alarm, dashboard feeds, activity bell,
          calendar reminders, nav dots, the production-status panel and the inline &ldquo;awaiting approval&rdquo; badges all stay quiet — until the
          moment below. From that moment on, an alert fires only for things that become pending <em>after</em> it, so the
          pre-launch backlog never rings. Nothing is muted, hidden or deleted — client details and the workflow are untouched.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={enabled} disabled={busy} onChange={(e) => persist(e.target.checked, local)} />
          Hold all alerts until the go-live moment
        </label>
        <div className="space-y-1">
          <Label className="text-xs">Go-live date &amp; time (Manila, UTC+8)</Label>
          <div className="flex flex-wrap items-end gap-2">
            <Input className="h-8 w-56" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} />
            <Button className="h-8" onClick={() => persist(enabled, local)} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Currently {!enabled ? (
            <>off — alerts fire normally.</>
          ) : hasOpened ? (
            <>the go-live moment has <span className="font-semibold text-emerald-700">passed — alerts are live</span> (since {manilaLabel(savedAt)} Manila). Set a future time to hold again.</>
          ) : (
            <>holding until <span className="font-semibold">{manilaLabel(savedAt)}</span> (Manila).</>
          )}
        </p>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
