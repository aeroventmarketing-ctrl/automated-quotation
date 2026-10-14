/**
 * Smoke exhaust: how much smoke to pull out of a large space, and how.
 *
 * Two methods, as proposed to the owner:
 *
 *  - **Atrium / mall plume (NFPA 92, axisymmetric plume).** The design fire's
 *    plume drags in air as it rises; the exhaust must take that whole mass out
 *    to keep the smoke layer at the chosen height.
 *
 *      flame height        z_l = 0.166 · Qc^(2/5)                      m
 *      mass flow (z > z_l) m   = 0.071 · Qc^(1/3) · z^(5/3) + 0.0018 · Qc   kg/s
 *      mass flow (z ≤ z_l) m   = 0.032 · Qc^(3/5) · z
 *      layer temperature   ΔT  = Qc / (m · cp)       (all convective heat stays in the smoke)
 *      density             ρ   = 353 / T                                kg/m³, T in K
 *      plugholing limit    V   = 4.16 · γ · d^(5/2) · (ΔT / T_out)^(1/2) m³/s per exhaust point
 *
 *  - **Air changes** (car park, basement, plant room in smoke mode): volume ×
 *    ACH. The ACH is a code figure the user enters.
 *
 * Make-up air enters at outdoor temperature and the same mass flow, through
 * openings sized for a velocity limit (1.02 m/s in NFPA 92, so the plume isn't
 * disturbed).
 */
import { r1, r2 } from "./parse";
import { M3S_TO_CFM, PA_PER_INWG } from "./pressurization";

const CP = 1.0; // kJ/kg·K

/** EN 12101-3 smoke-fan temperature classes, °C. */
export const SMOKE_FAN_CLASSES = [200, 250, 300, 400, 600, 842] as const;

export interface PlumeInput {
  fireKw: number;
  /** Share of the fire's heat carried by the plume, %. 70 is the usual figure. */
  convectivePct: number;
  /** From the base of the fire to the bottom of the smoke layer, m. */
  clearHeightM: number;
  /** Smoke layer depth under the exhaust inlets, m — the `d` in the plugholing limit. */
  layerDepthM: number;
  outdoorC: number;
  exhaustPoints: number;
  /** Inlets close to a wall plug-hole sooner (γ = 0.5 instead of 1). */
  inletsNearWall: boolean;
  makeupVelocity: number;
  systemLossPa: number;
}

export interface PlumeResult {
  convectiveKw: number;
  flameHeightM: number;
  massFlowKgs: number;
  smokeC: number;
  densityKgm3: number;
  exhaustM3s: number;
  exhaustCfm: number;
  perPointM3s: number;
  perPointCfm: number;
  maxPerPointM3s: number;
  plugholing: boolean;
  /** The fewest exhaust points that avoid plugholing. */
  minPoints: number;
  makeupM3s: number;
  makeupAreaM2: number;
  /** Smallest EN 12101-3 class at or above the smoke temperature, or null if hotter than all. */
  fanClassC: number | null;
  fanPa: number;
  fanInwg: number;
}

export type PlumeOutcome = PlumeResult | { error: string };
export const isSmokeError = (r: unknown): r is { error: string } => !!r && typeof r === "object" && "error" in r;

