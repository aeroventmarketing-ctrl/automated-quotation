"use client";

import { useState } from "react";
import { saveFanMotorBrandAction } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** Admin control for the default motor brand used to auto-generate Fans & Blowers JOs. */
export function FanMotorBrandSetting({ current }: { current: "TECO" | "Hyundai" }) {
  const [brand, setBrand] = useState<"TECO" | "Hyundai">(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const saved = await saveFanMotorBrandAction({ brand });
      setMsg(`Saved. New Fans & Blowers job orders will use ${saved} motors.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Fans &amp; Blowers — default motor brand</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label className="text-xs">Motor brand used when a Fans JO is auto-generated from a paid quotation</Label>
        <div className="flex items-end gap-2">
          <select
            className="h-8 w-40 rounded-md border bg-background px-2 text-sm"
            value={brand}
            onChange={(e) => setBrand(e.target.value as "TECO" | "Hyundai")}
          >
            <option value="TECO">TECO</option>
            <option value="Hyundai">Hyundai</option>
          </select>
          <Button className="h-8" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Change this when product availability shifts. It sets the brand new auto-generated Fans job orders start
          with (and pre-selects the matching Motor PH &amp; HP); engineers can still change the brand on any job order.
        </p>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
