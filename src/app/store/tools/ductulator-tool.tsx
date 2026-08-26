"use client";

import { useMemo, useState } from "react";
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
import { NumField, PickField, Stat, Stats, ToolCard, Hint, SubGroup } from "./tool-ui";

/**
 * Public duct-sizing calculator. The maths is `lib/hvac/ductulator`, shared with
 * the staff tool — this is the storefront's skin on it.
 */
export function DuctulatorTool() {
  const [airflow, setAirflow] = useState("2000");
  const [airflowUnit, setAirflowUnit] = useState<AirflowUnit>("cfm");
  const [method, setMethod] = useState<DuctMethod>("friction");
  const [friction, setFriction] = useState("0.1");
  const [frictionUnit, setFrictionUnit] = useState<FrictionUnit>("inwg100");
  const [velocity, setVelocity] = useState("1500");
  const [velocityUnit, setVelocityUnit] = useState<VelocityUnit>("fpm");
  const [shape, setShape] = useState<DuctShape>("round");
  const [dimUnit, setDimUnit] = useState<DuctDimUnit>("in");
  const [dia, setDia] = useState("");
  const [sideA, setSideA] = useState("");
  const [sideB, setSideB] = useState("");
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
    <ToolCard
      title="Ductulator"
      intro="Size round or rectangular galvanized duct at standard air — from a friction rate, from a target velocity, or work the pressure drop back from a duct you already have."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumField label="Airflow" value={airflow} onChange={setAirflow} placeholder="2000" />
        <PickField
          label="Unit"
          value={airflowUnit}
          onChange={(v) => setAirflowUnit(v as AirflowUnit)}
          options={[
            { value: "cfm", label: "CFM" },
            { value: "m3hr", label: "m³/hr" },
            { value: "lps", label: "L/s" },
          ]}
        />
        <PickField
          label="Calculate"
          value={method}
          onChange={(v) => setMethod(v as DuctMethod)}
          className="lg:col-span-2"
          options={[
            { value: "friction", label: "Size from friction rate" },
            { value: "velocity", label: "Size from velocity" },
            { value: "dimensions", label: "Pressure drop from size" },
          ]}
        />

        {method === "friction" && (
          <>
            <NumField label="Friction" value={friction} onChange={setFriction} />
            <PickField
              label="Unit"
              value={frictionUnit}
              onChange={(v) => setFrictionUnit(v as FrictionUnit)}
              options={[{ value: "inwg100", label: "in.wg / 100ft" }, { value: "pam", label: "Pa / m" }]}
            />
          </>
        )}

        {method === "velocity" && (
          <>
            <NumField label="Velocity" value={velocity} onChange={setVelocity} />
            <PickField
              label="Unit"
              value={velocityUnit}
              onChange={(v) => setVelocityUnit(v as VelocityUnit)}
              options={[{ value: "fpm", label: "fpm" }, { value: "ms", label: "m/s" }]}
            />
          </>
        )}

        {method === "dimensions" && (
          <>
            <PickField
              label="Shape"
              value={shape}
              onChange={(v) => setShape(v as DuctShape)}
              options={[{ value: "round", label: "Round" }, { value: "rect", label: "Rectangular / Square" }]}
            />
            {shape === "round" ? (
              <NumField label="Diameter" value={dia} onChange={setDia} placeholder="Ø" />
            ) : (
              <>
                <NumField label="Width" value={sideA} onChange={setSideA} placeholder="W" />
                <NumField label="Height" value={sideB} onChange={setSideB} placeholder="H" />
              </>
            )}
            <PickField
              label="Unit"
              value={dimUnit}
              onChange={(v) => setDimUnit(v as DuctDimUnit)}
              options={[{ value: "in", label: "in" }, { value: "mm", label: "mm" }]}
            />
          </>
        )}
      </div>

      {result ? (
        <Stats>
          <Stat
            label={result.isEquiv ? "Equiv. round Ø" : "Round Ø"}
            value={`${r1(result.dIn)} in`}
            sub={`${Math.round(result.dMm)} mm`}
          />
          <Stat label="Velocity" value={`${Math.round(result.vFpm)} fpm`} sub={`${r1(result.vMs)} m/s`} />
          <Stat
            label="Pressure drop"
            value={result.fInwg.toFixed(3)}
            sub={`in.wg/100ft · ${r1(result.fPam)} Pa/m`}
          />
          <Stat
            label="Air volume"
            value={`${Math.round(result.qCfm).toLocaleString()} cfm`}
            sub={`${Math.round(result.qCfm / CFM_PER_M3HR).toLocaleString()} m³/hr`}
          />
        </Stats>
      ) : (
        <Hint>Enter an airflow and the value for the method you picked to see the result.</Hint>
      )}

      {method !== "dimensions" && (
        <SubGroup label="Rectangular equivalent">
          <div className="flex flex-wrap items-end gap-4">
            <NumField
              label="One side (in)"
              value={rectSide}
              onChange={setRectSide}
              placeholder="e.g. 12"
              className="w-40"
            />
            {result?.rectA != null && (
              <p className="pb-3 text-[13.5px]">
                {result.rectB != null ? (
                  <>
                    Equivalent rectangular:{" "}
                    <b>{r1(result.rectA)} × {r1(result.rectB)} in</b>{" "}
                    <span className="text-[var(--store-steel)]">
                      ({Math.round(result.rectA * 25.4)} × {Math.round(result.rectB * 25.4)} mm)
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--store-steel)]">
                    Side too small for this duct — try a larger dimension.
                  </span>
                )}
              </p>
            )}
          </div>
        </SubGroup>
      )}
    </ToolCard>
  );
}
