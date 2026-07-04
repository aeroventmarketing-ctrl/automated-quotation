"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Reusable admin on/off card for a static-pressure lock (propeller / axial). */
export function SpLockSetting({
  title,
  description,
  enabled: initial,
  onSave,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onSave: (input: { enabled: boolean }) => Promise<boolean>;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      setEnabled(await onSave({ enabled: !enabled }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busy}
            onClick={toggle}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${enabled ? "bg-primary" : "bg-muted"} ${busy ? "opacity-60" : ""}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          <span className="text-sm font-medium">{enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
