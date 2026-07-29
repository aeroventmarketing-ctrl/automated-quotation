"use client";

import { useState } from "react";
import { setCounterSaleNextNo } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function CounterSaleNumberSetting({ current, year }: { current: number; year: number }) {
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
      const saved = await setCounterSaleNextNo({ next: n });
      setMsg(`Saved. The next counter sale will be CS-${year}-${String(saved).padStart(5, "0")}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Counter Sales numbering</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label className="text-xs">Next counter-sale sequence number</Label>
        <div className="flex items-end gap-2">
          <Input className="h-8 w-40" type="number" min={1} value={next} onChange={(e) => setNext(e.target.value)} />
          <Button className="h-8" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The counter-sale number is <span className="font-mono">CS-{year}-{String(Math.max(1, Math.floor(Number(next) || 1))).padStart(5, "0")}</span> — a 5-digit
          running sequence that increments by 1 for each completed sale (the year is stamped at completion; the sequence itself doesn&apos;t reset).
          The number is only claimed when a sale is completed, so drafts don&apos;t consume one.
        </p>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
