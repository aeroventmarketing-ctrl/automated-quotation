"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  solvePlume,
  solveAch,
  isSmokeError,
  PLUME_SAMPLE,
  ACH_SAMPLE,
  type PlumeResult,
  type AchResult,
} from "@/lib/hvac/smoke-exhaust";
import { Group, Field, Picker, SelectFanLink, num, numOr, fmt0, fmtN } from "../calc-fields";

/**
 * Smoke exhaust — the quick calculator half of the proposal. Two methods: the
 * NFPA 92 smoke plume for an atrium or mall, and air changes for a car park or
 * basement.
 */
export function SmokeExhaustCalculator() {
  const [method, setMethod] = useState<"plume" | "ach">("plume");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([["plume", "Atrium / mall — smoke plume"], ["ach", "Car park / basement — air changes"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMethod(k)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${method === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>
            {l}
          </button>
        ))}
      </div>
      {method === "plume" ? <PlumeCalc /> : <AchCalc />}
    </div>
  );
}

function PlumeCalc() {
  const [fireKw, setFireKw] = useState(String(PLUME_SAMPLE.fireKw));
  const [conv, setConv] = useState(String(PLUME_SAMPLE.convectivePct));
  const [z, setZ] = useState(String(PLUME_SAMPLE.clearHeightM));
  const [d, setD] = useState(String(PLUME_SAMPLE.layerDepthM));
  const [outdoor, setOutdoor] = useState(String(PLUME_SAMPLE.outdoorC));
  const [points, setPoints] = useState(String(PLUME_SAMPLE.exhaustPoints));
  const [nearWall, setNearWall] = useState("no");
  const [makeupV, setMakeupV] = useState(String(PLUME_SAMPLE.makeupVelocity));
  const [loss, setLoss] = useState(String(PLUME_SAMPLE.systemLossPa));

  const result = useMemo(() => solvePlume({
    fireKw: num(fireKw), convectivePct: num(conv), clearHeightM: num(z), layerDepthM: num(d), outdoorC: num(outdoor),
    exhaustPoints: num(points), inletsNearWall: nearWall === "yes", makeupVelocity: num(makeupV), systemLossPa: numOr(loss, 0),
  }), [fireKw, conv, z, d, outdoor, points, nearWall, makeupV, loss]);
  const ok = isSmokeError(result) ? null : (result as PlumeResult);

  return (
    <>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Group label="Design fire — starting figures; confirm against the Fire Code (RA 9514 IRR) for the occupancy">
            <Picker label="Typical fire" value="" className="w-64"
              onChange={(v) => v && setFireKw(v)}
              options={[["", "— pick to fill —"], ["1000", "Office, sprinklered · 1 MW"], ["2500", "Shop unit, sprinklered · 2.5 MW"], ["5000", "Retail / mall, sprinklered · 5 MW"], ["10000", "Unsprinklered retail · 10 MW"]]} />
            <Field label="Fire size (kW)" value={fireKw} onChange={setFireKw} />
            <Field label="Convective part (%)" value={conv} onChange={setConv} width="w-24" />
          </Group>
          <Group label="The space">
            <Field label="Fire to smoke layer (m)" value={z} onChange={setZ} width="w-32" />
            <Field label="Smoke layer depth (m)" value={d} onChange={setD} width="w-32" />
            <Field label="Outdoor (°C)" value={outdoor} onChange={setOutdoor} width="w-24" />
          </Group>
          <Group label="Exhaust and make-up air">
            <Field label="Exhaust points" value={points} onChange={setPoints} width="w-24" />
            <Picker label="Inlets near a wall?" value={nearWall} onChange={setNearWall} className="w-32" options={[["no", "No"], ["yes", "Yes"]]} />
            <Field label="Make-up air limit (m/s)" value={makeupV} onChange={setMakeupV} width="w-32" />
            <Field label="Duct & grille losses (Pa)" value={loss} onChange={setLoss} width="w-32" />
          </Group>
        </CardContent>
      </Card>
      {!ok && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{isSmokeError(result) ? result.error : ""}</p>}
      {ok && (
        <Card className="border-primary/40">
          <CardContent className="grid gap-6 pt-6 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">Smoke exhaust</div>
                <div className="text-2xl font-bold tabular-nums">{fmt0(ok.exhaustCfm)} <span className="text-sm font-normal">CFM total</span></div>
                <div className="text-xs text-muted-foreground tabular-nums">{fmtN(ok.exhaustM3s, 1)} m³/s · {points} × {fmt0(ok.perPointCfm)} CFM @ {fmtN(ok.fanInwg, 2)} in.wg</div>
              </div>
              {ok.plugholing ? (
                <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
                  Plugholing — use at least {ok.minPoints} exhaust points
                </span>
              ) : (
                <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">No plugholing</span>
              )}
              <div className="flex flex-wrap gap-2">
                <SelectFanLink cfm={ok.perPointCfm} inwg={ok.fanInwg} label={`Select fan (${fmt0(ok.perPointCfm)} CFM each)`} />
              </div>
              <p className="text-xs text-muted-foreground">
                Smoke fans must be rated for the smoke temperature — suggested class {ok.fanClassC ? `F${ok.fanClassC} (${ok.fanClassC} °C)` : "above F842: check the design"}; confirm the fan&apos;s rating before quoting.
              </p>
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Convective heat</dt><dd className="text-right tabular-nums">{fmt0(ok.convectiveKw)} kW</dd>
              <dt className="text-muted-foreground">Flame height</dt><dd className="text-right tabular-nums">{fmtN(ok.flameHeightM, 2)} m</dd>
              <dt className="text-muted-foreground">Smoke mass flow</dt><dd className="text-right tabular-nums">{fmtN(ok.massFlowKgs, 1)} kg/s</dd>
              <dt className="text-muted-foreground">Smoke temperature</dt><dd className="text-right tabular-nums">{fmt0(ok.smokeC)} °C</dd>
              <dt className="text-muted-foreground">Smoke density</dt><dd className="text-right tabular-nums">{fmtN(ok.densityKgm3, 2)} kg/m³</dd>
              <dt className="text-muted-foreground">Per exhaust point</dt><dd className="text-right tabular-nums">{fmtN(ok.perPointM3s, 1)} m³/s (max {fmtN(ok.maxPerPointM3s, 1)})</dd>
              <dt className="text-muted-foreground">Make-up air</dt><dd className="text-right tabular-nums">{fmtN(ok.makeupM3s, 1)} m³/s · {fmtN(ok.makeupAreaM2, 1)} m² open</dd>
              <dt className="col-span-2 pt-2 text-[11px] text-muted-foreground">
                NFPA 92 axisymmetric plume: m = 0.071·Qc<sup>⅓</sup>·z<sup>5⁄3</sup> + 0.0018·Qc above the flame; all convective heat stays in the
                smoke; plugholing limit 4.16·γ·d<sup>5⁄2</sup>·(ΔT/T)<sup>½</sup> per point.
              </dt>
            </dl>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function AchCalc() {
  const [l, setL] = useState(String(ACH_SAMPLE.lengthM));
  const [w, setW] = useState(String(ACH_SAMPLE.widthM));
  const [h, setH] = useState(String(ACH_SAMPLE.heightM));
  const [ach, setAch] = useState(String(ACH_SAMPLE.ach));
  const [fans, setFans] = useState(String(ACH_SAMPLE.fans));
  const [loss, setLoss] = useState(String(ACH_SAMPLE.systemLossPa));
  const result = useMemo(() => solveAch({ lengthM: num(l), widthM: num(w), heightM: num(h), ach: num(ach), fans: num(fans), systemLossPa: numOr(loss, 0) }), [l, w, h, ach, fans, loss]);
  const ok = isSmokeError(result) ? null : (result as AchResult);
  return (
    <>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Group label="The space">
            <Field label="Length (m)" value={l} onChange={setL} width="w-24" />
            <Field label="Width (m)" value={w} onChange={setW} width="w-24" />
            <Field label="Height (m)" value={h} onChange={setH} width="w-24" />
          </Group>
          <Group label="Air changes — enter the figure the code requires for this space in smoke mode">
            <Field label="Air changes per hour" value={ach} onChange={setAch} width="w-32" />
            <Field label="Fans" value={fans} onChange={setFans} width="w-24" />
            <Field label="Duct & grille losses (Pa)" value={loss} onChange={setLoss} width="w-32" />
          </Group>
        </CardContent>
      </Card>
      {!ok && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{isSmokeError(result) ? result.error : ""}</p>}
      {ok && (
        <Card className="border-primary/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div>
              <div className="text-xs text-muted-foreground">Smoke exhaust</div>
              <div className="text-2xl font-bold tabular-nums">{fmt0(ok.exhaustCfm)} <span className="text-sm font-normal">CFM total</span></div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {fmt0(ok.volumeM3)} m³ × {ach} ÷ 3600 = {fmtN(ok.exhaustM3s, 1)} m³/s · {fans} × {fmt0(ok.perFanCfm)} CFM @ {fmtN(ok.fanInwg, 2)} in.wg
              </div>
            </div>
            <SelectFanLink cfm={ok.perFanCfm} inwg={ok.fanInwg} label={`Select fan (${fmt0(ok.perFanCfm)} CFM each)`} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