export function solvePlume(i: PlumeInput): PlumeOutcome {
  if (!(i.fireKw > 0)) return { error: "Enter the design fire size." };
  if (!(i.convectivePct > 0 && i.convectivePct <= 100)) return { error: "Convective part: 1 to 100%." };
  if (!(i.clearHeightM > 0)) return { error: "Enter the height from the fire to the smoke layer." };
  if (!(i.layerDepthM > 0)) return { error: "Enter the smoke layer depth." };
  if (!Number.isInteger(i.exhaustPoints) || i.exhaustPoints < 1) return { error: "Exhaust points: a whole number, 1 or more." };
  if (!(i.makeupVelocity > 0)) return { error: "Enter the make-up air velocity limit." };
  const To = i.outdoorC + 273.15;
  if (!(To > 0)) return { error: "Check the outdoor temperature." };

  const Qc = (i.fireKw * i.convectivePct) / 100;
  const zl = 0.166 * Math.pow(Qc, 0.4);
  const z = i.clearHeightM;
  const m = z > zl ? 0.071 * Math.cbrt(Qc) * Math.pow(z, 5 / 3) + 0.0018 * Qc : 0.032 * Math.pow(Qc, 0.6) * z;
  const dT = Qc / (m * CP);
  const Ts = To + dT;
  const rho = 353 / Ts;
  const V = m / rho;
  const perPoint = V / i.exhaustPoints;
  const gamma = i.inletsNearWall ? 0.5 : 1;
  const vmax = 4.16 * gamma * Math.pow(i.layerDepthM, 2.5) * Math.sqrt(dT / To);
  const makeup = m / (353 / To);
  const smokeC = Ts - 273.15;
  const fanPa = Math.max(0, i.systemLossPa);
  return {
    convectiveKw: Math.round(Qc),
    flameHeightM: r2(zl),
    massFlowKgs: r1(m),
    smokeC: Math.round(smokeC),
    densityKgm3: r2(rho),
    exhaustM3s: r1(V),
    exhaustCfm: Math.round(V * M3S_TO_CFM),
    perPointM3s: r1(perPoint),
    perPointCfm: Math.round(perPoint * M3S_TO_CFM),
    maxPerPointM3s: r1(vmax),
    plugholing: perPoint > vmax,
    minPoints: Math.max(1, Math.ceil(V / vmax)),
    makeupM3s: r1(makeup),
    makeupAreaM2: r1(makeup / i.makeupVelocity),
    fanClassC: SMOKE_FAN_CLASSES.find((c) => c >= smokeC) ?? null,
    fanPa: Math.round(fanPa),
    fanInwg: r2(fanPa / PA_PER_INWG),
  };
}

export interface AchInput {
  lengthM: number;
  widthM: number;
  heightM: number;
  ach: number;
  fans: number;
  systemLossPa: number;
}

export interface AchResult {
  volumeM3: number;
  exhaustM3s: number;
  exhaustCfm: number;
  perFanCfm: number;
  fanPa: number;
  fanInwg: number;
}

export type AchOutcome = AchResult | { error: string };

export function solveAch(i: AchInput): AchOutcome {
  if (!(i.lengthM > 0 && i.widthM > 0 && i.heightM > 0)) return { error: "Enter the length, width and height." };
  if (!(i.ach > 0)) return { error: "Enter the air changes per hour." };
  if (!Number.isInteger(i.fans) || i.fans < 1) return { error: "Fans: a whole number, 1 or more." };
  const vol = i.lengthM * i.widthM * i.heightM;
  const q = (vol * i.ach) / 3600;
  const fanPa = Math.max(0, i.systemLossPa);
  return {
    volumeM3: Math.round(vol),
    exhaustM3s: r1(q),
    exhaustCfm: Math.round(q * M3S_TO_CFM),
    perFanCfm: Math.round((q * M3S_TO_CFM) / i.fans),
    fanPa: Math.round(fanPa),
    fanInwg: r2(fanPa / PA_PER_INWG),
  };
}

/** The mall atrium from the proposal: 5 MW sprinklered retail fire, smoke layer 6 m above it. */
export const PLUME_SAMPLE: PlumeInput = {
  fireKw: 5000,
  convectivePct: 70,
  clearHeightM: 6,
  layerDepthM: 3,
  outdoorC: 33,
  exhaustPoints: 4,
  inletsNearWall: false,
  makeupVelocity: 1.02,
  systemLossPa: 400,
};

export const ACH_SAMPLE: AchInput = { lengthM: 60, widthM: 40, heightM: 3, ach: 10, fans: 2, systemLossPa: 300 };
