"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Fan affinity-law calculator for a fixed fan changing speed:
 *   Q ∝ N      (airflow ∝ speed)
 *   P ∝ N²     (static pressure ∝ speed²)
 *   W ∝ N³     (power ∝ speed³)
 * Enter a known operating point (speed + any of CFM / SP / BHP), then change by
 * a new speed, a target airflow, or a target pressure; the rest scale by the
 * resulting speed ratio. Units are passed through unchanged (ratios are unitless).
 */

const num = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Mode = "rpm" | "cfm" | "sp";

export function FanLawCalculator() {
  const [n1, setN1] = useState("");
  const [q1, setQ1] = useState("");
  const [p1, setP1] = useState("");
  const [w1, setW1] = useState("");
  const [mode, setMode] = useState<Mode>("rpm");
  const [target, setTarget] = useState("");

  const result = useMemo(() => {
    const N1 = num(n1);
    const Q1 = num(q1);
    const P1 = num(p1);
    const W1 = num(w1);
    const T = num(target);
    if (N1 == null) return { error: "Enter the known speed (RPM 1)." };
    if (T == null) return null;

    let r: number;
    if (mode === "rpm") r = T / N1;
    else if (mode === "cfm") {
      if (Q1 == null) return { error: "Enter the known airflow (CFM 1) to solve by airflow." };
      r = T / Q1;
    } else {
      if (P1 == null) return { error: "Enter the known pressure (SP 1) to solve by pressure." };
      r = Math.sqrt(T / P1);
    }
    if (!(r > 0) || !Number.isFinite(r)) return { error: "Check the values." };

    const N2 = mode === "rpm" ? T : N1 * r;
    return {
      r,
      N2,
      Q2: Q1 != null ? Q1 * r : null,
      P2: P1 != null ? P1 * r * r : null,
      W2: W1 != null ? W1 * r ** 3 : null,
    };
  }, [n1, q1, p1, w1, mode, target]);

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
              <Select className="w-44" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option value="rpm">New speed (RPM)</option>
                <option value="cfm">Target airflow (CFM)</option>
                <option value="sp">Target pressure (SP)</option>
              </Select>
            </div>
            <Field label="Value" value={target} onChange={setTarget} placeholder="new value" />
          </div>
        </div>

        {result && "error" in result && (
          <p className="text-sm text-muted-foreground">{result.error}</p>
        )}

        {result && !("error" in result) && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Speed ratio" value={`${r3(result.r)}×`} />
            <Stat label="New speed (RPM 2)" value={`${Math.round(result.N2)}`} />
            {result.Q2 != null && <Stat label="Airflow (CFM 2)" value={`${Math.round(result.Q2)}`} />}
            {result.P2 != null && <Stat label="Pressure (SP 2)" value={`${r1(result.P2)}`} />}
            {result.W2 != null && <Stat label="Power (BHP 2)" value={`${r1(result.W2)}`} />}
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
