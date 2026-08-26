"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  solveDuct,
  CFM_PER_M3HR,
  type AirflowUnit,
  type DuctDimUnit,
  type DuctMethod,
  type DuctShape,
  type FrictionUnit,
  type VelocityUnit,
} from "@/lib/hvac/ductulator";
import { positive as num, r1 } from "@/lib/hvac/parse";

/**
 * Duct sizing calculator ("ductulator") for round and rectangular galvanized
 * duct at standard air — size from friction rate, size from velocity, or
 * pressure drop from a given size.
 *
 * The maths lives in `lib/hvac/ductulator` — shared with the public HVAC Tools
 * page on the storefront, so both stay in step.
 */

export function Ductulator() {
  const [airflow, setAirflow] = useState("");
  const [airflowUnit, setAirflowUnit] = useState<AirflowUnit>("cfm");
  const [method, setMethod] = useState<DuctMethod>("friction");
  const [friction, setFriction] = useState("0.1");
  const [frictionUnit, setFrictionUnit] = useState<FrictionUnit>("inwg100");
  const [velocity, setVelocity] = useState("1500");
  const [velocityUnit, setVelocityUnit] = useState<VelocityUnit>("fpm");
  // Pressure-drop-from-size mode.
  const [shape, setShape] = useState<DuctShape>("round");
  const [dimUnit, setDimUnit] = useState<DuctDimUnit>("in");
  const [dia, setDia] = useState("");
  const [sideA, setSideA] = useState("");
  const [sideB, setSideB] = useState("");
  // Rectangular-equivalent helper (size modes).
  const [rectSide, setRectSide] = useState("");

  const result = useMemo(
    () =>
      solveDuct({
        airflow: num(airflow),
        airflowUnit,
        method,
        friction: num(friction),
        frictionUnit,
        velocity: num(velocity),
        velocityUnit,
        shape,
        dimUnit,
        dia: num(dia),
        sideA: num(sideA),
        sideB: num(sideB),
        rectSide: num(rectSide),
      }),
    [airflow, airflowUnit, method, friction, frictionUnit, velocity, velocityUnit, shape, dimUnit, dia, sideA, sideB, rectSide],
  );

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
            <Select className="w-28" value={airflowUnit} onChange={(e) => setAirflowUnit(e.target.value as AirflowUnit)}>
              <option value="cfm">CFM</option>
              <option value="m3hr">m³/hr</option>
              <option value="lps">L/s</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Calculate</Label>
            <Select className="w-52" value={method} onChange={(e) => setMethod(e.target.value as DuctMethod)}>
              <option value="friction">Size from friction rate</option>
              <option value="velocity">Size from velocity</option>
              <option value="dimensions">Pressure drop from size</option>
            </Select>
          </div>
          {method === "friction" && (
            <>
              <div className="space-y-1">
                <Label>Friction</Label>
                <Input className="w-28" type="number" step="any" value={friction}
                  onChange={(e) => setFriction(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Unit</Label>
                <Select className="w-36" value={frictionUnit} onChange={(e) => setFrictionUnit(e.target.value as FrictionUnit)}>
                  <option value="inwg100">in.wg/100ft</option>
                  <option value="pam">Pa/m</option>
                </Select>
              </div>
            </>
          )}
          {method === "velocity" && (
            <>
              <div className="space-y-1">
                <Label>Velocity</Label>
                <Input className="w-28" type="number" step="any" value={velocity}
                  onChange={(e) => setVelocity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Unit</Label>
                <Select className="w-28" value={velocityUnit} onChange={(e) => setVelocityUnit(e.target.value as VelocityUnit)}>
                  <option value="fpm">fpm</option>
                  <option value="ms">m/s</option>
                </Select>
              </div>
            </>
          )}
          {method === "dimensions" && (
            <>
              <div className="space-y-1">
                <Label>Shape</Label>
                <Select className="w-36" value={shape} onChange={(e) => setShape(e.target.value as DuctShape)}>
                  <option value="round">Round</option>
                  <option value="rect">Rectangular / Square</option>
                </Select>
              </div>
              {shape === "round" ? (
                <div className="space-y-1">
                  <Label>Diameter</Label>
                  <Input className="w-28" type="number" step="any" value={dia} placeholder="Ø"
                    onChange={(e) => setDia(e.target.value)} />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label>Width</Label>
                    <Input className="w-24" type="number" step="any" value={sideA} placeholder="W"
                      onChange={(e) => setSideA(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Height</Label>
                    <Input className="w-24" type="number" step="any" value={sideB} placeholder="H"
                      onChange={(e) => setSideB(e.target.value)} />
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label>Unit</Label>
                <Select className="w-24" value={dimUnit} onChange={(e) => setDimUnit(e.target.value as DuctDimUnit)}>
                  <option value="in">in</option>
                  <option value="mm">mm</option>
                </Select>
              </div>
            </>
          )}
        </div>

        {result && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label={result.isEquiv ? "Equiv. round Ø" : "Round Ø"}
              value={`${r1(result.dIn)} in`}
              sub={`${Math.round(result.dMm)} mm`}
            />
            <Stat label="Velocity" value={`${Math.round(result.vFpm)} fpm`} sub={`${r1(result.vMs)} m/s`} />
            <Stat
              label="Pressure drop"
              value={`${result.fInwg.toFixed(3)} in.wg/100ft`}
              sub={`${r1(result.fPam)} Pa/m`}
            />
            <Stat
              label="Air volume"
              value={`${Math.round(result.qCfm)} cfm`}
              sub={`${Math.round(result.qCfm / CFM_PER_M3HR)} m³/hr`}
            />
          </div>
        )}

        {method !== "dimensions" && (
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
        )}
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
