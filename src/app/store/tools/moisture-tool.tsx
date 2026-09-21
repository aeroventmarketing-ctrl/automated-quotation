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
  type CoilEntering,
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

  const [coilEntering, setCoilEntering] = useState<CoilEntering>("room");
  const [offCoilTemp, setOffCoilTemp] = useState("13");
  const [offCoilRh, setOffCoilRh] = useState("95");

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
        coilEntering, offCoilTemp: signed(offCoilTemp), offCoilRh: nonNegative(offCoilRh),
      }),
    [outdoorTemp, outdoorRh, indoorTemp, indoorRh, tempUnit, altitude, altUnit,
     ventAirflow, ventUnit, people, activity, process, processUnit,
     coilEntering, offCoilTemp, offCoilRh],
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

      <SubGroup label="The coil, if you are sizing one">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PickField label="On-coil air" value={coilEntering} onChange={(v) => setCoilEntering(v as CoilEntering)}
            className="lg:col-span-2"
            options={[{ value: "room", label: "Room air (recirculated)" }, { value: "outdoor", label: "Outdoor air (100% fresh)" }]} />
          <NumField label={`Off-coil (${deg})`} value={offCoilTemp} onChange={setOffCoilTemp} />
          <NumField label="Off-coil RH (%)" value={offCoilRh} onChange={setOffCoilRh} />
        </div>
        <Hint>Leave the off-coil temperature blank to skip this. A wet cooling coil leaves air at 90–98%.</Hint>
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

          {/* The coil's answer, in the coil's own voice whether it solves or not. */}
          {ok.coilRefusal && <Hint>The coil. {ok.coilRefusal}</Hint>}
          {ok.coil && (
            <>
              <Stats>
                <Stat label="Apparatus dew point" value={`${asDeg(ok.coil.adpF)} ${deg}`}
                  sub="the saturated surface this coil behaves as if it were" />
                <Stat label="Bypass factor" value={ok.coil.bypassFactor.toFixed(2)}
                  sub={`${Math.round(ok.coil.contactFactor * 100)}% of the air touches the fins`} />
                <Stat label="Coil sensible ratio" value={ok.coil.gshr.toFixed(2)}
                  sub={`${Math.round((1 - ok.coil.gshr) * 100)}% of its duty is drying, not cooling`} />
                <Stat label="Across the coil"
                  value={ok.coil.coilCfm != null ? `${fmt(ok.coil.coilCfm)} CFM` : "—"}
                  sub={`drops ${r1(ok.coil.enteringGrains - ok.coil.leavingGrains)} gr/lb`} />
              </Stats>
              <Hint>
                On-coil {r1(ok.coil.enteringGrains)} gr/lb → off-coil {r1(ok.coil.leavingGrains)} → apparatus dew
                point {r1(ok.coil.adpGrains)}, all on one straight line carried down to the saturation curve. No
                coil geometry needed: the bypass factor falls out of the two air states.
              </Hint>
            </>
          )}
        </>
      )}
    </ToolCard>
  );
}
