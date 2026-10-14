/**
 * Stair pressurization, floor by floor.
 *
 * The owner chose "C, plus D later" from the proposal: a schedule with one row
 * per floor, every floor checked against the minimum pressure and the
 * door-opening force, because stack effect makes the floors of a tall stair
 * differ. This is that calculation; the screen and the xlsx sheet both read it.
 *
 * Method (EN 12101-6 / NFPA 92):
 *
 *   Closed-door leakage   Q  = 0.83 · A · ΔP^½                    m³/s
 *   Stack effect          ΔP(h) = ΔP(ref) + K · (h − ref),
 *                         K  = 3460 · (1/T_out − 1/T_stair)       Pa per m, T in K
 *   Door-opening force    F  = F_closer + W · A_door · ΔP / (2 · (W − d))
 *   Open-door airflow     Q  = v · A_door (fire-floor door open, others closed)
 *   Relief vent           A  = Q_excess / (0.83 · ΔP_design^½)
 *
 * The fan is sized so the WEAKEST floor holds the design pressure: on a hot day
 * (outdoor warmer than the stair) that is the top floor and the pressure rises
 * going down; on a cold one, the other way round. Injection is at the roof.
 *
 * Simplifications, stated on the sheet: the open-door case holds the other
 * floors at their closed-door pressures, and leakage is through doors (plus an
 * optional "other leakage" area per floor) — walls and lift shafts are not
 * modelled separately.
 */
import { r1, r2, r3 } from "./parse";

export const M3S_TO_CFM = 2118.88;
export const PA_PER_INWG = 249.0889;
/** Door handle to the latch edge, m — the `d` in the door-force formula. */
export const KNOB_TO_EDGE_M = 0.075;

export type PressCriteriaKey = "en12101_a" | "en12101_b" | "nfpa92" | "custom";

export interface PressCriteria {
  key: PressCriteriaKey;
  label: string;
  designPa: number;
  /** Below this a floor is flagged (EN: the −10% tolerance; NFPA 92: the sprinklered minimum). */
  minPa: number;
  doorForceLimitN: number;
  /** Through the fire floor's open door, m/s; 0 = no open-door case. */
  openDoorVelocity: number;
}

/** Starting figures — confirm them against the Fire Code (RA 9514 IRR) and the PSME Code for the job. */
export const PRESS_CRITERIA: PressCriteria[] = [
  { key: "en12101_a", label: "EN 12101-6 Class A — means of escape", designPa: 50, minPa: 45, doorForceLimitN: 100, openDoorVelocity: 0.75 },
  { key: "en12101_b", label: "EN 12101-6 Class B — firefighting", designPa: 50, minPa: 45, doorForceLimitN: 100, openDoorVelocity: 2 },
  { key: "nfpa92", label: "NFPA 92 — sprinklered building", designPa: 25, minPa: 12.5, doorForceLimitN: 133, openDoorVelocity: 0 },
];

/** Standard leakage areas (EN 12101-6 Annex A). */
export const DOOR_LEAKAGE: { key: string; label: string; area: number }[] = [
  { key: "single-in", label: "Single leaf, opens into the stair", area: 0.01 },
  { key: "single-out", label: "Single leaf, opens out of the stair", area: 0.02 },
  { key: "double", label: "Double leaf", area: 0.03 },
];

export interface PressInput {
  /** Floors above ground served by the stair; the schedule is G plus these. */
  floors: number;
  floorHeight: number;
  designPa: number;
  minPa: number;
  doorForceLimitN: number;
  closerForceN: number;
  doorWidth: number;
  doorHeight: number;
  /** Leakage area of each floor's stair door, m². */
  doorLeakArea: number;
  /** Leakage area of the ground-floor exit door, m². */
  exitLeakArea: number;
  /** Any other leakage per floor (walls, services), m². */
  otherLeakArea: number;
  outdoorC: number;
  stairC: number;
  openDoorVelocity: number;
  /** The floor whose door is open in the open-door case (0 = ground). */
  fireFloor: number;
  /** Added to the airflow for ductwork leakage, %. */
  ductLeakPct: number;
  /** Ductwork, grilles and dampers — added to the stair pressure for the fan. */
  systemLossPa: number;
}

export type FloorStatus = "ok" | "over" | "under";

export interface PressFloor {
  level: number;
  name: string;
  heightM: number;
  dpPa: number;
  leakageM3s: number;
  doorForceN: number;
  status: FloorStatus;
}

export interface PressResult {
  rows: PressFloor[];
  /** Pressure change over the stair's height from stack effect, Pa (absolute). */
  stackPa: number;
  /** Outdoor warmer than the stair: pressure is highest at the bottom. */
  highestAtBottom: boolean;
  /** The highest pressure the door-force limit allows on this door. */
  maxPaForDoorForce: number;
  leakClosedM3s: number;
  openDoorM3s: number;
  /** Fire-floor door open + every other door's leakage. 0 when there is no open-door case. */
  openCaseM3s: number;
  governedBy: "doors-closed" | "door-open";
  fanM3s: number;
  fanCfm: number;
  fanPa: number;
  fanInwg: number;
  /** Free area of the relief vent that dumps the open-door air when the door closes, m². 0 if no open-door case. */
  reliefAreaM2: number;
  overFloors: string[];
  underFloors: string[];
}

export type PressOutcome = PressResult | { error: string };
export const isPressError = (r: PressOutcome | null): r is { error: string } => !!r && "error" in r;

