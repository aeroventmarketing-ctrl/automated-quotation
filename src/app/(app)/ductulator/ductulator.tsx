"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Duct sizing calculator ("ductulator") for round and rectangular galvanized
 * duct at standard air. Given an airflow and either a target velocity or a
 * friction rate, it solves the round diameter and the complementary quantity,
 * and converts the round duct to a rectangular equivalent (Huebscher).
 *
 * I-P relations (Q in cfm, d in inches, V in fpm, friction in in.wg/100 ft):
 *   V = 576·Q / (π·d²) = 183.346·Q / d²
 *   ΔP/100ft = 0.109136 · Q^1.9 / d^5.02      (ASHRAE galvanized-steel fit)
 *   De(rect) = 1.30 · (a·b)^0.625 / (a+b)^0.25  (equivalent round diameter)
 */

const CFM_PER_M3HR = 1 / 1.69901082; // m³/h -> cfm
const CFM_PER_LPS = 2.11888; // L/s -> cfm
const FPM_PER_MS = 196.850394; // m/s -> fpm
const PA_PER_M_FROM_INWG100 = 249.0889 / 30.48; // (in.wg/100ft) -> Pa/m  ≈ 8.1722
const VK = 576 / Math.PI; // 183.346

const toCfm = (v: number, unit: string) =>
  unit === "m3hr" ? v * CFM_PER_M3HR : unit === "lps" ? v * CFM_PER_LPS : v;
const toFpm = (v: number, unit: string) => (unit === "ms" ? v * FPM_PER_MS : v);
const toInwg100 = (v: number, unit: string) => (unit === "pam" ? v / PA_PER_M_FROM_INWG100 : v);

const velFromDia = (qCfm: number, dIn: number) => (VK * qCfm) / (dIn * dIn);
const fricFromDia = (qCfm: number, dIn: number) =>
  (0.109136 * Math.pow(qCfm, 1.9)) / Math.pow(dIn, 5.02);

/** Rectangular side b (in) whose equivalent round diameter matches De, given side a. */
function rectOtherSide(deIn: number, aIn: number): number | null {
  if (!(deIn > 0) || !(aIn > 0)) return null;
  const equivDe = (a: number, b: number) =>
    (1.3 * Math.pow(a * b, 0.625)) / Math.pow(a + b, 0.25);
  let lo = 0.5;
  let hi = 600;
  if (equivDe(aIn, hi) < deIn) return null; // can't reach this De at the given side
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (equivDe(aIn, mid) < deIn) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const num = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

export function Ductulator() {
  const [airflow, setAirflow] = useState("");
  const [airflowUnit, setAirflowUnit] = useState("cfm");
  const [method, setMethod] = useState<"friction" | "velocity">("friction");
  const [friction, setFriction] = useState("0.1");
  const [frictionUnit, setFrictionUnit] = useState("inwg100");
  const [velocity, setVelocity] = useState("1500");
  const [velocityUnit, setVelocityUnit] = useState("fpm");
  const [rectSide, setRectSide] = useState("");

  const result = useMemo(() => {
    const q = num(airflow);
    if (q == null) return null;
    const qCfm = toCfm(q, airflowUnit);

    let dIn: number;
    if (method === "velocity") {
      const v = num(velocity);
      if (v == null) return null;
      const vFpm = toFpm(v, velocityUnit);
      dIn = Math.sqrt((VK * qCfm) / vFpm);
    } else {
      const f = num(friction);
      if (f == null) return null;
      const fInwg = toInwg100(f, frictionUnit);
      dIn = Math.pow((0.109136 * Math.pow(qCfm, 1.9)) / fInwg, 1 / 5.02);
    }
    if (!Number.isFinite(dIn) || dIn <= 0) return null;

    const vFpm = velFromDia(qCfm, dIn);
    const fInwg = fricFromDia(qCfm, dIn);
    const a = num(rectSide);
    const b = a != null ? rectOtherSide(dIn, a) : null;

    return {
      dIn,
      dMm: dIn * 25.4,
      vFpm,
      vMs: vFpm / FPM_PER_MS,
      fInwg,
      fPam: fInwg * PA_PER_M_FROM_INWG100,
      rectA: a,
      rectB: b,
    };
  }, [airflow, airflowUnit, method, friction, frictionUnit, velocity, velocityUnit, rectSide]);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Airflow</Label>
            <Input className="w-32" type="number" step="any" value={airflow} placeholder="e.g. 2000"
              onChange={(e) => setAirflow(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Unit</Label>
            <Select className="w-28" value={airflowUnit} onChange={(e) => setAirflowUnit(e.target.value)}>
              <option value="cfm">CFM</option>
              <option value="m3hr">m³/hr</option>
              <option value="lps">L/s</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Size by</Label>
            <Select className="w-32" value={method} onChange={(e) => setMethod(e.target.value as never)}>
              <option value="friction">Friction rate</option>
              <option value="velocity">Velocity</option>
            </Select>
          </div>
          {method === "friction" ? (
            <>
              <div className="space-y-1">
                <Label>Friction</Label>
                <Input className="w-28" type="number" step="any" value={friction}
                  onChange={(e) => setFriction(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Unit</Label>
                <Select className="w-36" value={frictionUnit} onChange={(e) => setFrictionUnit(e.target.value)}>
                  <option value="inwg100">in.wg/100ft</option>
                  <option value="pam">Pa/m</option>
                </Select>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <Label>Velocity</Label>
                <Input className="w-28" type="number" step="any" value={velocity}
                  onChange={(e) => setVelocity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Unit</Label>
                <Select className="w-28" value={velocityUnit} onChange={(e) => setVelocityUnit(e.target.value)}>
                  <option value="fpm">fpm</option>
                  <option value="ms">m/s</option>
                </Select>
              </div>
            </>
          )}
        </div>

        {result && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Round Ø" value={`${r1(result.dIn)} in`} sub={`${Math.round(result.dMm)} mm`} />
            <Stat label="Velocity" value={`${Math.round(result.vFpm)} fpm`} sub={`${r1(result.vMs)} m/s`} />
            <Stat label="Friction" value={`${result.fInwg.toFixed(3)} in.wg/100ft`} sub={`${r1(result.fPam)} Pa/m`} />
            <Stat
              label="Air volume"
              value={`${Math.round(toCfm(num(airflow) ?? 0, airflowUnit))} cfm`}
              sub={`${Math.round((toCfm(num(airflow) ?? 0, airflowUnit)) / CFM_PER_M3HR)} m³/hr`}
            />
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <div className="space-y-1">
            <Label>Rectangular — one side (in)</Label>
            <Input className="w-40" type="number" step="any" value={rectSide} placeholder="e.g. 12"
              onChange={(e) => setRectSide(e.target.value)} />
          </div>
          {result?.rectA != null && (
            <p className="text-sm">
              {result.rectB != null ? (
                <>
                  Equivalent rectangular:{" "}
                  <b>
                    {r1(result.rectA)} × {r1(result.rectB)} in
                  </b>{" "}
                  <span className="text-muted-foreground">
                    ({Math.round(result.rectA * 25.4)} × {Math.round(result.rectB * 25.4)} mm)
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  Side too small for this duct — try a larger dimension.
                </span>
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
