"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
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
import type { HeatAirflowUnit, TempUnit, AltitudeUnit, HeatBasis } from "@/lib/hvac/psychrometrics";
import { signed, nonNegative, r1, r2 } from "@/lib/hvac/parse";

/**
 * Moisture Removal Analysis.
 *
 * Laid out in the order the question is actually answered: the two air states
 * (because every figure below is the difference between them), then the outdoor
 * air, then what wets the room, then what has to come out and whether a fan
 * could do it instead.
 *
 * The headline is deliberately **litres a day**, not BTU/hr. The latent load is
 * there too, for sizing a coil, but a dehumidifier is sold in litres and a drain
 * is sized in litres, and those are the two decisions this screen exists for.
 */

const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 0 });

export function MoistureCalculator() {
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
  const [other, setOther] = useState("");
  const [otherUnit, setOtherUnit] = useState<WaterRateUnit>("kgh");

  const [coilEntering, setCoilEntering] = useState<CoilEntering>("room");
  const [offCoilTemp, setOffCoilTemp] = useState("13");
  const [offCoilRh, setOffCoilRh] = useState("95");

  const [basis] = useState<HeatBasis>("carrier");

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
        other: nonNegative(other), otherUnit,
        basis,
        coilEntering, offCoilTemp: signed(offCoilTemp), offCoilRh: nonNegative(offCoilRh),
      }),
    [outdoorTemp, outdoorRh, indoorTemp, indoorRh, tempUnit, altitude, altUnit,
     ventAirflow, ventUnit, people, activity, process, processUnit, other, otherUnit, basis,
     coilEntering, offCoilTemp, offCoilRh],
  );

  const deg = tempUnit === "c" ? "°C" : "°F";
  const asDeg = (f: number) => (tempUnit === "c" ? r1(fToC(f)) : r1(f));
  // The same default the solver uses, so the heading reads what was solved.
  const offRh = nonNegative(offCoilRh) ?? 95;
  const ok = result && !isMoistureError(result) ? result : null;
  // Definition order is not size order, so the "attack this first" line has to
  // look for the largest rather than take the first — the same trap the
  // ventilation tool fell into.
  const biggest = ok ? [...ok.gains].filter((g) => g.lbPerHr > 0).sort((a, b) => b.share - a.share)[0] : null;

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <p className="text-sm text-muted-foreground">
          What has to come <em>out</em> of the air, in litres a day. Everything below is the difference
          between two humidity ratios — not two relative humidities.
        </p>

        {/* ---- the two air states ---- */}
        <Group label="The air coming in">
          <Field label={`Outdoor (${deg})`} value={outdoorTemp} onChange={setOutdoorTemp} width="w-28" />
          <Field label="Outdoor RH (%)" value={outdoorRh} onChange={setOutdoorRh} width="w-28" />
          <Picker label="Unit" value={tempUnit} onChange={(v) => setTempUnit(v as TempUnit)} className="w-24"
            options={[["c", "°C"], ["f", "°F"]]} />
        </Group>
        <Group label="The room you are holding">
          <Field label={`Room (${deg})`} value={indoorTemp} onChange={setIndoorTemp} width="w-28" />
          <Field label="Room RH (%)" value={indoorRh} onChange={setIndoorRh} width="w-28" />
          <Field label="Altitude" value={altitude} onChange={setAltitude} width="w-24" />
          <Picker label="" value={altUnit} onChange={(v) => setAltUnit(v as AltitudeUnit)} className="w-20"
            options={[["m", "m"], ["ft", "ft"]]} />
        </Group>

        {/* ---- outdoor air ---- */}
        <Group label="Outdoor air brought in — ventilation and infiltration together">
          <Field label="Airflow" value={ventAirflow} onChange={setVentAirflow} width="w-32" />
          <Picker label="Unit" value={ventUnit} onChange={(v) => setVentUnit(v as HeatAirflowUnit)} className="w-28"
            options={[["cfm", "CFM"], ["m3hr", "m³/h"], ["lps", "L/s"]]} />
          <p className="pb-1.5 text-[11px] text-muted-foreground">
            In this climate this is usually the whole load — a fan cannot dry a room with wetter air.
          </p>
        </Group>

        {/* ---- what wets the room ---- */}
        <Group label="What else wets the room">
          <Field label="People" value={people} onChange={setPeople} width="w-24" />
          <Picker label="Doing" value={activity} onChange={(v) => setActivity(v as PeopleLatent)} className="w-52"
            options={PEOPLE_LATENT.map((a) => [a.key, a.label] as [string, string])} />
        </Group>
        <Group>
          <Field label="Process" value={process} onChange={setProcess} width="w-28" placeholder="tanks, washing" />
          <Picker label="" value={processUnit} onChange={(v) => setProcessUnit(v as WaterRateUnit)} className="w-28"
            options={[["kgh", "kg/h"], ["lday", "L/day"]]} />
          <Field label="Other" value={other} onChange={setOther} width="w-28" placeholder="wet goods" />
          <Picker label="" value={otherUnit} onChange={(v) => setOtherUnit(v as WaterRateUnit)} className="w-28"
            options={[["kgh", "kg/h"], ["lday", "L/day"]]} />
        </Group>

        {/* ---- the coil, if one is being sized ---- */}
        <Group label="The coil — leave the off-coil temperature blank to skip it">
          <Picker label="On-coil air" value={coilEntering} onChange={(v) => setCoilEntering(v as CoilEntering)}
            className="w-44"
            options={[["room", "Room air (recirculated)"], ["outdoor", "Outdoor air (100% fresh)"]]} />
          <Field label={`Off-coil (${deg})`} value={offCoilTemp} onChange={setOffCoilTemp} width="w-28" />
          <Field label="Off-coil RH (%)" value={offCoilRh} onChange={setOffCoilRh} width="w-28" />
          <p className="pb-1.5 text-[11px] text-muted-foreground">
            A wet cooling coil leaves air at 90–98%; a deep one at 98–100%.
          </p>
        </Group>

        {isMoistureError(result) && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{result.error}</p>
        )}
        {result === null && (
          <p className="text-sm text-muted-foreground">Give both air states a temperature and a humidity.</p>
        )}

        {ok && (
          <div className="space-y-4 border-t pt-4">
            {/* the two states, which everything else is the difference between */}
            <div className="grid gap-3 sm:grid-cols-2">
              <State label="Outdoor air" grains={ok.outdoorGrains} dewF={ok.outdoorDewPointF} deg={deg} asDeg={asDeg} />
              <State label="Room air" grains={ok.indoorGrains} dewF={ok.indoorDewPointF} deg={deg} asDeg={asDeg} />
            </div>

            {/* the balance, term by term */}
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Moisture balance</div>
              <div className="space-y-1">
                {ok.gains.map((g) => (
                  <div key={g.key} className="flex items-center gap-3 text-xs">
                    <span className="w-48 shrink-0 text-muted-foreground">{g.label}</span>
                    <span className={`w-24 shrink-0 text-right tabular-nums ${g.lbPerHr < 0 ? "text-emerald-700" : ""}`}>
                      {g.lbPerHr < 0 ? "−" : ""}{r1(Math.abs(g.lbPerHr) * 0.45359237 * 24)} L/day
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                      {g.lbPerHr > 0 ? `${Math.round(g.share * 100)}%` : "—"}
                    </span>
                    {/* A term that REMOVES gets an empty track, not a 1% stub —
                        the stub rendered as a stray green dot and read like a
                        rounding artefact. The minus sign and the colour on the
                        figure already say which way this one goes. */}
                    <span className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                      {g.lbPerHr > 0 && (
                        <span className="block h-full rounded bg-primary/60"
                          style={{ width: `${Math.max(1, g.share * 100)}%` }} />
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* what has to come out */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-primary/50 bg-primary/5 p-3">
                <div className="text-xs text-muted-foreground">Remove</div>
                <div className="text-2xl font-bold tabular-nums">
                  {fmt(ok.removalLitresDay)} <span className="text-sm font-normal">L/day</span>
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">{r2(ok.removalKgHr)} kg/h</div>
              </div>
              <Stat label="Latent load" value={`${fmt(ok.latentBtuh)} BTU/hr`} sub={`${r1(ok.latentTons)} TR · ${r1(ok.latentKw)} kW`} />
              {/* Labelled as the FACT (the room's dew point) rather than as the
                  instruction ("the coil must reach below"), because the instruction
                  is wrong in the branch where a fan does the job and no coil is
                  bought at all. The sub-line still says what it means for a coil. */}
              <Stat
                label="Room dew point"
                value={`${asDeg(ok.indoorDewPointF)} ${deg}`}
                sub="a coil warmer than this condenses nothing, however long it runs"
              />
            </div>

            {ok.surplus && (
              <p className="rounded-md border border-emerald-600/40 bg-emerald-50 p-3 text-sm text-emerald-900">
                Nothing has to be removed. The outdoor air is dry enough to carry off more than this room makes, so it
                will settle <strong>drier</strong> than the {indoorRh}% you asked for — ventilation alone does it.
              </p>
            )}

            {/* could a fan do it instead? */}
            {ok.dilutionRefusal ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>A bigger fan will not fix this.</strong> {ok.dilutionRefusal}
              </p>
            ) : ok.dilutionCfm != null && ok.dilutionCfm > 0 ? (
              <p className="rounded-md border border-emerald-600/40 bg-emerald-50 p-3 text-sm text-emerald-900">
                <strong>A fan can do this one.</strong> The outdoor air is drier than the room, so{" "}
                <strong>{fmt(ok.dilutionCfm)} CFM</strong> of it carries the moisture away on its own — no coil, no
                dehumidifier. Worth pricing against the machine.
              </p>
            ) : null}

            {/*
              The coil: how cold the surface actually runs, and what misses it.
              One panel whether it solves or not — a refusal in its own amber box
              stacked straight under the fan verdict, in the same colour, and the
              two read as a single wall of warning. The amber is the FAN's answer;
              this is the coil's, either way.
            */}
            {(ok.coil || ok.coilRefusal) && (
              <div className="space-y-3 rounded-md border border-sky-600/40 bg-sky-50/60 p-3">
                <div className="text-xs font-medium text-sky-900">
                  The coil — {coilEntering === "room" ? "room air recirculated" : "100% outdoor air"}, leaving at{" "}
                  {offCoilTemp} {deg} / {r1(offRh)}%
                </div>
                {ok.coilRefusal && <p className="text-sm text-sky-900">{ok.coilRefusal}</p>}
                {ok.coil && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Stat
                        label="Apparatus dew point"
                        value={`${asDeg(ok.coil.adpF)} ${deg}`}
                        sub="the one saturated surface this coil behaves as if it were"
                      />
                      <Stat
                        label="Bypass factor"
                        value={ok.coil.bypassFactor.toFixed(2)}
                        sub={`${Math.round(ok.coil.contactFactor * 100)}% of the air touches the fins`}
                      />
                      <Stat
                        label="Coil sensible ratio"
                        value={ok.coil.gshr.toFixed(2)}
                        sub={`${Math.round((1 - ok.coil.gshr) * 100)}% of its duty is drying, not cooling`}
                      />
                    </div>
                    <p className="text-[11px] text-sky-900/80">
                      On-coil <strong>{r1(ok.coil.enteringGrains)} gr/lb</strong> → off-coil{" "}
                      <strong>{r1(ok.coil.leavingGrains)}</strong> → apparatus dew point{" "}
                      <strong>{r1(ok.coil.adpGrains)}</strong>, all on one straight line to the saturation curve —
                      no coil geometry in it.
                      {ok.coil.coilCfm != null && (
                        <>
                          {" "}It drops {r1(ok.coil.enteringGrains - ok.coil.leavingGrains)} gr/lb, so{" "}
                          <strong>{fmt(ok.coil.coilCfm)} CFM</strong> has to cross it to take out the{" "}
                          {fmt(ok.removalLitresDay)} litres a day.
                        </>
                      )}
                    </p>
                  </>
                )}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Outdoor air carries <strong>{r1(ok.outdoorGrains)} gr/lb</strong> against the room&apos;s{" "}
              <strong>{r1(ok.indoorGrains)}</strong> — a difference of {r1(Math.abs(ok.deltaGrains))} gr/lb.
              {biggest && biggest.share > 0.5 && (
                <> <strong>{biggest.label}</strong> alone is {Math.round(biggest.share * 100)}% of what has to be
                removed — worth attacking directly before sizing equipment for it.</>
              )}
              {ok.removalLitresDay > 0 && (
                <> Size the condensate drain for <strong>{fmt(ok.removalLitresDay)} litres a day</strong>; it is the
                part nobody sizes.</>
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
      <Label htmlFor={id} className="text-[11px]">{label || " "}</Label>
      <Select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </div>
  );
}

/** One air state, as the two numbers that decide everything: water, and dew point. */
function State({
  label, grains, dewF, deg, asDeg,
}: {
  label: string; grains: number; dewF: number; deg: string; asDeg: (f: number) => number;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">
        {r1(grains)} <span className="text-xs font-normal text-muted-foreground">gr/lb</span>
        <span className="ml-2 text-xs font-normal text-muted-foreground">({r2(grainsToGkg(grains))} g/kg)</span>
      </div>
      <div className="text-[11px] text-muted-foreground">dew point {asDeg(dewF)} {deg}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
