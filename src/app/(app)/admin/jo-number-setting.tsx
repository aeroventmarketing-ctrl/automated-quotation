"use client";

import { useState } from "react";
import { setJoNextNo } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function JoNumberSetting({ current }: { current: number }) {
  const [next, setNext] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const n = Math.floor(Number(next));
      if (!Number.isFinite(n) || n < 1) throw new Error("Enter a whole number of 1 or more.");
      const saved = await setJoNextNo({ next: n });
      const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
      setMsg(`Saved. The next job order will be AFBM-JO${yy}${String(saved).padStart(5, "0")}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Job Order numbering (Fans &amp; Blowers)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label className="text-xs">Next JO sequence number</Label>
        <div className="flex items-end gap-2">
          <Input className="h-8 w-40" type="number" min={1} value={next} onChange={(e) => setNext(e.target.value)} />
          <Button className="h-8" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Set this to continue your series (e.g. 54 to carry on after AFBM-JO&hellip;00053). Formatted as
          AFBM-JO&lt;2-digit year&gt;&lt;5 digits&gt; and claimed once per order; a second, third job order on the
          same order gets an a / b / c suffix.
        </p>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
