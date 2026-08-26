/**
 * Duct sizing ("ductulator") for round and rectangular galvanized duct at
 * standard air. Three modes:
 *   - Size from friction rate: airflow + Δp/100ft → round Ø, velocity
 *   - Size from velocity:      airflow + velocity → round Ø, friction
 *   - Pressure drop from size: airflow + round/rectangular dimensions → friction, velocity
 *
 * I-P relations (Q in cfm, d in inches, V in fpm, friction in in.wg/100 ft):
 *   V = 576·Q / (π·d²) = 183.346·Q / d²
 *   ΔP/100ft = 0.109136 · Q^1.9 / d^5.02        (ASHRAE galvanized-steel fit)
 *   De(rect) = 1.30 · (a·b)^0.625 / (a+b)^0.25   (Huebscher equivalent round Ø)
 * Rectangular velocity uses the actual cross-section (a·b); friction uses De.
 *
 * Pure maths, no React — the staff tool and the public HVAC Tools page on the
 * storefront both render this.
 */

export const CFM_PER_M3HR = 1 / 1.69901082; // m³/h -> cfm
export const CFM_PER_LPS = 2.11888; // L/s -> cfm
export const FPM_PER_MS = 196.850394; // m/s -> fpm
export const PA_PER_M_FROM_INWG100 = 249.0889 / 30.48; // (in.wg/100ft) -> Pa/m  ≈ 8.1722

const VK = 576 / Math.PI; // 183.346

export type AirflowUnit = "cfm" | "m3hr" | "lps";
export type VelocityUnit = "fpm" | "ms";
export type FrictionUnit = "inwg100" | "pam";
export type DuctDimUnit = "in" | "mm";
export type DuctMethod = "friction" | "velocity" | "dimensions";
export type DuctShape = "round" | "rect";

export const toCfm = (v: number, unit: AirflowUnit) =>
  unit === "m3hr" ? v * CFM_PER_M3HR : unit === "lps" ? v * CFM_PER_LPS : v;
export const toFpm = (v: number, unit: VelocityUnit) => (unit === "ms" ? v * FPM_PER_MS : v);
export const toInwg100 = (v: number, unit: FrictionUnit) => (unit === "pam" ? v / PA_PER_M_FROM_INWG100 : v);
export const toIn = (v: number, unit: DuctDimUnit) => (unit === "mm" ? v / 25.4 : v);

export const velFromDia = (qCfm: number, dIn: number) => (VK * qCfm) / (dIn * dIn);
export const fricFromDia = (qCfm: number, dIn: number) =>
  (0.109136 * Math.pow(qCfm, 1.9)) / Math.pow(dIn, 5.02);

/** Huebscher equivalent round diameter (in) for a rectangular duct a×b (in). */
export const equivDe = (a: number, b: number) => (1.3 * Math.pow(a * b, 0.625)) / Math.pow(a + b, 0.25);

/** Rectangular side b (in) whose equivalent round diameter matches De, given side a. */
export function rectOtherSide(deIn: number, aIn: number): number | null {
  if (!(deIn > 0) || !(aIn > 0)) return null;
  let lo = 0.5;
  let hi = 600;
  if (equivDe(aIn, hi) < deIn) return null; // can't reach this De at the given side
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (equivDe(aIn, mid) < deIn) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface DuctInput {
  airflow: number | null;
  airflowUnit: AirflowUnit;
  method: DuctMethod;
  friction: number | null;
  frictionUnit: FrictionUnit;
  velocity: number | null;
  velocityUnit: VelocityUnit;
  shape: DuctShape;
  dimUnit: DuctDimUnit;
  dia: number | null;
  sideA: number | null;
  sideB: number | null;
  /** One side (inches) for the rectangular-equivalent helper in the size modes. */
  rectSide: number | null;
}

export interface DuctSolution {
  /** Round — or, for a rectangular duct entered by size, equivalent-round — diameter. */
  dIn: number;
  dMm: number;
  isEquiv: boolean;
  vFpm: number;
  vMs: number;
  fInwg: number;
  fPam: number;
  qCfm: number;
  rectActual: { a: number; b: number } | null;
  rectA: number | null;
  rectB: number | null;
}

/** Solve the duct. `null` means "not enough entered yet". */
export function solveDuct(i: DuctInput): DuctSolution | null {
  if (i.airflow == null) return null;
  const qCfm = toCfm(i.airflow, i.airflowUnit);

  let dIn: number; // round (or equivalent-round) diameter — drives friction
  let vFpm: number; // actual velocity
  let rectActual: { a: number; b: number } | null = null;

  if (i.method === "velocity") {
    if (i.velocity == null) return null;
    vFpm = toFpm(i.velocity, i.velocityUnit);
    dIn = Math.sqrt((VK * qCfm) / vFpm);
  } else if (i.method === "friction") {
    if (i.friction == null) return null;
    const fInwg = toInwg100(i.friction, i.frictionUnit);
    dIn = Math.pow((0.109136 * Math.pow(qCfm, 1.9)) / fInwg, 1 / 5.02);
    vFpm = velFromDia(qCfm, dIn);
  } else if (i.shape === "round") {
    if (i.dia == null) return null;
    dIn = toIn(i.dia, i.dimUnit);
    vFpm = velFromDia(qCfm, dIn);
  } else {
    if (i.sideA == null || i.sideB == null) return null;
    const aIn = toIn(i.sideA, i.dimUnit);
    const bIn = toIn(i.sideB, i.dimUnit);
    dIn = equivDe(aIn, bIn);
    vFpm = (144 * qCfm) / (aIn * bIn); // actual cross-section velocity
    rectActual = { a: aIn, b: bIn };
  }
  if (!Number.isFinite(dIn) || dIn <= 0 || !Number.isFinite(vFpm)) return null;

  const fInwg = fricFromDia(qCfm, dIn);
  // Rectangular-equivalent helper (only meaningful in the size modes).
  const rectA = i.method !== "dimensions" ? i.rectSide : null;
  const rectB = rectA != null ? rectOtherSide(dIn, rectA) : null;

  return {
    dIn,
    dMm: dIn * 25.4,
    isEquiv: i.method === "dimensions" && i.shape === "rect",
    vFpm,
    vMs: vFpm / FPM_PER_MS,
    fInwg,
    fPam: fInwg * PA_PER_M_FROM_INWG100,
    qCfm,
    rectActual,
    rectA,
    rectB,
  };
}
