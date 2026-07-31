"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Per-client switch to add/remove them from the email-marketing list. */
export function MarketingListToggle({
  customerId,
  onList: initial,
  onSave,
}: {
  customerId: string;
  onList: boolean;
  onSave: (customerId: string, on: boolean) => Promise<boolean>;
}) {
  const [onList, setOnList] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      setOnList(await onSave(customerId, !onList));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Email-marketing list</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={onList}
            disabled={busy}
            onClick={toggle}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${onList ? "bg-primary" : "bg-muted"} ${busy ? "opacity-60" : ""}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${onList ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          <span className="text-sm font-medium">{onList ? "On the list" : "Not on the list"}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {onList
            ? "This client is included in marketing campaigns and automatic check-ins (unless they opt out above)."
            : "Add this client to receive marketing campaigns and automatic check-ins."}
        </p>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
