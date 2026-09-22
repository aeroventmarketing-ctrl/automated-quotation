"use client";

/**
 * Bring the induction-motor prices into the catalogue.
 *
 * They lived in three hand-edited TypeScript tables, so raising a TECO or
 * Hyundai price needed a developer and a deploy. This copies them in once, after
 * which they are ordinary catalogue rows: editable here, and bulk-editable
 * through the Excel/CSV round trip just above.
 *
 * The button is safe to press twice. The action only ever CREATES — a row that
 * is already there keeps its price, so pressing it again after a price increase
 * cannot undo the increase. That is worth saying on the screen rather than only
 * in the code, because "will this reset what I just typed?" is the question that
 * stops somebody pressing it at all.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { seedMotorCatalogue, type MotorSeedResult } from "../actions";

export function MotorSeedButton({ present, expected }: { present: number; expected: number }) {
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
      setResult(await seedMotorCatalogue());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the motor prices.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Motor prices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy} onClick={run}>
            {busy ? "Adding…" : missing > 0 ? `Add ${missing} motor price${missing === 1 ? "" : "s"}` : "Check for new motors"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {present} of {expected} in the catalogue
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Copies the TECO and Hyundai motor prices out of the program and into the catalogue, where you
          can edit them yourself. <b>Safe to press again</b> — a motor already in the list keeps the
          price it has, so this can never undo a price increase you have entered. Fan motors and the
          standalone TECO / Hyundai lines are listed separately, because they are priced separately.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            Added <b>{result.itemsCreated}</b> motor{result.itemsCreated === 1 ? "" : "s"}
            {result.untouched > 0 && (
              <>
                {" "}
                · Left <b>{result.untouched}</b> already in the catalogue untouched
              </>
            )}
            {result.pricesCreated > result.itemsCreated && (
              <>
                {" "}
                · Filled in <b>{result.pricesCreated - result.itemsCreated}</b> missing price
                {result.pricesCreated - result.itemsCreated === 1 ? "" : "s"}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
