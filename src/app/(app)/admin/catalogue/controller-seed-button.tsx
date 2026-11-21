"use client";

/**
 * Bring the Motor Controller prices (DOL / Y-Δ / Y-YY starters, VFDs) into the
 * catalogue — the owner: *"add an option … so I can update the motor controller
 * price"*. Same shape and the same safety rule as the motor card beside it:
 * creates only, so pressing it again never undoes a price that was edited.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { seedMotorControllerCatalogue, type MotorSeedResult } from "../actions";

export function ControllerSeedButton({ present, expected, onShow }: { present: number; expected: number; onShow?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MotorSeedResult | null>(null);
  const missing = Math.max(0, expected - present);

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await seedMotorControllerCatalogue());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the motor controller prices.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Motor controller prices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy} onClick={run}>
            {busy ? "Adding…" : missing > 0 ? `Add ${missing} motor controller price${missing === 1 ? "" : "s"}` : "Check for new controllers"}
          </Button>
          {present > 0 && onShow && (
            <Button size="sm" variant="outline" onClick={onShow}>
              Show controller prices
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {present} of {expected} in the catalogue
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The prices a <b>Motor Controller</b> line fills in on a quotation — DOL, Y-Delta and Y-Double Y starters and
          Variable Frequency Drives, by phase, voltage and HP. Once added, edit them here like any catalogue row (or in bulk
          with the Excel / CSV above). Prices are <b>net, before VAT</b> — the quotation adds VAT (₱10,405 → ₱11,653.60).
          <b> Safe to press again</b> — a price you have edited is never overwritten.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            Added <b>{result.itemsCreated}</b> controller price{result.itemsCreated === 1 ? "" : "s"}
            {result.untouched > 0 && <> · Left <b>{result.untouched}</b> already in the catalogue untouched</>}
            {result.pricesCreated > result.itemsCreated && (
              <> · Filled in <b>{result.pricesCreated - result.itemsCreated}</b> missing price{result.pricesCreated - result.itemsCreated === 1 ? "" : "s"}</>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
