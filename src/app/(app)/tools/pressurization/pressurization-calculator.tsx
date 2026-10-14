"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  solvePressurization,
  isPressError,
  PRESS_CRITERIA,
  DOOR_LEAKAGE,
  PRESS_SAMPLE,
  levelName,
  type PressInput,
  type PressResult,
} from "@/lib/hvac/pressurization";
import { Group, Field, Picker, SelectFanLink, num, numOr, fmt0, fmtN } from "../calc-fields";
import { SectionView } from "./section-view";

/**
 * Stair pressurization — the floor-by-floor schedule the owner chose ("C, plus
 * D later"). The quick answer (fan airflow and pressure) sits at the top, so
 * Sales gets a number in seconds; the schedule and chart below show every
 * floor against the minimum pressure and the door-force limit.
 */

type Form = Record<keyof PressInput, string>;
const toForm = (i: PressInput): Form =>
  Object.fromEntries(Object.entries(i).map(([k, v]) => [k, String(v)])) as Form;

export function PressurizationCalculator() {
  const [f, setF] = useState<Form>(() => toForm(PRESS_SAMPLE));
  const [criteria, setCriteria] = useState("en12101_a");
  const [doorType, setDoorType] = useState("single-in");
  const [project, setProject] = useState("Office tower — Stair 1");
  // Option C's chart & schedule, or option D's building section — the same solve either way.
  const [view, setView] = useState<"schedule" | "section">("schedule");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof PressInput) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const input: PressInput = useMemo(() => ({
    floors: num(f.floors), floorHeight: num(f.floorHeight),
    designPa: num(f.designPa), minPa: numOr(f.minPa, 0),
    doorForceLimitN: num(f.doorForceLimitN), closerForceN: numOr(f.closerForceN, 0),
    doorWidth: num(f.doorWidth), doorHeight: num(f.doorHeight),
    doorLeakArea: numOr(f.doorLeakArea, 0), exitLeakArea: numOr(f.exitLeakArea, 0), otherLeakArea: numOr(f.otherLeakArea, 0),
    outdoorC: num(f.outdoorC), stairC: num(f.stairC),
    openDoorVelocity: numOr(f.openDoorVelocity, 0),
    // A fire floor above a shortened stair falls back to its top floor.
    fireFloor: Math.min(numOr(f.fireFloor, 0), Math.max(0, Math.floor(numOr(f.floors, 0)))),
    ductLeakPct: numOr(f.ductLeakPct, 0), systemLossPa: numOr(f.systemLossPa, 0),
  }), [f]);
  const result = useMemo(() => solvePressurization(input), [input]);
  const ok = !isPressError(result) ? (result as PressResult) : null;

  function pickCriteria(key: string) {
    setCriteria(key);
    const c = PRESS_CRITERIA.find((x) => x.key === key);
    if (c) setF((p) => ({ ...p, designPa: String(c.designPa), minPa: String(c.minPa), doorForceLimitN: String(c.doorForceLimitN), openDoorVelocity: String(c.openDoorVelocity) }));
  }
  function pickDoor(key: string) {
    setDoorType(key);
    const d = DOOR_LEAKAGE.find((x) => x.key === key);
    if (d) setF((p) => ({ ...p, doorLeakArea: String(d.area) }));
  }

  async function download() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tools/pressurization/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, criteria: PRESS_CRITERIA.find((c) => c.key === criteria)?.label ?? "Custom", input }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Couldn't make the sheet (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name ? decodeURIComponent(name) : "Stair pressurization.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't make the sheet.");
    } finally {
      setBusy(false);
    }
  }

  const floorsN = Number.isInteger(input.floors) && input.floors > 0 ? input.floors : 0;

  return (
    <div className="space-y-4">
      {/* The quick answer. */}
      <Card className={ok ? "border-primary/40" : ""}>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          {ok ? (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Stair pressurization fan</div>
              <div className="text-2xl font-bold tabular-nums">
                {fmt0(ok.fanCfm)} <span className="text-sm font-normal">CFM</span>
                <span className="mx-2 text-muted-foreground">@</span>
                {fmtN(ok.fanInwg, 2)} <span className="text-sm font-normal">in.wg</span>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {fmtN(ok.fanM3s, 2)} m³/s · {fmt0(ok.fanPa)} Pa · roof injection
              </div>
              <StatusChip r={ok} />
            </div>
          ) : (
            <p className="text-sm text-destructive">{isPressError(result) ? result.error : ""}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {ok && <SelectFanLink cfm={ok.fanCfm} inwg={ok.fanInwg} />}
            <Button variant="outline" onClick={download} disabled={!ok || busy}>
              <Download className="h-4 w-4" />
              <span className="normal-case">{busy ? "Preparing…" : "Calc sheet (.xlsx)"}</span>
            </Button>
          </div>
          {err && <p className="w-full text-sm text-destructive">{err}</p>}
        </CardContent>
      </Card>

      {/* The inputs. */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Group label="Project">
            <Field label="Project / stair" value={project} onChange={setProject} width="w-72" type="text" />
          </Group>
          <Group label="Criteria — starting figures; confirm against the Fire Code (RA 9514 IRR) and the PSME Code">
            <Picker label="Standard" value={criteria} onChange={pickCriteria} className="w-80"
              options={[...PRESS_CRITERIA.map((c) => [c.key, c.label] as [string, string]), ["custom", "Custom"]]} />
            <Field label="Design pressure (Pa)" value={f.designPa} onChange={(v) => { setCriteria("custom"); set("designPa")(v); }} />
            <Field label="Minimum (Pa)" value={f.minPa} onChange={(v) => { setCriteria("custom"); set("minPa")(v); }} />
            <Field label="Door-force limit (N)" value={f.doorForceLimitN} onChange={(v) => { setCriteria("custom"); set("doorForceLimitN")(v); }} />
            <Field label="Open-door air (m/s)" value={f.openDoorVelocity} onChange={(v) => { setCriteria("custom"); set("openDoorVelocity")(v); }} />
          </Group>
          <Group label="The stair">
            <Field label="Floors above ground" value={f.floors} onChange={set("floors")} />
            <Field label="Floor to floor (m)" value={f.floorHeight} onChange={set("floorHeight")} />
            <Field label="Outdoor (°C)" value={f.outdoorC} onChange={set("outdoorC")} width="w-24" />
            <Field label="Stair (°C)" value={f.stairC} onChange={set("stairC")} width="w-24" />
          </Group>
          <Group label="Stair doors — one per floor">
            <Picker label="Door type" value={doorType} onChange={pickDoor} className="w-80"
              options={[...DOOR_LEAKAGE.map((d) => [d.key, `${d.label} · ${d.area} m²`] as [string, string]), ["custom", "Custom"]]} />
            <Field label="Width (m)" value={f.doorWidth} onChange={set("doorWidth")} width="w-24" />
            <Field label="Height (m)" value={f.doorHeight} onChange={set("doorHeight")} width="w-24" />
            <Field label="Leakage per door (m²)" value={f.doorLeakArea} onChange={(v) => { setDoorType("custom"); set("doorLeakArea")(v); }} width="w-32" />
            <Field label="Ground exit door (m²)" value={f.exitLeakArea} onChange={set("exitLeakArea")} width="w-32" />
            <Field label="Other leakage per floor (m²)" value={f.otherLeakArea} onChange={set("otherLeakArea")} width="w-36" placeholder="0" />
            <Field label="Closer force (N)" value={f.closerForceN} onChange={set("closerForceN")} width="w-24" />
          </Group>
          <Group label="Open-door case and fan">
            <Picker label="Fire floor (door open)" value={String(input.fireFloor)} onChange={set("fireFloor")} className="w-36"
              options={Array.from({ length: floorsN + 1 }, (_, i) => [String(i), levelName(i)] as [string, string])} />
            <Field label="Duct leakage (%)" value={f.ductLeakPct} onChange={set("ductLeakPct")} width="w-24" />
            <Field label="Duct & grille losses (Pa)" value={f.systemLossPa} onChange={set("systemLossPa")} width="w-32" />
          </Group>
        </CardContent>
      </Card>

      {ok && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Results view">
            {([["schedule", "Chart & schedule"], ["section", "Section view"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${view === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>
                {l}
              </button>
            ))}
          </div>

          {view === "section" ? (
            <Card>
              <CardContent className="pt-6">
                <SectionView input={input} result={ok} project={project} onFireFloor={(level) => set("fireFloor")(String(level))} />
              </CardContent>
            </Card>
          ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="space-y-2 pt-6">
                <div className="text-xs font-medium text-muted-foreground">Pressure on each floor</div>
                <PressureChart r={ok} minPa={input.minPa} />
                <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />Within limits</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-600" />Over the door-force limit</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Under the minimum</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 pt-6">
                <div className="text-xs font-medium text-muted-foreground">Schedule</div>
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Floor</th>
                        <th className="px-2 py-1 text-right font-medium">Height m</th>
                        <th className="px-2 py-1 text-right font-medium">ΔP Pa</th>
                        <th className="px-2 py-1 text-right font-medium">Leakage m³/s</th>
                        <th className="px-2 py-1 text-right font-medium">Door force N</th>
                        <th className="px-2 py-1 text-left font-medium">Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...ok.rows].reverse().map((r) => (
                        <tr key={r.level} className={`border-t ${r.level === input.fireFloor ? "bg-red-50 dark:bg-red-950/30" : ""}`}>
                          <td className="px-2 py-1">{r.name}{r.level === input.fireFloor && <span className="ml-1 text-[10px] text-red-600">fire</span>}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtN(r.heightM, 1)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtN(r.dpPa, 1)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtN(r.leakageM3s, 3)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.doorForceN}</td>
                          <td className="px-2 py-1">
                            {r.status === "ok" ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">OK</span>
                              : r.status === "over" ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">Over</span>
                              : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Under</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
          )}

          <Card>
            <CardContent className="grid gap-6 pt-6 md:grid-cols-2">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Leakage, all doors closed</dt><dd className="text-right tabular-nums">{fmtN(ok.leakClosedM3s, 2)} m³/s</dd>
                {ok.openDoorM3s > 0 && <>
                  <dt className="text-muted-foreground">{levelName(input.fireFloor)} door open ({input.openDoorVelocity} m/s) + the other doors</dt>
                  <dd className="text-right tabular-nums">{fmtN(ok.openCaseM3s, 2)} m³/s</dd>
                </>}
                <dt className="text-muted-foreground">+{input.ductLeakPct}% duct leakage → fan</dt>
                <dd className="text-right font-semibold tabular-nums">{fmtN(ok.fanM3s, 2)} m³/s · {fmt0(ok.fanCfm)} CFM</dd>
                <dt className="text-muted-foreground">Fan pressure: top floor + {fmt0(input.systemLossPa)} Pa losses</dt>
                <dd className="text-right tabular-nums">{fmt0(ok.fanPa)} Pa · {fmtN(ok.fanInwg, 2)} in.wg</dd>
                {ok.reliefAreaM2 > 0 && <>
                  <dt className="text-muted-foreground">Relief vent, free area</dt>
                  <dd className="text-right tabular-nums">{fmtN(ok.reliefAreaM2, 2)} m²</dd>
                </>}
                <dt className="text-muted-foreground">Stack effect over the stair</dt><dd className="text-right tabular-nums">{fmtN(ok.stackPa, 1)} Pa</dd>
                <dt className="text-muted-foreground">Most the door force allows</dt><dd className="text-right tabular-nums">{fmtN(ok.maxPaForDoorForce, 1)} Pa</dd>
              </dl>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>
                  The fan is sized so the weakest floor holds {input.designPa} Pa.{" "}
                  {ok.stackPa > 0.05
                    ? ok.highestAtBottom
                      ? "Outdoors is warmer than the stair, so the pressure rises going down and the ground floor is highest."
                      : "Outdoors is cooler than the stair, so the pressure rises going up and the top floor is highest."
                    : "Outdoors and the stair are the same temperature, so every floor sits at the design pressure."}
                </p>
                {ok.overFloors.length > 0 && (
                  <p className="rounded-md bg-red-50 p-2 text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    <strong>{ok.overFloors.join(", ")}</strong> {ok.overFloors.length === 1 ? "is" : "are"} over the {fmtN(ok.maxPaForDoorForce, 1)} Pa
                    a {input.doorForceLimitN} N door force allows. Fixes: pressure relief to the stair at those floors, splitting the stair
                    into vertical zones, a wider door or a lighter closer — or lower the design pressure if the code allows it.
                  </p>
                )}
                {ok.underFloors.length > 0 && (
                  <p className="rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    <strong>{ok.underFloors.join(", ")}</strong> {ok.underFloors.length === 1 ? "is" : "are"} below the {input.minPa} Pa minimum — raise the design pressure.
                  </p>
                )}
                {ok.reliefAreaM2 > 0 && (
                  <p>The relief vent lets out the open-door air when the door shuts, so the stair doesn&apos;t over-pressurize.</p>
                )}
                <p>
                  Closed doors leak 0.83·A·√ΔP; stack effect is 3460·h·(1/T<sub>out</sub> − 1/T<sub>stair</sub>); door force is
                  F<sub>closer</sub> + W·A·ΔP / 2(W − 0.075). The open-door case keeps the other floors at their closed-door pressures.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatusChip({ r }: { r: PressResult }) {
  if (r.overFloors.length) return <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">{r.overFloors.length} {r.overFloors.length === 1 ? "floor" : "floors"} over the door-force limit</span>;
  if (r.underFloors.length) return <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">{r.underFloors.length} under the minimum</span>;
  return <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Every floor within limits</span>;
}

/** Horizontal bars, one per floor (top floor at the top), on one Pa scale with the min and max lines. */
function PressureChart({ r, minPa }: { r: PressResult; minPa: number }) {
  const rows = [...r.rows].reverse();
  const peak = Math.max(...rows.map((x) => x.dpPa), r.maxPaForDoorForce, minPa);
  const step = peak > 150 ? 50 : peak > 60 ? 20 : 10;
  const xMax = Math.ceil((peak * 1.08) / step) * step;
  const L = 40, R = 470, T = 18, rowH = Math.max(9, Math.min(20, 320 / rows.length));
  const B = T + rowH * rows.length;
  const x = (v: number) => L + (v / xMax) * (R - L);
  const ticks = Array.from({ length: xMax / step + 1 }, (_, k) => k * step);
  const labelEvery = rows.length > 30 ? 5 : rows.length > 18 ? 2 : 1;
  return (
    <svg viewBox={`0 0 490 ${B + 36}`} className="w-full" role="img" aria-label="Stair pressure on each floor">
      {minPa > 0 && <rect x={x(minPa)} y={T} width={Math.max(0, x(r.maxPaForDoorForce) - x(minPa))} height={B - T} className="fill-emerald-500/10" />}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={T} y2={B} className="stroke-border" strokeWidth={1} />
          <text x={x(t)} y={B + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">{t}</text>
        </g>
      ))}
      <text x={(L + R) / 2} y={B + 30} textAnchor="middle" className="fill-muted-foreground text-[10px]">Stair pressure, Pa</text>
      {rows.map((row, k) => (
        <g key={row.level}>
          <rect x={L} y={T + k * rowH + rowH * 0.15} width={Math.max(0, x(row.dpPa) - L)} height={rowH * 0.7} rx={1.5}
            className={row.status === "over" ? "fill-red-600" : row.status === "under" ? "fill-amber-500" : "fill-emerald-600"} />
          {(k % labelEvery === 0 || k === rows.length - 1) && (
            <text x={L - 6} y={T + k * rowH + rowH * 0.62} textAnchor="end" className="fill-muted-foreground text-[10px]">{row.name}</text>
          )}
        </g>
      ))}
      {minPa > 0 && <MarkLine x={x(minPa)} T={T} B={B} label={`min ${minPa}`} anchor="end" />}
      <MarkLine x={x(r.maxPaForDoorForce)} T={T} B={B} label={`max ${fmtN(r.maxPaForDoorForce, 1)}`} anchor="start" />
    </svg>
  );
}

function MarkLine({ x, T, B, label, anchor }: { x: number; T: number; B: number; label: string; anchor: "start" | "end" }) {
  return (
    <g>
      <line x1={x} x2={x} y1={T - 4} y2={B} className="stroke-foreground" strokeWidth={1.2} strokeDasharray="4 3" />
      <text x={anchor === "start" ? x + 4 : x - 4} y={T - 6} textAnchor={anchor} className="fill-foreground text-[10px]">{label}</text>
    </g>
  );
}
