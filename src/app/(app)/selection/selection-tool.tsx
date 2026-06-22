"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/utils";
import { lookupMotor, computeUnitPrice } from "@/lib/pricing/motors";
import { AlertTriangle } from "lucide-react";
import type { SelectionResult } from "@/lib/selection";

export function SelectionTool({ priceMap }: { priceMap: Record<string, number> }) {
  const [airflow, setAirflow] = useState("");
  const [airflowUnit, setAirflowUnit] = useState("cfm");
  const [pressure, setPressure] = useState("");
  const [pressureUnit, setPressureUnit] = useState("inwg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SelectionResult[] | null>(null);
  const [duty, setDuty] = useState<{ airflow_m3hr: number; staticPressure_pa: number } | null>(null);

  async function run() {
    setError(null);
    setResults(null);
    if (!airflow || !pressure) {
      setError("Enter both airflow and static pressure.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirement: {
            airflow: Number(airflow),
            airflowUnit,
            staticPressure: Number(pressure),
            pressureUnit,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Selection failed");
      setResults(data.results ?? []);
      setDuty(data.duty ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Selection failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <Label>Airflow</Label>
            <Input type="number" step="any" className="w-32" value={airflow} onChange={(e) => setAirflow(e.target.value)} placeholder="5000" />
          </div>
          <div className="space-y-1">
            <Label>Unit</Label>
            <Select className="w-28" value={airflowUnit} onChange={(e) => setAirflowUnit(e.target.value)}>
              <option value="cfm">CFM</option>
              <option value="m3hr">m³/hr</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Static pressure</Label>
            <Input type="number" step="any" className="w-32" value={pressure} onChange={(e) => setPressure(e.target.value)} placeholder="2" />
          </div>
          <div className="space-y-1">
            <Label>Unit</Label>
            <Select className="w-28" value={pressureUnit} onChange={(e) => setPressureUnit(e.target.value)}>
              <option value="inwg">in w.g.</option>
              <option value="pa">Pa</option>
            </Select>
          </div>
          <Button onClick={run} disabled={busy}>{busy ? "Selecting…" : "Run selection"}</Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {duty && (
        <p className="text-sm text-muted-foreground">
          Duty: {Math.round(duty.airflow_m3hr)} m³/hr @ {Math.round(duty.staticPressure_pa)} Pa
        </p>
      )}

      {results && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No rated models match this duty.</p>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2">
          {results.slice(0, 8).map((sel) => {
            const body = priceMap[sel.modelId] ?? 0;
            const motor = lookupMotor(sel.motorHp, 3, 4);
            const estNet = body > 0 ? computeUnitPrice(body, motor?.price ?? 0, sel.motorHp, 3) : 0;
            return (
              <div key={sel.modelId} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{sel.modelCode}</span>
                  <span className="flex items-center gap-2">
                    {estNet > 0 && <span className="font-medium">≈ {formatCurrency(estNet)}</span>}
                    <ConfidenceBadge confidence={sel.confidence} />
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {sel.rpm} rpm · {sel.bhp} BHP → {sel.motorHp} HP motor
                  {sel.outletVelocity_fpm != null ? ` · OV ${sel.outletVelocity_fpm}/${sel.ovLimit_fpm} fpm` : ""}
                </p>
                {sel.warnings.length > 0 && (
                  <p className="mt-1 flex items-start gap-1 text-xs text-amber-600">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {sel.warnings[0]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
