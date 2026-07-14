"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Per-client switch to pause/resume automatic follow-ups (checked = active). */
export function FollowUpOptOut({
  customerId,
  optOut: initial,
  onSave,
}: {
  customerId: string;
  optOut: boolean;
  onSave: (customerId: string, optOut: boolean) => Promise<boolean>;
}) {
  const [optOut, setOptOut] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = !optOut;

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      setOptOut(await onSave(customerId, !optOut));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Automatic follow-ups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={active}
            disabled={busy}
            onClick={toggle}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${active ? "bg-primary" : "bg-muted"} ${busy ? "opacity-60" : ""}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${active ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          <span className="text-sm font-medium">{active ? "Active" : "Paused"}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {active
            ? "This client receives automatic follow-up emails when a quotation is due."
            : "Paused — this client is skipped by automatic follow-ups. Manual follow-ups are unaffected."}
        </p>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
