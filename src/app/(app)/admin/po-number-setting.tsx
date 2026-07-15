"use client";

import { useState } from "react";
import { setPoNextNo } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function PoNumberSetting({ current }: { current: number }) {
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
      const saved = await setPoNextNo({ next: n });
      const year = new Date().getFullYear();
      setMsg(`Saved. The next purchase order will be PO-AFBM${year}${String(saved).padStart(7, "0")}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Purchase Order numbering</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label className="text-xs">Next PO sequence number</Label>
        <div className="flex items-end gap-2">
          <Input className="h-8 w-40" type="number" min={1} value={next} onChange={(e) => setNext(e.target.value)} />
          <Button className="h-8" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Set this to continue your existing series (e.g. 504 to carry on after PO-AFBM…0000503). The number is
          formatted as PO-AFBM&lt;year&gt;&lt;7 digits&gt; and increments by 1 for each purchase order issued.
        </p>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
