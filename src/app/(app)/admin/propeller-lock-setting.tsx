"use client";

import { useState } from "react";
import { savePropellerSpLockSetting } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function PropellerLockSetting({ enabled: initial }: { enabled: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      const saved = await savePropellerSpLockSetting({ enabled: !enabled });
      setEnabled(saved);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Propeller Type static-pressure lock</CardTitle>
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
        <p className="text-xs text-muted-foreground">
          When enabled, Power Roof Ventilator and Wall Fan (Propeller Type) lines are capped at
          0.5&quot; w.g.: the builder warns above that and disables Run selection. Turn off to allow
          selecting these fans at any static pressure.
        </p>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
