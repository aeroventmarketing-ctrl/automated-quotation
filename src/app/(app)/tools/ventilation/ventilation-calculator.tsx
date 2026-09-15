"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
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

/**
 * Sizing an exhaust or ventilation fan.
 *
 * The owner asked what the proper computation is, then chose this over patching
 * the sign on the Air Heat tool: *"Pick 3"* — a calculation of its own that says
 * "room" and "outdoor" in those words, reports heat removed as a positive
 * number, and carries the heat-gain build-up and the air-change cross-check that
 * the heat balance is useless without.
 *
 * The screen is arranged in the order the question is actually answered: the
 * room, then what you will accept, then what is heating it, then the two
 * airflows and which one wins.
 */

const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 0 });

export function VentilationCalculator() {
  const [length, setLength] = useState("20");
  const [width, setWidth] = useState("30");
  const [height, setHeight] = useState("6");
  const [dimUnit, setDimUnit] = useState<DimUnit>("m");

  const [outdoorTemp, setOutdoorTemp] = useState("34");
  const [targetTemp, setTargetTemp] = useState("39");
  const [tempUnit, setTempUnit] = useState<VentTempUnit>("c");

  const [motorHp, setMotorHp] = useState("30");
  const [motorLoad, setMotorLoad] = useState(String(DEFAULT_MOTOR_LOAD));
  const [motorEff, setMotorEff] = useState(String(DEFAULT_MOTOR_EFFICIENCY));
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
        motorLoad: num(motorLoad) ?? DEFAULT_MOTOR_LOAD,
        motorEfficiency: num(motorEff) ?? DEFAULT_MOTOR_EFFICIENCY,
        people: nonNegative(people), activity,
        lightingWatts: nonNegative(lightingWatts),
        roofArea: num(roofArea), roofKind,
        otherBtuh: nonNegative(otherBtuh),
        ach: nonNegative(ach),
      }),
    [length, width, height, dimUnit, outdoorTemp, targetTemp, tempUnit, motorHp, motorLoad, motorEff,
     people, activity, lightingWatts, roofArea, roofKind, otherBtuh, ach],
  );

  const deg = tempUnit === "c" ? "°C" : "°F";
  const area = dimUnit === "m" ? "m²" : "ft²";
  // The gains come back in definition order, not by size — so the "attack this
  // first" advice has to look for the largest rather than take the first.
  const biggestGain = result && !isVentilationError(result)
    ? [...result.gains].sort((a, b) => b.share - a.share)[0]
    : null;

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <p className="text-sm text-muted-foreground">
          Two computations, and you install the larger: the air the heat needs, and the air the room needs.
        </p>

        {/* ---- the room ---- */}
        <Group label="The room">
          <Field label="Length" value={length} onChange={setLength} width="w-24" />
          <Field label="Width" value={width} onChange={setWidth} width="w-24" />
          <Field label="Height" value={height} onChange={setHeight} width="w-24" />
          <Picker label="Unit" value={dimUnit} onChange={(v) => setDimUnit(v as DimUnit)} className="w-24"
            options={[["m", "metres"], ["ft", "feet"]]} />
        </Group>

        {/* ---- what you will accept ---- */}
        <Group label="Temperatures — the room target is a DECISION, and it sets the fan">
          <Field label={`Outdoor (${deg})`} value={outdoorTemp} onChange={setOutdoorTemp} width="w-28" />
          <Field label={`Room target (${deg})`} value={targetTemp} onChange={setTargetTemp} width="w-32" />
          <Picker label="Unit" value={tempUnit} onChange={(v) => setTempUnit(v as VentTempUnit)} className="w-24"
            options={[["c", "°C"], ["f", "°F"]]} />
          <p className="pb-1.5 text-[11px] text-muted-foreground">
            A fan brings outdoor air in — the room can never go <em>below</em> outdoor.
          </p>
        </Group>

        {/* ---- what is heating it ---- */}
        <Group label="What is heating the room">
          <Field label="Motors (total HP)" value={motorHp} onChange={setMotorHp} width="w-32" />
          <Field label="Running factor" value={motorLoad} onChange={setMotorLoad} width="w-28" />
          <Field label="Motor efficiency" value={motorEff} onChange={setMotorEff} width="w-28" />
        </Group>
        <Group>
          <Field label="People" value={people} onChange={setPeople} width="w-24" />
          <Picker label="Doing" value={activity} onChange={(v) => setActivity(v as PeopleActivity)} className="w-52"
            options={PEOPLE_ACTIVITY.map((a) => [a.key, a.label] as [string, string])} />
          <Field label="Lighting (watts)" value={lightingWatts} onChange={setLightingWatts} width="w-32" />
        </Group>
        <Group>
          <Picker label="Roof" value={roofKind} onChange={(v) => setRoofKind(v as RoofKind)} className="w-56"
            options={ROOF_KINDS.map((r) => [r.key, r.label] as [string, string])} />
          <Field label={`Roof area (${area})`} value={roofArea} onChange={setRoofArea} width="w-32" placeholder="footprint" />
          <Field label="Process / other (BTU/hr)" value={otherBtuh} onChange={setOtherBtuh} width="w-40" placeholder="ovens, welding" />
        </Group>

        {/* ---- the air-change cross-check ---- */}
        <Group label="Air changes — the minimum for the occupancy, whatever the heat says">
          <Picker
            label="Occupancy"
            value=""
            onChange={(v) => { const preset = ACH_PRESETS.find((a) => a.key === v); if (preset) setAch(String(preset.ach)); }}
            className="w-56"
            options={[["", "— pick to fill the ACH —"], ...ACH_PRESETS.map((a) => [a.key, `${a.label} · ${a.ach} ACH`] as [string, string])]}
          />
          <Field label="ACH" value={ach} onChange={setAch} width="w-24" />
          <p className="pb-1.5 text-[11px] text-muted-foreground">
            Starting figures, not code compliance — a paint booth or a kitchen hood has a number of its own.
          </p>
        </Group>

        {isVentilationError(result) && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{result.error}</p>
        )}

        {result && !isVentilationError(result) && (
          <div className="space-y-4 border-t pt-4">
            {/* heat gain build-up */}
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Heat gain</div>
              <div className="space-y-1">
                {result.gains.map((g) => (
                  <div key={g.key} className="flex items-center gap-3 text-xs">
                    <span className="w-44 shrink-0 text-muted-foreground">{g.label}</span>
                    <span className="w-28 shrink-0 text-right tabular-nums">{fmt(g.btuh)}</span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{Math.round(g.share * 100)}%</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                      <span className="block h-full rounded bg-primary/60" style={{ width: `${Math.max(1, g.share * 100)}%` }} />
                    </span>
                  </div>
                ))}
                <div className="flex items-center gap-3 border-t pt-1 text-xs font-semibold">
                  <span className="w-44 shrink-0">Total sensible gain</span>
                  <span className="w-28 shrink-0 text-right tabular-nums">{fmt(result.totalBtuh)}</span>
                  <span className="text-muted-foreground">BTU/hr · {r1(result.totalBtuh / BTU_PER_TON)} TR</span>
                </div>
              </div>
            </div>

            {/* the two airflows */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label="Heat balance"
                value={`${fmt(result.heatCfm)} CFM`}
                sub={`Q ÷ (1.08 × ${r1(result.deltaTF)} °F)`}
                on={result.governedBy === "heat"}
              />
              <Stat
                label="Air changes"
                value={`${fmt(result.achCfm)} CFM`}
                sub={`${fmt(result.volumeFt3)} ft³ × ${ach} ÷ 60`}
                on={result.governedBy === "air-changes"}
              />
              <div className="rounded-md border border-primary/50 bg-primary/5 p-3">
                <div className="text-xs text-muted-foreground">Install</div>
                <div className="text-2xl font-bold tabular-nums">{fmt(result.requiredCfm)} <span className="text-sm font-normal">CFM</span></div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {fmt(result.requiredCfm * CFM_TO_M3HR)} m³/h · {r1(result.resultingAch)} ACH
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {result.governedBy === "heat"
                ? "The heat governs — the air-change minimum is already covered."
                : "The air-change minimum governs — there is not enough heat in the room to need more."}
              {" "}The room lands near <strong>{r1(Number(targetTemp))} {deg}</strong> on a{" "}
              <strong>{r1(Number(outdoorTemp))} {deg}</strong> day, and never below outdoor.
              {biggestGain && biggestGain.share > 0.5 && (
                <> <strong>{biggestGain.label}</strong> alone is {Math.round(biggestGain.share * 100)}% of the load —
                worth attacking directly before buying the fan for it.</>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div>
      {label && <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>}
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, width = "w-32",
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; width?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">{label}</Label>
      <Input id={id} className={width} type="number" step="any" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Picker({
  label, value, onChange, options, className = "w-32",
}: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][]; className?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">{label}</Label>
      <Select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </div>
  );
}

/** One of the two candidate airflows. The governing one is marked. */
function Stat({ label, value, sub, on }: { label: string; value: string; sub: string; on: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${on ? "border-primary/40" : "opacity-70"}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {on && <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] font-bold uppercase text-primary">governs</span>}
      </div>
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

