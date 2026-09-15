"use client";

import { useMemo, useState } from "react";
import {
  solveVentilation,
  isVentilationError,
  ACH_PRESETS,
  PEOPLE_ACTIVITY,
  ROOF_KINDS,
  CFM_TO_M3HR,
  BTU_PER_TON,
  DEFAULT_MOTOR_LOAD,
  DEFAULT_MOTOR_EFFICIENCY,
  type DimUnit,
  type VentTempUnit,
  type PeopleActivity,
  type RoofKind,
} from "@/lib/hvac/ventilation";
import { positive as num, signed, nonNegative, r1 } from "@/lib/hvac/parse";
import { NumField, PickField, Stat, Stats, ToolCard, Hint, SubGroup } from "./tool-ui";

/**
 * Public exhaust / ventilation fan sizing. The maths is `lib/hvac/ventilation`,
 * shared with the staff tool — this is the storefront's skin on it.
 */
const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 0 });

export function VentilationTool() {
  const [length, setLength] = useState("20");
  const [width, setWidth] = useState("30");
  const [height, setHeight] = useState("6");
  const [dimUnit, setDimUnit] = useState<DimUnit>("m");

  const [outdoorTemp, setOutdoorTemp] = useState("34");
  const [targetTemp, setTargetTemp] = useState("39");
  const [tempUnit, setTempUnit] = useState<VentTempUnit>("c");

  const [motorHp, setMotorHp] = useState("30");
  const [people, setPeople] = useState("20");
  const [activity, setActivity] = useState<PeopleActivity>("machine");
  const [lightingWatts, setLightingWatts] = useState("5000");
  const [roofArea, setRoofArea] = useState("");
  const [roofKind, setRoofKind] = useState<RoofKind>("bare-metal");
  const [otherBtuh, setOtherBtuh] = useState("");
  const [ach, setAch] = useState("8");

  const result = useMemo(
    () =>
      solveVentilation({
        length: num(length), width: num(width), height: num(height), dimUnit,
        outdoorTemp: signed(outdoorTemp), targetTemp: signed(targetTemp), tempUnit,
        motorHp: nonNegative(motorHp),
        motorLoad: DEFAULT_MOTOR_LOAD,
        motorEfficiency: DEFAULT_MOTOR_EFFICIENCY,
        people: nonNegative(people), activity,
        lightingWatts: nonNegative(lightingWatts),
        roofArea: num(roofArea), roofKind,
        otherBtuh: nonNegative(otherBtuh),
        ach: nonNegative(ach),
      }),
    [length, width, height, dimUnit, outdoorTemp, targetTemp, tempUnit, motorHp, people, activity,
     lightingWatts, roofArea, roofKind, otherBtuh, ach],
  );

  const deg = tempUnit === "c" ? "°C" : "°F";
  const area = dimUnit === "m" ? "m²" : "ft²";
  const biggestGain = result && !isVentilationError(result)
    ? [...result.gains].sort((a, b) => b.share - a.share)[0]
    : null;

  return (
    <ToolCard
      title="Exhaust &amp; Ventilation Fan Sizing"
      intro={
        <>
          How much air an exhaust or ventilation fan needs to move. Two computations — the airflow the heat gain
          needs, and the airflow the occupancy needs — and you install the larger. A ventilation fan brings outdoor
          air in, so it can hold a room a few degrees above outdoor, never below it.
        </>
      }
    >
      <SubGroup label="The room">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label="Length" value={length} onChange={setLength} />
          <NumField label="Width" value={width} onChange={setWidth} />
          <NumField label="Height" value={height} onChange={setHeight} />
          <PickField label="Unit" value={dimUnit} onChange={(v) => setDimUnit(v as DimUnit)}
            options={[{ value: "m", label: "metres" }, { value: "ft", label: "feet" }]} />
        </div>
      </SubGroup>

      <SubGroup label="Temperatures — the room target is a decision, and it sets the fan">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label={`Outdoor (${deg})`} value={outdoorTemp} onChange={setOutdoorTemp} />
          <NumField label={`Room target (${deg})`} value={targetTemp} onChange={setTargetTemp} />
          <PickField label="Unit" value={tempUnit} onChange={(v) => setTempUnit(v as VentTempUnit)}
            options={[{ value: "c", label: "°C" }, { value: "f", label: "°F" }]} />
        </div>
      </SubGroup>

      <SubGroup label="What is heating the room">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label="Motors (total HP)" value={motorHp} onChange={setMotorHp} />
          <NumField label="People" value={people} onChange={setPeople} />
          <PickField label="Doing" value={activity} onChange={(v) => setActivity(v as PeopleActivity)}
            options={PEOPLE_ACTIVITY.map((a) => ({ value: a.key, label: a.label }))} />
          <NumField label="Lighting (watts)" value={lightingWatts} onChange={setLightingWatts} />
          <PickField label="Roof" value={roofKind} onChange={(v) => setRoofKind(v as RoofKind)}
            className="lg:col-span-2"
            options={ROOF_KINDS.map((r) => ({ value: r.key, label: r.label }))} />
          <NumField label={`Roof area (${area})`} value={roofArea} onChange={setRoofArea} placeholder="footprint" />
          <NumField label="Process / other (BTU/hr)" value={otherBtuh} onChange={setOtherBtuh} placeholder="ovens, welding" />
        </div>
      </SubGroup>

      <SubGroup label="Air changes — the minimum for the occupancy, whatever the heat says">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PickField
            label="Occupancy"
            value=""
            onChange={(v) => { const preset = ACH_PRESETS.find((a) => a.key === v); if (preset) setAch(String(preset.ach)); }}
            className="lg:col-span-2"
            options={[{ value: "", label: "— pick to fill the ACH —" },
              ...ACH_PRESETS.map((a) => ({ value: a.key, label: `${a.label} · ${a.ach} ACH` }))]}
          />
          <NumField label="ACH" value={ach} onChange={setAch} />
        </div>
        <Hint>Starting figures, not code compliance — a paint booth or a kitchen hood has a number of its own.</Hint>
      </SubGroup>

      {isVentilationError(result) && <Hint>{result.error}</Hint>}
      {result === null && <Hint>Enter the room size and both temperatures to size the fan.</Hint>}

      {result && !isVentilationError(result) && (
        <>
          <Stats>
            <Stat label="Total heat gain" value={`${fmt(result.totalBtuh)} BTU/hr`} sub={`${r1(result.totalBtuh / BTU_PER_TON)} TR`} />
            <Stat label={`Heat balance${result.governedBy === "heat" ? " · governs" : ""}`}
              value={`${fmt(result.heatCfm)} CFM`} sub={`Q ÷ (1.08 × ${r1(result.deltaTF)} °F)`} />
            <Stat label={`Air changes${result.governedBy === "air-changes" ? " · governs" : ""}`}
              value={`${fmt(result.achCfm)} CFM`} sub={`${fmt(result.volumeFt3)} ft³ × ${ach} ÷ 60`} />
            <Stat label="Install" value={`${fmt(result.requiredCfm)} CFM`}
              sub={`${fmt(result.requiredCfm * CFM_TO_M3HR)} m³/h · ${r1(result.resultingAch)} ACH`} />
          </Stats>
          <Hint>
            {result.gains.map((g) => `${g.label} ${Math.round(g.share * 100)}%`).join(" · ")}
            {biggestGain && biggestGain.share > 0.5
              ? ` — ${biggestGain.label.toLowerCase()} alone is ${Math.round(biggestGain.share * 100)}% of the load, and is worth attacking directly before buying the fan for it.`
              : ""}
          </Hint>
        </>
      )}
    </ToolCard>
  );
}
