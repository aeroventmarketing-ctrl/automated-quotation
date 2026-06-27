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

/** Physical size (inches) from the size label, falling back to the model code. */
function sizeOf(sel: SelectionResult): number {
  if (sel.sizeLabel) {
    const n = parseFloat(sel.sizeLabel);
    if (!Number.isNaN(n)) return n;
  }
  const m = sel.modelCode.match(/(\d{3,5})/);
  return m ? parseInt(m[1], 10) / 100 : 0;
}

export function SelectionTool({ priceMap }: { priceMap: Record<string, number> }) {
  const [airflow, setAirflow] = useState("");
  const [airflowUnit, setAirflowUnit] = useState("cfm");
  const [pressure, setPressure] = useState("");
  const [pressureUnit, setPressureUnit] = useState("inwg");
  const [tag, setTag] = useState("");
  const [drive, setDrive] = useState("belt");
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
          tag: tag || undefined,
          directDrive: drive === "direct",
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
              <option value="ls">L/s</option>
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
          <div className="space-y-1">
            <Label>Product</Label>
            <Select className="w-56" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All</option>
              <option value="CFAB">Forward Curved (CFAB)</option>
              <option value="CEB">Backward / Inclined (CEB)</option>
              <option value="CIEB">Centrifugal Inline Blower (CIEB)</option>
              <option value="SIEB">Square Inline Blower (SIEB)</option>
              <option value="DIDWCEB">Centrifugal Blower (DIDW) — Backward</option>
              <option value="DIDWCFAB">Centrifugal Blower (DIDW) — Forward</option>
              <option value="CABSISW">Cabinet Blower SISW (CABSISW)</option>
              <option value="CEBCAB">Cabinet Blower DIDW — Backward (CEBCAB)</option>
              <option value="CFABCAB">Cabinet Blower DIDW — Forward (CFABCAB)</option>
              <option value="EWF">Exhaust Wall Fan (EWF, belt)</option>
              <option value="EWFDD">Exhaust Wall Fan (EWFDD, direct)</option>
              <option value="FAWF">Fresh Air Wall Fan (FAWF, belt)</option>
              <option value="FAWFDD">Fresh Air Wall Fan (FAWFDD, direct)</option>
              <option value="PRV">Power Roof Ventilator (PRV, belt)</option>
              <option value="PRVDD">Power Roof Ventilator (PRVDD, direct)</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Drive</Label>
            <Select className="w-32" value={drive} onChange={(e) => setDrive(e.target.value)}>
              <option value="belt">Belt</option>
              <option value="direct">Direct (CEBDD)</option>
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
        <p className="text-sm text-muted-foreground">
          {drive === "direct"
            ? "No model meets this duty at a standard 2- or 4-pole direct-drive speed."
            : "No rated models match this duty."}
        </p>
      )}

      {results && results.length > 0 && (() => {
        // Center the list on the recommended (top HIGH) pick and show 3 sizes
        // smaller + the recommendation + 3 sizes bigger.
        const recommended = results.find((r) => r.confidence === "HIGH") ?? results[0];
        const bySize = [...results].sort((a, b) => sizeOf(a) - sizeOf(b));
        const idx = bySize.findIndex((r) => r.modelId === recommended.modelId);
        const windowed = bySize.slice(Math.max(0, idx - 3), idx + 4);
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Showing 3 sizes smaller and 3 sizes bigger around the recommended selection.
            </p>
            {windowed.map((sel) => {
              // Body-price factor on the CEB base: DIDWCFAB ÷0.9÷0.57, DIDWCEB
              // ÷0.57, CFAB ÷0.9.
              const tagFactor = /DIDWCFAB$/i.test(sel.modelCode)
                ? 1 / (0.9 * 0.57)
                : /DIDWCEB$/i.test(sel.modelCode)
                  ? 1 / 0.57
                  : /CFAB$/i.test(sel.modelCode)
                    ? 1 / 0.9
                    : 1;
              // Cabinet variants reuse the base catalogue but add a factor:
              // CABSISW ÷0.54, CEBCAB ÷0.54 (on DIDWCEB), CFABCAB ÷0.9 (on DIDWCFAB).
              const cabFactor =
                tag === "CABSISW" || tag === "CEBCAB" ? 1 / 0.54 : tag === "CFABCAB" ? 1 / 0.9 : 1;
              const body = (priceMap[sel.modelId] ?? 0) * tagFactor * cabFactor;
              const motor = lookupMotor(sel.motorHp, 3, sel.motorPole ?? 4);
              const estNet = body > 0 ? computeUnitPrice(body, motor?.price ?? 0, sel.motorHp, 3) : 0;
              const isRec = sel.modelId === recommended.modelId;
              return (
                <div
                  key={sel.modelId}
                  className={`rounded-md border p-3 text-sm ${isRec ? "border-primary ring-1 ring-primary" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {sel.modelCode}
                      {isRec && (
                        <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          RECOMMENDED
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {estNet > 0 && <span className="font-medium">≈ {formatCurrency(estNet)}</span>}
                      <ConfidenceBadge confidence={sel.confidence} />
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {sel.rpm} rpm · {sel.bhp} BHP → {sel.motorHp} HP{sel.motorPole ? ` ${sel.motorPole}-pole` : ""} motor
                    {sel.bladeAngle != null ? ` · ${sel.bladeAngle}° blade` : ""}
                    {sel.selectedAirflow_m3hr != null && sel.selectedAirflow_m3hr > sel.dutyAirflow_m3hr
                      ? ` · delivers ${Math.round(sel.selectedAirflow_m3hr / 1.6990108)} cfm`
                      : ""}
                    {sel.outletVelocity_fpm != null
                      ? ` · OV ${sel.outletVelocity_fpm}${sel.ovLimit_fpm != null ? `/${sel.ovLimit_fpm}` : ""} fpm`
                      : ""}
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
        );
      })()}
    </div>
  );
}
