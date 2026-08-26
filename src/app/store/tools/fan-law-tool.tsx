"use client";

import { useMemo, useState } from "react";
import { solveFanLaw, isFanLawError, type FanLawMode } from "@/lib/hvac/fan-law";
import { positive as num, r1, r3 } from "@/lib/hvac/parse";
import { NumField, PickField, Stat, Stats, ToolCard, Hint, SubGroup } from "./tool-ui";

/**
 * Public fan affinity-law calculator. The maths is `lib/hvac/fan-law`, shared
 * with the staff tool — this is the storefront's skin on it.
 */
export function FanLawTool() {
  const [n1, setN1] = useState("");
  const [q1, setQ1] = useState("");
  const [p1, setP1] = useState("");
  const [w1, setW1] = useState("");
  const [mode, setMode] = useState<FanLawMode>("rpm");
  const [target, setTarget] = useState("");

  const result = useMemo(
    () => solveFanLaw({ n1: num(n1), q1: num(q1), p1: num(p1), w1: num(w1), mode, target: num(target) }),
    [n1, q1, p1, w1, mode, target],
  );

  return (
    <ToolCard
      title="Fan Law Calculator"
      intro={
        <>
          Same fan, new speed: airflow ∝ speed, pressure ∝ speed², power ∝ speed³. Enter what the fan does today, then
          say what you want to change — the rest scale by the resulting speed ratio. Units pass through unchanged.
        </>
      }
    >
      <div>
        <div className="mb-3 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--store-steel)]">
          Known operating point
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label="Speed (RPM 1)" value={n1} onChange={setN1} placeholder="e.g. 1000" />
          <NumField label="Airflow (CFM 1)" value={q1} onChange={setQ1} placeholder="optional" />
          <NumField label="Pressure (SP 1)" value={p1} onChange={setP1} placeholder="optional" />
          <NumField label="Power (BHP 1)" value={w1} onChange={setW1} placeholder="optional" />
        </div>
      </div>

      <SubGroup label="Change by">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PickField
            label="Target"
            value={mode}
            onChange={(v) => setMode(v as FanLawMode)}
            className="lg:col-span-2"
            options={[
              { value: "rpm", label: "New speed (RPM)" },
              { value: "cfm", label: "Target airflow (CFM)" },
              { value: "sp", label: "Target pressure (SP)" },
              { value: "bhp", label: "Target power (BHP)" },
            ]}
          />
          <NumField label="Value" value={target} onChange={setTarget} placeholder="new value" />
        </div>
      </SubGroup>

      {isFanLawError(result) && <Hint>{result.error}</Hint>}
      {result === null && <Hint>Enter the known speed and a target value to see the new operating point.</Hint>}

      {result && !isFanLawError(result) && (
        <Stats>
          <Stat label="Speed ratio" value={`${r3(result.ratio)}×`} />
          <Stat label="New speed (RPM 2)" value={`${Math.round(result.n2)}`} />
          {result.q2 != null && <Stat label="Airflow (CFM 2)" value={`${Math.round(result.q2).toLocaleString()}`} />}
          {result.p2 != null && <Stat label="Pressure (SP 2)" value={`${r1(result.p2)}`} />}
          {result.w2 != null && <Stat label="Power (BHP 2)" value={`${r1(result.w2)}`} />}
        </Stats>
      )}
    </ToolCard>
  );
}
