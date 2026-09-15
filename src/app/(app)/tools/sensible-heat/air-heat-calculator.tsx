"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { HelpCircle } from "lucide-react";
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
import { AirPathDiagram, AIR_MEASUREMENT_NOTES } from "@/components/hvac/air-path-diagram";

/**
 * Air-side heat: sensible, latent, total and the sensible heat ratio.
 *
 * The maths lives in `lib/hvac/psychrometrics` — shared with the public HVAC
 * Tools page on the storefront, so both stay in step.
 *
 * Three things on this screen are deliberate and were the owner's call:
 *
 *  - **The basis is a switch, not a setting buried somewhere.** 1.08 is what
 *    Philippine worksheets use; 1.10 is current ASHRAE. The constants actually
 *    applied are printed under the answer, so a figure can be checked against a
 *    worksheet without anyone having to guess which one was used.
 *  - **Altitude and air temperature are ordinary fields**, not hidden behind an
 *    "advanced" toggle. Baguio is 17% down on sea level; that is not a detail to
 *    discover after quoting.
 *  - **Total is sensible + latent**, so the three figures add up. Enthalpy is
 *    optional and only ever a cross-check — see the library for why.
 */

const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 0 });

/** cfm back out into whatever the reader asked for. */
const AIRFLOW_LABEL: Record<HeatAirflowUnit, string> = { cfm: "CFM", m3hr: "m³/h", lps: "L/s" };
const fromCfm = (cfm: number, u: HeatAirflowUnit) =>
  u === "m3hr" ? cfm * 1.69901082 : u === "lps" ? cfm / 2.11888 : cfm;

