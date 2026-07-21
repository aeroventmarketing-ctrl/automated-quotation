"use client";

import { useState } from "react";
import { setJoNextNo } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Set the next base sequence number for a job-order series. Defaults to the
 * Fans & Blowers series (AFBM-JO); pass `title`, `prefix` and `onSave` to drive
 * a different department's series (Duct, Accessories, Motor Controller).
 */
export function JoNumberSetting({
  current,
  title = "Job Order numbering (Fans & Blowers)",
  prefix = "AFBM-JO",
  onSave = setJoNextNo,
}: {
  current: number;
  title?: string;
  prefix?: string;
  onSave?: (input: { next: number }) => Promise<number>;
}) {
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
      const saved = await onSave({ next: n });
      const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
      setMsg(`Saved. The next job order will be ${prefix}${yy}${String(saved).padStart(5, "0")}.`);
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
        <Label className="text-xs">Next JO sequence number</Label>
        <div className="flex items-end gap-2">
          <Input className="h-8 w-40" type="number" min={1} value={next} onChange={(e) => setNext(e.target.value)} />
          <Button className="h-8" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Set this to continue your series (e.g. 54 to carry on after {prefix}&hellip;00053). Formatted as
          {" "}{prefix}&lt;2-digit year&gt;&lt;5 digits&gt; and claimed once per order; a second, third job order on the
          same order gets an a / b / c suffix.
        </p>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
