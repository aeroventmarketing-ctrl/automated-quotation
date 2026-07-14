"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Settings {
  offsetsDays: number[];
  maxNudges: number;
}

/** Admin card to edit the client follow-up cadence (days after send + max nudges). */
export function FollowUpSetting({
  offsetsDays,
  maxNudges,
  onSave,
}: {
  offsetsDays: number[];
  maxNudges: number;
  onSave: (input: Settings) => Promise<Settings>;
}) {
  const [daysStr, setDaysStr] = useState(offsetsDays.join(", "));
  const [max, setMax] = useState(String(maxNudges));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const offsets = daysStr
        .split(/[\s,]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (offsets.length === 0) {
        throw new Error("Enter at least one follow-up day, e.g. 3, 7, 14.");
      }
      const wantMax = parseInt(max, 10);
      const saved = await onSave({
        offsetsDays: offsets,
        maxNudges: Number.isFinite(wantMax) && wantMax >= 1 ? wantMax : offsets.length,
      });
      setDaysStr(saved.offsetsDays.join(", "));
      setMax(String(saved.maxNudges));
      setMsg({
        ok: true,
        text: `Saved — nudge on day ${saved.offsetsDays.join(", ")}, up to ${saved.maxNudges} time${saved.maxNudges === 1 ? "" : "s"}.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Client follow-up cadence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          When a quote is sent but not yet won, the follow-up list nudges the client on these days
          after it was sent, up to the maximum. It stops automatically once the deal is won or the
          quote expires.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="fu-days" className="text-xs">
              Follow-up days after sending
            </Label>
            <Input
              id="fu-days"
              value={daysStr}
              onChange={(e) => setDaysStr(e.target.value)}
              placeholder="3, 7, 14"
              className="h-9 w-48"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fu-max" className="text-xs">
              Max nudges
            </Label>
            <Input
              id="fu-max"
              type="number"
              min={1}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              className="h-9 w-24"
            />
          </div>
          <Button onClick={save} disabled={busy} size="sm">
            {busy ? "Saving…" : "Save cadence"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Separate days with commas. Max nudges is capped at the number of days you list.
        </p>
        {msg && (
          <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-destructive"}`}>{msg.text}</p>
        )}
      </CardContent>
    </Card>
  );
}
