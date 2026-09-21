"use client";

import { useMemo, useState } from "react";
import {
  solveMoisture,
  isMoistureError,
  grainsToGkg,
  fToC,
  PEOPLE_LATENT,
  BTU_PER_TON,
  type PeopleLatent,
  type WaterRateUnit,
} from "@/lib/hvac/moisture";
import type { HeatAirflowUnit, TempUnit, AltitudeUnit } from "@/lib/hvac/psychrometrics";
import { signed, nonNegative, r1, r2 } from "@/lib/hvac/parse";
import { NumField, PickField, Stat, Stats, ToolCard, Hint, SubGroup } from "./tool-ui";

/**
 * Public Moisture Removal Analysis. The maths is `lib/hvac/moisture`, shared
 * with the staff tool — this is the storefront's skin on it.
 */
const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 0 });

export function MoistureTool() {
  const [outdoorTemp, setOutdoorTemp] = useState("34");
  const [outdoorRh, setOutdoorRh] = useState("70");
  const [indoorTemp, setIndoorTemp] = useState("24");
  const [indoorRh, setIndoorRh] = useState("55");
  const [tempUnit, setTempUnit] = useState<TempUnit>("c");
  const [altitude, setAltitude] = useState("0");
  const [altUnit, setAltUnit] = useState<AltitudeUnit>("m");

  const [ventAirflow, setVentAirflow] = useState("1000");
  const [ventUnit, setVentUnit] = useState<HeatAirflowUnit>("cfm");

  const [people, setPeople] = useState("0");
  const [activity, setActivity] = useState<PeopleLatent>("seated");
  const [process, setProcess] = useState("");
  const [processUnit, setProcessUnit] = useState<WaterRateUnit>("kgh");

  const result = useMemo(
    () =>
      solveMoisture({
        outdoorTemp: signed(outdoorTemp), outdoorRh: nonNegative(outdoorRh),
        indoorTemp: signed(indoorTemp), indoorRh: nonNegative(indoorRh),
        tempUnit,
        altitude: signed(altitude), altitudeUnit: altUnit,
        ventAirflow: nonNegative(ventAirflow), ventUnit,
        people: nonNegative(people), activity,
        process: nonNegative(process), processUnit,
        other: null, otherUnit: "kgh",
        basis: "carrier",
      }),
    [outdoorTemp, outdoorRh, indoorTemp, indoorRh, tempUnit, altitude, altUnit,
     ventAirflow, ventUnit, people, activity, process, processUnit],
  );

  const deg = tempUnit === "c" ? "°C" : "°F";
  const asDeg = (f: number) => (tempUnit === "c" ? r1(fToC(f)) : r1(f));
  const ok = result && !isMoistureError(result) ? result : null;

  return (
    <ToolCard
      title="Moisture Removal Analysis"
      intro={
        <>
          How much water has to come out of the air, in litres a day. Everything here is the difference between
          two <em>humidity ratios</em> — not two relative humidities, which move when the same air is heated.
        </>
      }
    >
      <SubGroup label="The air coming in">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label={`Outdoor (${deg})`} value={outdoorTemp} onChange={setOutdoorTemp} />
          <NumField label="Outdoor RH (%)" value={outdoorRh} onChange={setOutdoorRh} />
          <PickField label="Unit" value={tempUnit} onChange={(v) => setTempUnit(v as TempUnit)}
            options={[{ value: "c", label: "°C" }, { value: "f", label: "°F" }]} />
        </div>
      </SubGroup>

      <SubGroup label="The room you are holding">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label={`Room (${deg})`} value={indoorTemp} onChange={setIndoorTemp} />
          <NumField label="Room RH (%)" value={indoorRh} onChange={setIndoorRh} />
          <NumField label="Altitude" value={altitude} onChange={setAltitude} />
          <PickField label="Altitude unit" value={altUnit} onChange={(v) => setAltUnit(v as AltitudeUnit)}
            options={[{ value: "m", label: "metres" }, { value: "ft", label: "feet" }]} />
        </div>
      </SubGroup>

      <SubGroup label="Outdoor air brought in — ventilation and infiltration together">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label="Airflow" value={ventAirflow} onChange={setVentAirflow} />
          <PickField label="Unit" value={ventUnit} onChange={(v) => setVentUnit(v as HeatAirflowUnit)}
            options={[{ value: "cfm", label: "CFM" }, { value: "m3hr", label: "m³/h" }, { value: "lps", label: "L/s" }]} />
        </div>
        <Hint>In this climate this is usually the whole load — a fan cannot dry a room with wetter air.</Hint>
      </SubGroup>

      <SubGroup label="What else wets the room">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label="People" value={people} onChange={setPeople} />
          <PickField label="Doing" value={activity} onChange={(v) => setActivity(v as PeopleLatent)}
            className="lg:col-span-2"
            options={PEOPLE_LATENT.map((a) => ({ value: a.key, label: a.label }))} />
          <NumField label="Process" value={process} onChange={setProcess} placeholder="tanks, washing" />
          <PickField label="Process unit" value={processUnit} onChange={(v) => setProcessUnit(v as WaterRateUnit)}
            options={[{ value: "kgh", label: "kg/h" }, { value: "lday", label: "L/day" }]} />
        </div>
      </SubGroup>

      {isMoistureError(result) && <Hint>{result.error}</Hint>}
      {result === null && <Hint>Give both air states a temperature and a humidity.</Hint>}

      {ok && (
        <>
          <Stats>
            <Stat label="Outdoor air" value={`${r1(ok.outdoorGrains)} gr/lb`}
              sub={`${r2(grainsToGkg(ok.outdoorGrains))} g/kg · dew point ${asDeg(ok.outdoorDewPointF)} ${deg}`} />
            <Stat label="Room air" value={`${r1(ok.indoorGrains)} gr/lb`}
              sub={`${r2(grainsToGkg(ok.indoorGrains))} g/kg · dew point ${asDeg(ok.indoorDewPointF)} ${deg}`} />
            <Stat label="Remove" value={`${fmt(ok.removalLitresDay)} L/day`} sub={`${r2(ok.removalKgHr)} kg/h`} />
            <Stat label="Latent load" value={`${fmt(ok.latentBtuh)} BTU/hr`}
              sub={`${r1(ok.latentBtuh / BTU_PER_TON)} TR · ${r1(ok.latentKw)} kW`} />
          </Stats>

          <Hint>
            {ok.surplus
              ? `Nothing has to be removed — the outdoor air is dry enough to carry off more than this room makes, so it will settle drier than the ${indoorRh}% asked for.`
              : `The coil has to reach below ${asDeg(ok.indoorDewPointF)} ${deg} — the room's dew point — or nothing condenses however long it runs. Size the condensate drain for ${fmt(ok.removalLitresDay)} litres a day.`}
          </Hint>

          {ok.dilutionRefusal ? (
            <Hint>A bigger fan will not fix this. {ok.dilutionRefusal}</Hint>
          ) : ok.dilutionCfm != null && ok.dilutionCfm > 0 ? (
            <Hint>
              A fan can do this one: the outdoor air is drier than the room, so {fmt(ok.dilutionCfm)} CFM of it
              carries the moisture away on its own — worth pricing against a dehumidifier.
            </Hint>
          ) : null}
        </>
      )}
    </ToolCard>
  );
}