export const levelName = (i: number) => (i === 0 ? "G" : `L${i}`);

export function maxPaForDoorForce(limitN: number, closerN: number, width: number, height: number): number {
  return ((limitN - closerN) * 2 * (width - KNOB_TO_EDGE_M)) / (width * width * height);
}

export function doorForce(dpPa: number, closerN: number, width: number, height: number): number {
  return closerN + (width * width * height * dpPa) / (2 * (width - KNOB_TO_EDGE_M));
}

export function solvePressurization(i: PressInput): PressOutcome {
  if (!Number.isInteger(i.floors) || i.floors < 1 || i.floors > 120) return { error: "Floors above ground: a whole number from 1 to 120." };
  if (!(i.floorHeight > 0)) return { error: "Enter the floor-to-floor height." };
  if (!(i.designPa > 0)) return { error: "Enter the design pressure." };
  if (!(i.doorWidth > KNOB_TO_EDGE_M) || !(i.doorHeight > 0)) return { error: "Enter the stair door's width and height." };
  if (!(i.doorLeakArea >= 0) || !(i.exitLeakArea >= 0) || !(i.otherLeakArea >= 0)) return { error: "Leakage areas can't be negative." };
  if (!(i.doorForceLimitN > i.closerForceN)) return { error: "The door-force limit must be more than the closer force." };
  if (!Number.isInteger(i.fireFloor) || i.fireFloor < 0 || i.fireFloor > i.floors) return { error: `Fire floor: G to L${i.floors}.` };
  const To = i.outdoorC + 273.15;
  const Ti = i.stairC + 273.15;
  if (!(To > 0) || !(Ti > 0)) return { error: "Check the temperatures." };

  const H = i.floors * i.floorHeight;
  const K = 3460 * (1 / To - 1 / Ti); // Pa per metre of height
  const doorArea = i.doorWidth * i.doorHeight;

  const rows: PressFloor[] = [];
  for (let level = 0; level <= i.floors; level++) {
    const h = level * i.floorHeight;
    // The weakest floor holds the design pressure; the rest sit above it.
    const dp = i.designPa + (K < 0 ? -K * (H - h) : K * h);
    const area = (level === 0 ? i.exitLeakArea : i.doorLeakArea) + i.otherLeakArea;
    const leak = 0.83 * area * Math.sqrt(dp);
    const force = doorForce(dp, i.closerForceN, i.doorWidth, i.doorHeight);
    const status: FloorStatus = force > i.doorForceLimitN ? "over" : dp < i.minPa ? "under" : "ok";
    rows.push({ level, name: levelName(level), heightM: r1(h), dpPa: r1(dp), leakageM3s: r3(leak), doorForceN: Math.round(force), status });
  }

  // Sums from the unrounded figures, so the totals don't drift with the floor count.
  const leaks = rows.map((r) => {
    const area = (r.level === 0 ? i.exitLeakArea : i.doorLeakArea) + i.otherLeakArea;
    const dp = i.designPa + (K < 0 ? -K * (H - r.level * i.floorHeight) : K * r.level * i.floorHeight);
    return 0.83 * area * Math.sqrt(dp);
  });
  const leakClosed = leaks.reduce((a, b) => a + b, 0);
  const openDoor = i.openDoorVelocity > 0 ? i.openDoorVelocity * doorArea : 0;
  const openCase = openDoor > 0 ? openDoor + leakClosed - leaks[i.fireFloor] : 0;
  const governing = Math.max(leakClosed, openCase);
  const fan = governing * (1 + Math.max(0, i.ductLeakPct) / 100);
  const topDp = i.designPa + (K < 0 ? 0 : K * H);
  const fanPa = topDp + Math.max(0, i.systemLossPa);
  const relief = openDoor > 0 ? (openCase - leakClosed) / (0.83 * Math.sqrt(i.designPa)) : 0;

  return {
    rows,
    stackPa: r1(Math.abs(K) * H),
    highestAtBottom: K < 0,
    maxPaForDoorForce: r1(maxPaForDoorForce(i.doorForceLimitN, i.closerForceN, i.doorWidth, i.doorHeight)),
    leakClosedM3s: r2(leakClosed),
    openDoorM3s: r2(openDoor),
    openCaseM3s: r2(openCase),
    governedBy: openCase > leakClosed ? "door-open" : "doors-closed",
    fanM3s: r2(fan),
    fanCfm: Math.round(fan * M3S_TO_CFM),
    fanPa: Math.round(fanPa),
    fanInwg: r2(fanPa / PA_PER_INWG),
    reliefAreaM2: r2(Math.max(0, relief)),
    overFloors: rows.filter((r) => r.status === "over").map((r) => r.name),
    underFloors: rows.filter((r) => r.status === "under").map((r) => r.name),
  };
}

/** The sample job the screen opens with: a 15-storey office stair on a Manila afternoon. */
export const PRESS_SAMPLE: PressInput = {
  floors: 15,
  floorHeight: 3.5,
  designPa: 50,
  minPa: 45,
  doorForceLimitN: 100,
  closerForceN: 40,
  doorWidth: 0.9,
  doorHeight: 2.1,
  doorLeakArea: 0.01,
  exitLeakArea: 0.02,
  otherLeakArea: 0,
  outdoorC: 32,
  stairC: 26,
  openDoorVelocity: 0.75,
  fireFloor: 8,
  ductLeakPct: 15,
  systemLossPa: 250,
};
