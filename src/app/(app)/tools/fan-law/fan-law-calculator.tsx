"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { solveFanLaw, isFanLawError, type FanLawMode } from "@/lib/hvac/fan-law";
import { positive as num, r1, r3 } from "@/lib/hvac/parse";

/**
 * Fan affinity-law calculator for a fixed fan changing speed. Enter a known
 * operating point (speed + any of CFM / SP / BHP), then change by a new speed,
 * a target airflow, or a target pressure; the rest scale by the resulting speed
 * ratio.
 *
 * The maths lives in `lib/hvac/fan-law` — shared with the public HVAC Tools page
 * on the storefront, so both stay in step.
 */

export function FanLawCalculator() {
  const [n1, setN1] = useState("");
  const [q1, setQ1] = useState("");
  const [p1, setP1] = useState("");
  const [w1, setW1] = useState("");
  const [mode, setMode] = useState<FanLawMode>("rpm");
  const [target, setTarget] = useState("");

  const result = useMemo(
    () =>
      solveFanLaw({
        n1: num(n1),
        q1: num(q1),
        p1: num(p1),
        w1: num(w1),
        mode,
        target: num(target),
      }),
    [n1, q1, p1, w1, mode, target],
  );

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-sm text-muted-foreground">
          Same fan, new speed: airflow ∝ speed, pressure ∝ speed², power ∝ speed³.
        </p>

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Known operating point</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Speed (RPM 1)" value={n1} onChange={setN1} placeholder="e.g. 1000" />
            <Field label="Airflow (CFM 1)" value={q1} onChange={setQ1} placeholder="optional" />
            <Field label="Pressure (SP 1)" value={p1} onChange={setP1} placeholder="optional" />
            <Field label="Power (BHP 1)" value={w1} onChange={setW1} placeholder="optional" />
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Change by</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Target</Label>
              <Select className="w-44" value={mode} onChange={(e) => setMode(e.target.value as FanLawMode)}>
                <option value="rpm">New speed (RPM)</option>
                <option value="cfm">Target airflow (CFM)</option>
                <option value="sp">Target pressure (SP)</option>
                <option value="bhp">Target power (BHP)</option>
              </Select>
            </div>
            <Field label="Value" value={target} onChange={setTarget} placeholder="new value" />
          </div>
        </div>

        {isFanLawError(result) && <p className="text-sm text-muted-foreground">{result.error}</p>}

        {result && !isFanLawError(result) && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Speed ratio" value={`${r3(result.ratio)}×`} />
            <Stat label="New speed (RPM 2)" value={`${Math.round(result.n2)}`} />
            {result.q2 != null && <Stat label="Airflow (CFM 2)" value={`${Math.round(result.q2)}`} />}
            {result.p2 != null && <Stat label="Pressure (SP 2)" value={`${r1(result.p2)}`} />}
            {result.w2 != null && <Stat label="Power (BHP 2)" value={`${r1(result.w2)}`} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input className="w-32" type="number" step="any" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
