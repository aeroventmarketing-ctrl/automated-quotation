"use client";

import { useMemo, useState } from "react";
import { solvePulley, isPulleyError, type DimUnit } from "@/lib/hvac/pulley";
import { positive as num, r1, r2 } from "@/lib/hvac/parse";
import { NumField, PickField, Stat, Stats, ToolCard, Hint, SubGroup } from "./tool-ui";

/**
 * Public belt-drive pulley calculator. The maths is `lib/hvac/pulley`, shared
 * with the staff tool — this is the storefront's skin on it.
 */
export function PulleyTool() {
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
    <ToolCard
      title="Pulley Calculator"
      intro={
        <>
          The driver and driven sheaves share a belt, so <b>motor RPM × motor Ø = fan RPM × fan Ø</b>. Fill any three
          and the fourth follows, along with the drive ratio and belt speed.
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <NumField label="Motor RPM" value={motorRpm} onChange={setMotorRpm} placeholder="1750" />
        <NumField label={`Motor pulley Ø (${dimUnit})`} value={motorDia} onChange={setMotorDia} placeholder="Ø" />
        <NumField label={`Fan pulley Ø (${dimUnit})`} value={fanDia} onChange={setFanDia} placeholder="Ø" />
        <NumField label="Fan RPM" value={fanRpm} onChange={setFanRpm} placeholder="RPM" />
        <PickField
          label="Ø unit"
          value={dimUnit}
          onChange={(v) => setDimUnit(v as DimUnit)}
          options={[{ value: "in", label: "in" }, { value: "mm", label: "mm" }]}
        />
      </div>

      {isPulleyError(result) ? (
        <Hint>{result.error}</Hint>
      ) : (
        <Stats>
          <Stat label="Motor RPM" value={`${Math.round(result.motorRpm)}`} />
          <Stat label="Motor Ø" value={`${r2(result.motorDia)} ${result.unit}`} />
          <Stat label="Fan Ø" value={`${r2(result.fanDia)} ${result.unit}`} />
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
        </Stats>
      )}

      <SubGroup label="Belt length">
        <NumField
          label={`Centre distance (${dimUnit})`}
          value={center}
          onChange={setCenter}
          placeholder="optional"
          className="w-56"
        />
      </SubGroup>
    </ToolCard>
  );
}
