"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { saveAiUsageLimitAction } from "../actions";

/** Admin control for the monthly AI-usage alert thresholds (0 = no limit). */
export function AiUsageLimit({ monthlyCalls, monthlyTokens }: { monthlyCalls: number; monthlyTokens: number }) {
  const router = useRouter();
  const [calls, setCalls] = useState(String(monthlyCalls || ""));
  const [tokens, setTokens] = useState(String(monthlyTokens || ""));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await saveAiUsageLimitAction({ monthlyCalls: Number(calls) || 0, monthlyTokens: Number(tokens) || 0 });
      setMsg("Saved.");
      router.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Set a monthly ceiling for AI usage. When this month crosses 80% you&rsquo;ll see an amber warning on the Admin dashboard;
        at 100% it turns red. Leave a field at 0 for no limit. This is an in-app alert — it does <b>not</b> stop AI calls;
        set a hard cap in the Anthropic console for that.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Monthly AI-call limit</Label>
          <Input className="h-8 w-40" type="number" min={0} value={calls} onChange={(e) => setCalls(e.target.value)} placeholder="0 (no limit)" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Monthly token limit (in + out)</Label>
          <Input className="h-8 w-48" type="number" min={0} value={tokens} onChange={(e) => setTokens(e.target.value)} placeholder="0 (no limit)" />
        </div>
        <Button size="sm" className="h-8" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save limits"}</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}
