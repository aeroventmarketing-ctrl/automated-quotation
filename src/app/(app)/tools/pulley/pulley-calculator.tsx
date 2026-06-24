"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Belt-drive pulley (sheave) calculator. The driver and driven sheaves share the
 * same belt speed, so:  motorRPM · motorØ = fanRPM · fanØ.
 * Enter any three of the four to solve the fourth; also reports the drive ratio,
 * belt speed, and (optionally) the belt pitch length from a centre distance.
 */

const num = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function PulleyCalculator() {
  const [motorRpm, setMotorRpm] = useState("1750");
  const [motorDia, setMotorDia] = useState("");
  const [fanDia, setFanDia] = useState("");
  const [fanRpm, setFanRpm] = useState("");
  const [dimUnit, setDimUnit] = useState("in");
  const [center, setCenter] = useState("");

  const result = useMemo(() => {
    const vals = {
      motorRpm: num(motorRpm),
      motorDia: num(motorDia),
      fanDia: num(fanDia),
      fanRpm: num(fanRpm),
    };
    const provided = Object.values(vals).filter((v) => v != null).length;
    if (provided < 3) return { error: "Enter any three of motor RPM, motor Ø, fan Ø, fan RPM." };
    if (provided > 3) return { error: "Leave one field blank to solve for it." };

    let { motorRpm: mr, motorDia: md, fanDia: fd, fanRpm: fr } = vals;
    if (mr == null) mr = (fr! * fd!) / md!;
    else if (md == null) md = (fr! * fd!) / mr;
    else if (fd == null) fd = (mr * md) / fr!;
    else if (fr == null) fr = (mr * md) / fd;
    if (![mr, md, fd, fr].every((x) => x != null && Number.isFinite(x) && x > 0))
      return { error: "Check the values." };

    const ratio = fr! / mr!; // driven / driver speed ratio
    const toIn = (d: number) => (dimUnit === "mm" ? d / 25.4 : d);
    const beltFpm = (Math.PI * toIn(md!) * mr!) / 12;

    const c = num(center);
    let beltLen: number | null = null;
    if (c != null) {
      const D = Math.max(md!, fd!);
      const d = Math.min(md!, fd!);
      beltLen = 2 * c + (Math.PI * (D + d)) / 2 + (D - d) ** 2 / (4 * c);
    }

    return {
      mr: mr!,
      md: md!,
      fd: fd!,
      fr: fr!,
      ratio,
      beltFpm,
      beltMs: beltFpm * 0.00508,
      beltLen,
      unit: dimUnit,
    };
  }, [motorRpm, motorDia, fanDia, fanRpm, dimUnit, center]);

  const ok = !("error" in result);

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
            <Select className="w-24" value={dimUnit} onChange={(e) => setDimUnit(e.target.value)}>
              <option value="in">in</option>
              <option value="mm">mm</option>
            </Select>
          </div>
        </div>

        {!ok && <p className="text-sm text-muted-foreground">{result.error}</p>}

        {ok && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Motor RPM" value={`${Math.round(result.mr)}`} />
            <Stat label={`Motor Ø`} value={`${r2(result.md)} ${result.unit}`} />
            <Stat label={`Fan Ø`} value={`${r2(result.fd)} ${result.unit}`} />
            <Stat label="Fan RPM" value={`${Math.round(result.fr)}`} />
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
