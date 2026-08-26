"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { solvePulley, isPulleyError, type DimUnit } from "@/lib/hvac/pulley";
import { positive as num, r1, r2 } from "@/lib/hvac/parse";

/**
 * Belt-drive pulley (sheave) calculator. Enter any three of the four to solve
 * the fourth; also reports the drive ratio, belt speed, and (optionally) the
 * belt pitch length from a centre distance.
 *
 * The maths lives in `lib/hvac/pulley` — shared with the public HVAC Tools page
 * on the storefront, so both stay in step.
 */

export function PulleyCalculator() {
  const [motorRpm, setMotorRpm] = useState("1750");
  const [motorDia, setMotorDia] = useState("");
  const [fanDia, setFanDia] = useState("");
  const [fanRpm, setFanRpm] = useState("");
  const [dimUnit, setDimUnit] = useState<DimUnit>("in");
  const [center, setCenter] = useState("");

  const result = useMemo(
    () =>
      solvePulley({
        motorRpm: num(motorRpm),
        motorDia: num(motorDia),
        fanDia: num(fanDia),
        fanRpm: num(fanRpm),
        dimUnit,
        center: num(center),
      }),
    [motorRpm, motorDia, fanDia, fanRpm, dimUnit, center],
  );


  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-sm text-muted-foreground">
          Belt speed is shared, so <b>motor RPM × motor Ø = fan RPM × fan Ø</b>. Fill any three to
          solve the fourth.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Motor RPM" value={motorRpm} onChange={setMotorRpm} placeholder="1750" />
          <Field label={`Motor pulley Ø (${dimUnit})`} value={motorDia} onChange={setMotorDia} placeholder="Ø" />
          <Field label={`Fan pulley Ø (${dimUnit})`} value={fanDia} onChange={setFanDia} placeholder="Ø" />
          <Field label="Fan RPM" value={fanRpm} onChange={setFanRpm} placeholder="RPM" />
          <div className="space-y-1">
            <Label>Ø unit</Label>
            <Select className="w-24" value={dimUnit} onChange={(e) => setDimUnit(e.target.value as DimUnit)}>
              <option value="in">in</option>
              <option value="mm">mm</option>
            </Select>
          </div>
        </div>

        {isPulleyError(result) && <p className="text-sm text-muted-foreground">{result.error}</p>}

        {!isPulleyError(result) && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Motor RPM" value={`${Math.round(result.motorRpm)}`} />
            <Stat label={`Motor Ø`} value={`${r2(result.motorDia)} ${result.unit}`} />
            <Stat label={`Fan Ø`} value={`${r2(result.fanDia)} ${result.unit}`} />
            <Stat label="Fan RPM" value={`${Math.round(result.fanRpm)}`} />
            <Stat label="Drive ratio (fan:motor)" value={`${r2(result.ratio)} : 1`} />
            <Stat label="Belt speed" value={`${Math.round(result.beltFpm)} fpm`} sub={`${r1(result.beltMs)} m/s`} />
            {result.beltLen != null && (
              <Stat
                label="Belt pitch length"
                value={`${r1(result.beltLen)} ${result.unit}`}
                sub={result.unit === "in" ? `${r1(result.beltLen * 25.4)} mm` : `${r2(result.beltLen / 25.4)} in`}
              />
            )}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <Field label={`Centre distance (${dimUnit}) — for belt length`} value={center} onChange={setCenter} placeholder="optional" width="w-56" />
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  width = "w-32",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input className={width} type="number" step="any" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
