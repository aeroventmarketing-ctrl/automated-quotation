"use client";

import { useMemo, useState } from "react";
import {
  solveAirHeat,
  isAirHeatError,
  basisDef,
  heatConstants,
  btuToKw,
  btuToTons,
  HEAT_BASES,
  type HeatBasis,
  type HeatAirflowUnit,
  type TempUnit,
  type HumidityUnit,
  type AltitudeUnit,
  type AirHeatMode,
  type LoadUnit,
} from "@/lib/hvac/psychrometrics";
import { positive as num, signed, nonNegative, r1, r2, r3 } from "@/lib/hvac/parse";
import { NumField, PickField, Stat, Stats, ToolCard, Hint, SubGroup } from "./tool-ui";

/**
 * Public air-side heat calculator. The maths is `lib/hvac/psychrometrics`,
 * shared with the staff tool — this is the storefront's skin on it.
 */
const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 0 });

const AIRFLOW_LABEL: Record<HeatAirflowUnit, string> = { cfm: "CFM", m3hr: "m³/h", lps: "L/s" };
const fromCfm = (cfm: number, u: HeatAirflowUnit) =>
  u === "m3hr" ? cfm * 1.69901082 : u === "lps" ? cfm / 2.11888 : cfm;

export function AirHeatTool() {
  const [mode, setMode] = useState<AirHeatMode>("heat");
  const [airflow, setAirflow] = useState("2000");
  const [load, setLoad] = useState("24000");
  const [loadUnit, setLoadUnit] = useState<LoadUnit>("btuh");
  const [airflowUnit, setAirflowUnit] = useState<HeatAirflowUnit>("cfm");
  const [tempUnit, setTempUnit] = useState<TempUnit>("f");
  const [humidityUnit, setHumidityUnit] = useState<HumidityUnit>("rh");
  const [basis, setBasis] = useState<HeatBasis>("carrier");

  const [t1, setT1] = useState("80");
  const [h1, setH1] = useState("50");
  const [t2, setT2] = useState("55");
  const [h2, setH2] = useState("95");

  const [altitude, setAltitude] = useState("0");
  const [altitudeUnit, setAltitudeUnit] = useState<AltitudeUnit>("ft");
  const [flowTemp, setFlowTemp] = useState("70");

  const result = useMemo(
    () =>
      solveAirHeat({
        mode,
        airflow: num(airflow),
        load: num(load),
        loadUnit,
        airflowUnit,
        tempUnit,
        humidityUnit,
        entering: { temp: signed(t1), humidity: nonNegative(h1) },
        leaving: { temp: signed(t2), humidity: nonNegative(h2) },
        basis,
        altitude: signed(altitude),
        altitudeUnit,
        flowTemp: signed(flowTemp),
      }),
    [mode, airflow, load, loadUnit, airflowUnit, tempUnit, humidityUnit, t1, h1, t2, h2, basis, altitude, altitudeUnit, flowTemp],
  );

  const deg = tempUnit === "c" ? "°C" : "°F";
  const humidityLabel = humidityUnit === "rh" ? "RH (%)" : humidityUnit === "grains" ? "gr/lb" : "g/kg";
  const heat = (btu: number) => `${fmt(btu)} BTU/hr`;
  const sub = (btu: number) => `${r2(btuToTons(btu))} TR · ${r2(btuToKw(btu))} kW`;

  return (
    <ToolCard
      title="Air Heat — Sensible, Latent & Total"
      intro={
        <>
          How much heat an airflow carries — or how much air a load needs. Sensible from the temperature drop, latent
          from the moisture removed, total from the two together, with the sensible heat ratio and corrected for
          altitude and air temperature.
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PickField label="Solve for" value={mode} onChange={(v) => setMode(v as AirHeatMode)}
          options={[{ value: "heat", label: "Heat from an airflow" }, { value: "airflow", label: "Airflow for a load" }]} />
        {mode === "heat" ? (
          <NumField label="Airflow" value={airflow} onChange={setAirflow} placeholder="e.g. 2000" />
        ) : (
          <NumField label="Sensible load" value={load} onChange={setLoad} placeholder="e.g. 24000" />
        )}
        {mode === "airflow" && (
          <PickField label="Load unit" value={loadUnit} onChange={(v) => setLoadUnit(v as LoadUnit)}
            options={[{ value: "btuh", label: "BTU/hr" }, { value: "tons", label: "TR" }, { value: "kw", label: "kW" }]} />
        )}
        <PickField label={mode === "heat" ? "Airflow unit" : "Show airflow in"} value={airflowUnit} onChange={(v) => setAirflowUnit(v as HeatAirflowUnit)}
          options={[{ value: "cfm", label: "CFM" }, { value: "m3hr", label: "m³/h" }, { value: "lps", label: "L/s" }]} />
        <PickField label="Temperature" value={tempUnit} onChange={(v) => setTempUnit(v as TempUnit)}
          options={[{ value: "f", label: "°F" }, { value: "c", label: "°C" }]} />
        <PickField label="Humidity as" value={humidityUnit} onChange={(v) => setHumidityUnit(v as HumidityUnit)}
          options={[{ value: "rh", label: "RH %" }, { value: "grains", label: "gr/lb" }, { value: "gkg", label: "g/kg" }]} />
      </div>

      <SubGroup label="Entering air — the room, or on-coil">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label={`Dry bulb (${deg})`} value={t1} onChange={setT1} />
          <NumField label={humidityLabel} value={h1} onChange={setH1} placeholder="optional" />
        </div>
      </SubGroup>

      <SubGroup label="Leaving air — the supply, or off-coil">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label={`Dry bulb (${deg})`} value={t2} onChange={setT2} />
          <NumField label={humidityLabel} value={h2} onChange={setH2} placeholder="optional" />
        </div>
      </SubGroup>

      <SubGroup label="Air density & constant">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label="Altitude" value={altitude} onChange={setAltitude} placeholder="0" />
          <PickField label="Altitude unit" value={altitudeUnit} onChange={(v) => setAltitudeUnit(v as AltitudeUnit)}
            options={[{ value: "ft", label: "ft" }, { value: "m", label: "m" }]} />
          <NumField label={`Air temp at the meter (${deg})`} value={flowTemp} onChange={setFlowTemp} placeholder="70" />
          <PickField label="Constant" value={basis} onChange={(v) => setBasis(v as HeatBasis)}
            options={HEAT_BASES.map((b) => ({ value: b.key, label: b.label }))} />
        </div>
        <Hint>{basisDef(basis).note}</Hint>
      </SubGroup>

      {isAirHeatError(result) && <Hint>{result.error}</Hint>}
      {result === null && (
        <Hint>
          {mode === "heat"
            ? "Enter an airflow and both air temperatures to see the heat carried."
            : `Enter the sensible load and both air temperatures — CFM = Qs ÷ (${r2(heatConstants(basis).sensible)} × ΔT).`}
        </Hint>
      )}

      {result && !isAirHeatError(result) && (
        <>
          <Stats>
            {mode === "airflow" && (
              <Stat
                label="Airflow required"
                value={`${fmt(fromCfm(result.cfm, airflowUnit))} ${AIRFLOW_LABEL[airflowUnit]}`}
                sub={`${fmt(result.cfm)} CFM · ${r1(Math.abs(result.deltaTF))} °F ${result.deltaTF >= 0 ? "drop" : "rise"}`}
              />
            )}
            <Stat label="Sensible" value={heat(result.sensible)} sub={sub(result.sensible)} />
            {result.latent != null && <Stat label="Latent" value={heat(result.latent)} sub={sub(result.latent)} />}
            <Stat label="Total" value={heat(result.total)} sub={sub(result.total)} />
            {result.shr != null && <Stat label="SHR" value={`${r3(result.shr)}`} sub="sensible ÷ total" />}
          </Stats>
          <Hint>
            Using {r2(result.constants.sensible)} sensible
            {result.latent != null && ` · ${r2(result.constants.latentGrains)} latent`}
            {` · ΔT ${r1(result.deltaTF)} °F`}
            {result.enteringGrains != null && result.leavingGrains != null &&
              ` · moisture ${r1(result.enteringGrains)} → ${r1(result.leavingGrains)} gr/lb`}
            {` · density factor ${r3(result.densityFactor)}`}
          </Hint>
        </>
      )}
    </ToolCard>
  );
}
