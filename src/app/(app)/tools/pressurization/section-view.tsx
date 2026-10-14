"use client";

import { useRef, useState } from "react";
import { ImageDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { levelName, type PressInput, type PressResult } from "@/lib/hvac/pressurization";
import { SelectFanLink, fmt0, fmtN } from "../calc-fields";

/**
 * Option D — the building section. The owner chose "C, plus D later", then
 * "Build option D now": a drawing of the stair and its floors, worked from the
 * same solve as the schedule. Click a floor to make it the fire floor (its door
 * opens and the airflow is re-solved); hover for that floor's figures; save
 * the drawing as an image for a proposal.
 *
 * The drawing is a white engineering sheet with its colours written into the
 * SVG (not theme classes), so the PNG it exports looks exactly like the screen.
 */

const C = {
  paper: "#ffffff", ink: "#1f2937", muted: "#6b7280", grid: "#e5e7eb",
  stair: "#eaf1fe", stairEdge: "#2563eb", air: "#2563eb",
  ok: "#15803d", okSoft: "#e7f6ec", bad: "#b91c1c", badSoft: "#fde8e8", warn: "#b45309", warnSoft: "#fdf3e2",
  fire: "#dc2626", fireSoft: "#fef2f2", hover: "#f3f4f6",
};
const TAG_W = 88;
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export function SectionView({
  input, result, project, onFireFloor,
}: {
  input: PressInput;
  result: PressResult;
  project: string;
  onFireFloor: (level: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const n = result.rows.length; // G + floors
  const rowH = Math.max(10, Math.min(30, 560 / n));
  const top = 96, bottom = top + rowH * n;
  const W = 640, H = bottom + 64;
  const sx = 70, sw = 84, fx = sx + sw, fw = 300, tagX = fx + fw + 14;
  const labelEvery = rowH >= 16 ? 1 : rowH >= 11 ? 2 : 5;
  const yTop = (level: number) => bottom - (level + 1) * rowH;
  const fire = input.fireFloor;
  const doorOpen = result.openDoorM3s > 0;
  const shown = hover ?? fire;
  const shownRow = result.rows[shown];

  async function savePng() {
    const svg = svgRef.current;
    if (!svg) return;
    setSaving(true);
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("Couldn't draw the image.")); img.src = url; });
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(project || "Stair pressurization").replace(/[^\w .,&-]+/g, "").trim() || "Stair"} - section.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } finally {
      setSaving(false);
    }
  }

  const tone = (level: number) => {
    const r = result.rows[level];
    if (level === fire && doorOpen) return { fill: C.fireSoft, ink: C.fire };
    return r.status === "over" ? { fill: C.badSoft, ink: C.bad } : r.status === "under" ? { fill: C.warnSoft, ink: C.warn } : { fill: C.okSoft, ink: C.ok };
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="overflow-x-auto rounded-md border bg-white p-2">
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480 }}
          fontFamily={FONT} role="img" aria-label={`Section of the stair: ${n} levels, fire floor ${levelName(fire)}`}>
          <rect x={0} y={0} width={W} height={H} fill={C.paper} />
          <text x={16} y={22} fontSize={13} fontWeight={700} fill={C.ink}>{project || "Stair pressurization"} — section</text>
          <text x={16} y={38} fontSize={10.5} fill={C.muted}>
            {`Design ${input.designPa} Pa at the weakest floor · door-force limit ${input.doorForceLimitN} N (${fmtN(result.maxPaForDoorForce, 1)} Pa) · ${input.outdoorC} °C outdoor / ${input.stairC} °C stair`}
          </text>

          {/* Roof fan and its supply. */}
          <rect x={sx + 12} y={top - 40} width={60} height={26} rx={4} fill={C.air} />
          <text x={sx + 42} y={top - 23} fontSize={11} fontWeight={700} textAnchor="middle" fill="#ffffff">FAN</text>
          <text x={sx + 80} y={top - 30} fontSize={11} fontWeight={600} fill={C.ink}>{`${fmt0(result.fanCfm)} CFM`}</text>
          <text x={sx + 80} y={top - 17} fontSize={10.5} fill={C.muted}>{`${fmt0(result.fanPa)} Pa · ${fmtN(result.fanInwg, 2)} in.wg`}</text>
          <line x1={sx + 42} x2={sx + 42} y1={top - 14} y2={top + 4} stroke={C.air} strokeWidth={3} />

          {/* Building and stair. */}
          <rect x={sx} y={top} width={sw + fw} height={bottom - top} fill={C.paper} stroke={C.ink} strokeWidth={1.5} />
          <rect x={sx} y={top} width={sw} height={bottom - top} fill={C.stair} stroke={C.stairEdge} strokeWidth={1.5} />
          {Array.from({ length: Math.max(1, Math.floor((bottom - top) / 110)) }, (_, k) => {
            const y = top + 16 + k * 110;
            return <path key={k} d={`M ${sx + sw / 2} ${y} v 34 m -6 -9 l 6 9 l 6 -9`} stroke={C.air} strokeWidth={2} fill="none" />;
          })}

          {result.rows.map((r) => {
            const y = yTop(r.level), mid = y + rowH / 2;
            const isFire = r.level === fire && doorOpen;
            const t = tone(r.level);
            const showLabel = r.level % labelEvery === 0 || r.level === n - 1 || isFire || r.status !== "ok";
            return (
              <g key={r.level}>
                {hover === r.level && <rect x={fx} y={y} width={fw} height={rowH} fill={C.hover} />}
                {isFire && <rect x={fx + 0.75} y={y + 0.75} width={fw - 1.5} height={rowH - 1.5} fill={C.fireSoft} />}
                {r.level > 0 && <line x1={sx} x2={fx + fw} y1={y + rowH} y2={y + rowH} stroke={C.grid} strokeWidth={1} />}
                {/* The stair door: a solid bar when shut, a gap with the air going through when open. */}
                {isFire ? (
                  <>
                    <line x1={fx} x2={fx} y1={y + 2} y2={y + rowH * 0.25} stroke={C.fire} strokeWidth={2} />
                    <path d={`M ${fx - 4} ${mid} h 30 m -7 -5 l 7 5 l -7 5`} stroke={C.air} strokeWidth={2} fill="none" />
                    {rowH >= 12 && (
                      <text x={fx + 34} y={mid + 3.5} fontSize={10.5} fontWeight={700} fill={C.fire}>
                        {`FIRE FLOOR · door open · ${input.openDoorVelocity} m/s`}
                      </text>
                    )}
                    <path d={`M ${fx + fw - 24} ${y + rowH - 2} q -7 -${rowH * 0.35} 0 -${rowH * 0.7} q 2 ${rowH * 0.25} 5 ${rowH * 0.15} q -2 -${rowH * 0.25} 4 -${rowH * 0.35} q 6 ${rowH * 0.45} 0 ${rowH * 0.9} z`} fill={C.fire} />
                  </>
                ) : (
                  <line x1={fx} x2={fx} y1={y + 2} y2={y + rowH - 2} stroke={C.ink} strokeWidth={3} />
                )}
                {showLabel && <text x={sx - 8} y={mid + 3.5} fontSize={10.5} textAnchor="end" fill={C.muted}>{r.name}</text>}
                {showLabel && (
                  <g>
                    <rect x={tagX} y={mid - Math.min(8, rowH / 2 - 1)} width={TAG_W} height={Math.min(16, rowH - 2)} rx={Math.min(8, rowH / 2 - 1)} fill={t.fill} />
                    <text x={tagX + TAG_W / 2} y={mid + 3.5} fontSize={10} fontWeight={600} textAnchor="middle" fill={t.ink}>
                      {isFire ? `${fmtN(r.dpPa, 0)} Pa · open` : `${fmtN(r.dpPa, 0)} Pa`}
                    </text>
                  </g>
                )}
                {/* The whole floor is the hit target — click to make it the fire floor. */}
                <rect x={sx} y={y} width={tagX + TAG_W - sx} height={rowH} fill="transparent" style={{ cursor: "pointer" }}
                  tabIndex={0} role="button" aria-label={`${r.name}: ${fmtN(r.dpPa, 1)} Pa — make this the fire floor`}
                  onClick={() => onFireFloor(r.level)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFireFloor(r.level); } }}
                  onMouseEnter={() => setHover(r.level)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(r.level)} onBlur={() => setHover(null)} />
              </g>
            );
          })}

          {/* Ground and exit. */}
          <line x1={20} x2={W - 20} y1={bottom} y2={bottom} stroke={C.ink} strokeWidth={2} />
          <text x={sx + sw / 2} y={bottom + 16} fontSize={10.5} textAnchor="middle" fill={C.muted}>STAIR</text>

          {/* Stack effect: which way the pressure rises. */}
          {result.stackPa > 0.05 && (() => {
            const ax = tagX + TAG_W + 22;
            const [from, to] = result.highestAtBottom ? [top + 8, bottom - 8] : [bottom - 8, top + 8];
            const dir = result.highestAtBottom ? 1 : -1;
            return (
              <g>
                <line x1={ax} x2={ax} y1={from} y2={to} stroke={C.muted} strokeWidth={1.5} />
                <path d={`M ${ax - 5} ${to - 8 * dir} L ${ax} ${to} L ${ax + 5} ${to - 8 * dir}`} stroke={C.muted} strokeWidth={1.5} fill="none" />
                <text x={ax + 8} y={(top + bottom) / 2 - 6} fontSize={10} fill={C.muted}>stack</text>
                <text x={ax + 8} y={(top + bottom) / 2 + 7} fontSize={10} fill={C.muted}>{`+${fmtN(result.stackPa, 1)} Pa`}</text>
              </g>
            );
          })()}

          <text x={16} y={H - 16} fontSize={10} fill={C.muted}>
            {`Fan ${fmt0(result.fanCfm)} CFM @ ${fmt0(result.fanPa)} Pa · ${result.overFloors.length ? `${result.overFloors.length} floor(s) over the door-force limit` : "every floor within limits"} · ${result.governedBy === "door-open" ? "open-door case governs" : "closed-door leakage governs"}`}
          </text>
        </svg>
      </div>

      <div className="space-y-4 text-sm">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{hover != null ? "Floor" : "Fire floor"}</div>
          <div className="text-lg font-semibold">{shownRow ? shownRow.name : "—"}</div>
          {shownRow && (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-muted-foreground">Stair pressure</dt><dd className="text-right tabular-nums">{fmtN(shownRow.dpPa, 1)} Pa</dd>
              <dt className="text-muted-foreground">Door leakage (shut)</dt><dd className="text-right tabular-nums">{fmtN(shownRow.leakageM3s, 3)} m³/s</dd>
              <dt className="text-muted-foreground">Door-opening force</dt><dd className="text-right tabular-nums">{shownRow.doorForceN} N</dd>
              <dt className="text-muted-foreground">Check</dt>
              <dd className={`text-right font-medium ${shownRow.status === "ok" ? "text-emerald-700 dark:text-emerald-400" : shownRow.status === "over" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                {shownRow.status === "ok" ? "OK" : shownRow.status === "over" ? "Over the limit" : "Under the minimum"}
              </dd>
            </dl>
          )}
          <p className="text-[11px] text-muted-foreground">
            {doorOpen
              ? "Click a floor in the drawing to make it the fire floor; the airflow is worked out again."
              : "These criteria have no open-door case, so the fire floor doesn't change the airflow."}
          </p>
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Fan</div>
          <div className="font-semibold tabular-nums">{fmt0(result.fanCfm)} CFM @ {fmtN(result.fanInwg, 2)} in.wg</div>
          <div className="text-xs text-muted-foreground">
            {result.governedBy === "door-open" ? `Open door on ${levelName(fire)} governs` : "Closed-door leakage governs"}
          </div>
        </div>
        <div className="grid gap-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.air }} />Supply air</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.ok }} />Floor within limits</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.bad }} />Over the door-force limit</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.fire }} />Fire floor</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <SelectFanLink cfm={result.fanCfm} inwg={result.fanInwg} />
          <Button variant="outline" onClick={savePng} disabled={saving}>
            <ImageDown className="h-4 w-4" />
            <span className="normal-case">{saving ? "Saving…" : "Save image (.png)"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