export function AirHeatCalculator() {
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
  const [e1, setE1] = useState("");
  const [t2, setT2] = useState("55");
  const [h2, setH2] = useState("95");
  const [e2, setE2] = useState("");

  const [altitude, setAltitude] = useState("0");
  const [altitudeUnit, setAltitudeUnit] = useState<AltitudeUnit>("ft");
  const [flowTemp, setFlowTemp] = useState("70");
  // Closed by default: the calculator stays short on a phone, which is where
  // the question was asked from, and the answer is one tap away at the point
  // the two boxes below raise it.
  const [showHelp, setShowHelp] = useState(false);

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
        entering: { temp: signed(t1), humidity: nonNegative(h1), enthalpy: signed(e1) },
        leaving: { temp: signed(t2), humidity: nonNegative(h2), enthalpy: signed(e2) },
        basis,
        altitude: signed(altitude),
        altitudeUnit,
        flowTemp: signed(flowTemp),
      }),
    [mode, airflow, load, loadUnit, airflowUnit, tempUnit, humidityUnit, t1, h1, e1, t2, h2, e2, basis, altitude, altitudeUnit, flowTemp],
  );

  const deg = tempUnit === "c" ? "°C" : "°F";
  const ks = r2(heatConstants(basis).sensible);
  const humidityLabel =
    humidityUnit === "rh" ? "RH (%)" : humidityUnit === "grains" ? "gr/lb" : "g/kg";

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <p className="text-sm text-muted-foreground">
          {mode === "heat"
            ? <>Qs = {ks} × CFM × ΔT. Latent from the moisture removed, total from the two together.</>
            : <>CFM = Qs ÷ ({ks} × ΔT). The same equation rearranged — the airflow that carries a known sensible load.</>}
        </p>

        {/* Which way round the sum is worked. */}
        <div className="flex flex-wrap items-end gap-3">
          <Picker label="Solve for" value={mode} onChange={(v) => setMode(v as AirHeatMode)} className="w-52"
            options={[["heat", "Heat from an airflow"], ["airflow", "Airflow for a load"]]} />
          {mode === "heat" ? (
            <>
              <Field label="Airflow" value={airflow} onChange={setAirflow} placeholder="e.g. 2000" />
              <Picker label="Unit" value={airflowUnit} onChange={(v) => setAirflowUnit(v as HeatAirflowUnit)} className="w-28"
                options={[["cfm", "CFM"], ["m3hr", "m³/h"], ["lps", "L/s"]]} />
            </>
          ) : (
            <>
              <Field label="Sensible load" value={load} onChange={setLoad} placeholder="e.g. 24000" />
              <Picker label="Unit" value={loadUnit} onChange={(v) => setLoadUnit(v as LoadUnit)} className="w-28"
                options={[["btuh", "BTU/hr"], ["tons", "TR"], ["kw", "kW"]]} />
              <Picker label="Show airflow in" value={airflowUnit} onChange={(v) => setAirflowUnit(v as HeatAirflowUnit)} className="w-32"
                options={[["cfm", "CFM"], ["m3hr", "m³/h"], ["lps", "L/s"]]} />
            </>
          )}
          <Picker label="Temperature" value={tempUnit} onChange={(v) => setTempUnit(v as TempUnit)} className="w-24"
            options={[["f", "°F"], ["c", "°C"]]} />
          <Picker label="Humidity as" value={humidityUnit} onChange={(v) => setHumidityUnit(v as HumidityUnit)} className="w-32"
            options={[["rh", "RH %"], ["grains", "gr/lb"], ["gkg", "g/kg"]]} />
          <Picker label="Constant" value={basis} onChange={(v) => setBasis(v as HeatBasis)} className="w-40"
            options={HEAT_BASES.map((b) => [b.key, b.label] as [string, string])} />
        </div>
        <p className="-mt-2 text-[11px] text-muted-foreground">{basisDef(basis).note}</p>

        {/* The two air states */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-muted-foreground">The two air states</div>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {showHelp ? "Hide" : "Where do I measure these?"}
          </button>
        </div>

        {showHelp && (
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <AirPathDiagram />
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {AIR_MEASUREMENT_NOTES.map((n) => (
                <p key={n.title} className="text-[11px] leading-snug text-muted-foreground">
                  <span className="font-semibold text-foreground">{n.title}.</span> {n.body}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <StateBlock title="Entering air" hint="the room, or on-coil"
            temp={t1} setTemp={setT1} hum={h1} setHum={setH1} ent={e1} setEnt={setE1}
            deg={deg} humidityLabel={humidityLabel} />
          <StateBlock title="Leaving air" hint="the supply, or off-coil"
            temp={t2} setTemp={setT2} hum={h2} setHum={setH2} ent={e2} setEnt={setE2}
            deg={deg} humidityLabel={humidityLabel} />
        </div>

        {/* Density correction — always visible, because a quote worked at the
            wrong density is wrong by more than any rounding on this page. */}
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Air density</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Altitude" value={altitude} onChange={setAltitude} placeholder="0" />
            <Picker label="Unit" value={altitudeUnit} onChange={(v) => setAltitudeUnit(v as AltitudeUnit)} className="w-24"
              options={[["ft", "ft"], ["m", "m"]]} />
            <Field label={`Air temp at the meter (${deg})`} value={flowTemp} onChange={setFlowTemp} placeholder="70" width="w-44" />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Where the airflow was measured. Leave at sea level and {tempUnit === "c" ? "21 °C" : "70 °F"} for standard air.
          </p>
        </div>

        {isAirHeatError(result) && <p className="text-sm text-destructive">{result.error}</p>}

        {result && !isAirHeatError(result) && (
          <div className="space-y-3 border-t pt-4">
            {mode === "airflow" && (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                <div className="text-xs text-muted-foreground">Airflow required</div>
                <div className="text-2xl font-bold tabular-nums">
                  {fmt(fromCfm(result.cfm, airflowUnit))}{" "}
                  <span className="text-sm font-normal">{AIRFLOW_LABEL[airflowUnit]}</span>
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {fmt(result.cfm)} CFM · {r1(Math.abs(result.deltaTF))} °F {result.deltaTF >= 0 ? "drop" : "rise"}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Sensible" btu={result.sensible} />
              {result.latent != null && <Stat label="Latent" btu={result.latent} />}
              <Stat label="Total" btu={result.total} strong />
              {result.shr != null && (
                <div className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">SHR</div>
                  <div className="font-semibold tabular-nums">{r3(result.shr)}</div>
                  <div className="text-[11px] text-muted-foreground">sensible ÷ total</div>
                </div>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Using <strong>{r2(result.constants.sensible)}</strong> sensible
              {result.latent != null && <> · <strong>{r2(result.constants.latentGrains)}</strong> latent</>}
              {" "}· ΔT {r1(result.deltaTF)} °F
              {result.enteringGrains != null && result.leavingGrains != null && (
                <> · moisture {r1(result.enteringGrains)} → {r1(result.leavingGrains)} gr/lb</>
              )}
              {" "}· density factor <strong>{r3(result.densityFactor)}</strong> ({r3(result.density * 1000) / 1000} lb/ft³)
            </p>

            {result.crossCheck && (
              <p className="text-[11px] text-muted-foreground">
                Enthalpy cross-check: {fmt(result.crossCheck.total)} BTU/hr from Δh —{" "}
                {Math.abs(result.crossCheck.gapPct) < 3 ? (
                  <>{r1(result.crossCheck.gapPct)}% from the total above, which is the constants&apos; own
                  simplification rather than an error.</>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">
                    {r1(result.crossCheck.gapPct)}% away — check the enthalpies against the psychrometric chart.
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StateBlock({
  title, hint, temp, setTemp, hum, setHum, ent, setEnt, deg, humidityLabel,
}: {
  title: string; hint: string;
  temp: string; setTemp: (v: string) => void;
  hum: string; setHum: (v: string) => void;
  ent: string; setEnt: (v: string) => void;
  deg: string; humidityLabel: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs font-medium">{title} <span className="text-muted-foreground">— {hint}</span></div>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <Field label={`Dry bulb (${deg})`} value={temp} onChange={setTemp} width="w-28" />
        <Field label={humidityLabel} value={hum} onChange={setHum} width="w-24" placeholder="optional" />
        <Field label="Enthalpy" value={ent} onChange={setEnt} width="w-28" placeholder="optional" />
      </div>
    </div>
  );
}

/**
 * A labelled number box. The label is TIED to the input with an id — without
 * that, "Altitude" is decoration: a screen reader announces an unnamed spin
 * button, and clicking the word does not focus the box. The other HVAC tools
 * predate this; new ones should not repeat it.
 */
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

/** One heat, in the three units people quote it in. */
function Stat({ label, btu, strong = false }: { label: string; btu: number; strong?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${strong ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{fmt(btu)} <span className="text-xs font-normal">BTU/hr</span></div>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {r2(btuToTons(btu))} TR · {r2(btuToKw(btu))} kW
      </div>
    </div>
  );
}
