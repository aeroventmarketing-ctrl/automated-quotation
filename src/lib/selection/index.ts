/**
 * Fan selection / sizing engine (engineer-in-the-loop).
 *
 * Given a duty point (airflow m³/hr + static pressure Pa, optional temperature),
 * select fan models from their rating curves using interpolation + fan laws:
 *   Q ∝ N      (airflow scales with speed)
 *   P ∝ N²     (pressure scales with speed²)
 *   kW ∝ N³    (power scales with speed³)
 *
 * The engine PROPOSES; an engineer CONFIRMS. It never silently picks a fan
 * outside its rated envelope — such cases are flagged LOW confidence with
 * `requiresEngineerConfirmation = true`.
 *
 * Self-contained: real rating data can be loaded later without touching the UI.
 */

import { kwToHp, hpToKw } from "../units";

// Standard air at 20°C, sea level.
export const STANDARD_AIR_DENSITY = 1.2; // kg/m³

// 1 ft³/min = 1.6990108 m³/h.
const CFM_PER_M3HR = 1 / 1.6990108;
// 1 in. w.g. = 249.0889 Pa.
const PA_PER_INWG = 249.0889;

// AFBM induction-motor sizes (HP). The suggested motor is BHP/0.75 rounded UP
// to the next size in this list.
export const MOTOR_HP_LIST = [
  0.5, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100,
];

/** Suggested motor HP = BHP / 0.75, rounded UP to the next size in the list. */
export function suggestMotorHp(bhp: number): number {
  const target = bhp / 0.75;
  for (const hp of MOTOR_HP_LIST) if (hp >= target - 1e-9) return hp;
  return Math.ceil(target);
}

/** Smallest standard motor HP at or above the target HP. */
export function motorAtLeastHp(targetHp: number): number {
  for (const hp of MOTOR_HP_LIST) if (hp >= targetHp - 1e-9) return hp;
  return Math.ceil(targetHp);
}

/** AFBM outlet-velocity limit (fpm) by wheel diameter (inches). */
export function outletVelocityLimit(wheelDia_in: number | null): number {
  if (wheelDia_in == null) return 1800;
  if (wheelDia_in <= 27) return 1800;
  if (wheelDia_in <= 36.5) return 2000;
  return 3000;
}

/**
 * Forward-curve (CFAB) outlet-velocity limit (fpm). Flat 2000 fpm, except the
 * two largest sizes (26"/30¼" wheels ≈ 27"/30") run at 2400 fpm.
 */
export function forwardCurveOvLimit(wheelDia_in: number | null): number {
  return wheelDia_in != null && wheelDia_in >= 25.5 ? 2400 : 2000;
}

/**
 * DIDWCFAB (forward-curve, double-width) outlet-velocity limit (fpm): a good
 * selection runs under 2200 fpm up to the 27" wheel, and under 2400 fpm for the
 * 30"–36.5" wheels.
 */
export function didwCfabOvLimit(wheelDia_in: number | null): number {
  return wheelDia_in != null && wheelDia_in >= 30 ? 2400 : 2200;
}

/**
 * Direct-drive (CEBDD) speed bands. A direct-drive fan turns at the motor speed;
 * selection meets the static pressure at a band's nominal speed (4-pole first,
 * then 2-pole) and raises the delivered flow as needed. Outlet velocity is
 * disregarded for CEBDD.
 */
export const DIRECT_DRIVE_BANDS = [
  { pole: 4, minRpm: 1662, maxRpm: 1842 },
  { pole: 2, minRpm: 3325, maxRpm: 3684 },
] as const;

// Standard induction-motor sizes (kW) used for motor sizing after service factor.
export const STANDARD_MOTOR_KW = [
  0.18, 0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3.0, 3.7, 4.0, 5.5, 7.5, 9.3,
  11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250,
];

export interface RatingPoint {
  rpm: number;
  airflow_m3hr: number;
  staticPressure_pa: number;
  power_kw: number;
  efficiency?: number | null;
}

export interface FanModelInput {
  id: string;
  modelCode: string;
  name: string;
  sizeLabel?: string | null;
  specs?: Record<string, unknown> | null;
  ratingPoints: RatingPoint[];
}

export interface DutyPoint {
  airflow_m3hr: number;
  staticPressure_pa: number;
  /** Optional gas temperature in °C (default 20). Used for density correction. */
  temperatureC?: number;
  /** Optional explicit density (kg/m³); overrides temperature-based estimate. */
  density_kgm3?: number;
}

export interface SelectionOptions {
  /** Motor service factor applied to absorbed power before sizing (default 1.15). */
  serviceFactor?: number;
  /** Max allowable speed ratio vs reference before flagging out-of-envelope (default 1.15). */
  maxSpeedRatio?: number;
  /** Min allowable speed ratio vs reference before flagging out-of-envelope (default 0.5). */
  minSpeedRatio?: number;
  /**
   * Direct-drive (CEBDD) selection: the fan runs at the motor speed, so the
   * operating speed must land in a 2- or 4-pole band (with that band's outlet-
   * velocity limit). Off-band sizes are excluded from the results.
   */
  directDrive?: boolean;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface SelectionResult {
  modelId: string;
  modelCode: string;
  name: string;
  sizeLabel?: string | null;
  /** Propeller blade angle (degrees), if the model specifies one. */
  bladeAngle: number | null;
  rpm: number;
  referenceRpm: number;
  speedRatio: number;
  dutyAirflow_m3hr: number;
  /** Direct-drive delivered flow (m³/hr) at the required SP; may exceed the requested flow. Null for belt. */
  selectedAirflow_m3hr: number | null;
  dutyStaticPressure_pa: number;
  /** Static pressure used internally for selection (density-corrected to standard air). */
  selectionStaticPressure_pa: number;
  power_kw: number; // absorbed power at duty (density-corrected)
  bhp: number; // absorbed power in HP
  motorKw: number; // sized standard motor
  motorHp: number; // suggested motor (BHP/0.75 rounded up to the motor list)
  motorPole: number | null; // motor pole from the direct-drive band (null for belt drive)
  efficiency: number | null;
  serviceFactor: number;
  // Outlet-velocity check (AFBM "good selection" rule).
  outletVelocity_fpm: number | null;
  ovLimit_fpm: number | null;
  ovWithinLimit: boolean | null; // null = no outlet-area data
  // Speed check against the fan's maximum rated RPM.
  maxRpm: number | null;
  rpmWithinMax: boolean;
  withinEnvelope: boolean;
  confidence: Confidence;
  requiresEngineerConfirmation: boolean;
  selectionNote: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Estimate air density from temperature (ideal-gas, sea level). */
export function densityFromTemperature(temperatureC: number): number {
  const tK = 273.15 + temperatureC;
  return STANDARD_AIR_DENSITY * (293.15 / tK);
}

/**
 * Normalize a model's rating points (possibly at several RPMs) onto a single
 * reference-speed curve using fan laws, then return points sorted by airflow.
 */
function buildReferenceCurve(points: RatingPoint[]): {
  referenceRpm: number;
  curve: RatingPoint[];
} | null {
  const valid = points.filter(
    (p) => p.rpm > 0 && p.airflow_m3hr >= 0 && p.staticPressure_pa >= 0,
  );
  if (valid.length < 2) return null;

  // Reference speed = highest rated RPM present.
  const referenceRpm = Math.max(...valid.map((p) => p.rpm));

  const normalized = valid.map((p) => {
    const r = referenceRpm / p.rpm;
    return {
      rpm: referenceRpm,
      airflow_m3hr: p.airflow_m3hr * r,
      staticPressure_pa: p.staticPressure_pa * r * r,
      power_kw: p.power_kw * r * r * r,
      efficiency: p.efficiency ?? null,
    };
  });

  normalized.sort((a, b) => a.airflow_m3hr - b.airflow_m3hr);
  return { referenceRpm, curve: normalized };
}

/** Linear interpolation of a field along the curve at a given airflow. */
function interpAtAirflow(
  curve: RatingPoint[],
  q: number,
  field: "power_kw" | "efficiency",
): number | null {
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (q >= a.airflow_m3hr && q <= b.airflow_m3hr) {
      const t =
        b.airflow_m3hr === a.airflow_m3hr
          ? 0
          : (q - a.airflow_m3hr) / (b.airflow_m3hr - a.airflow_m3hr);
      const av = field === "power_kw" ? a.power_kw : a.efficiency;
      const bv = field === "power_kw" ? b.power_kw : b.efficiency;
      if (av == null || bv == null) return av ?? bv ?? null;
      return av + (bv - av) * t;
    }
  }
  return null;
}

/**
 * Find where the fan-law parabola P = k·Q² (k = Pt/Qt²) crosses the reference
 * curve. Returns the reference-curve airflow Q_ref at the crossing, or null.
 */
function findCurveIntersection(curve: RatingPoint[], k: number): number | null {
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    const qa = a.airflow_m3hr;
    const qb = b.airflow_m3hr;
    if (qb === qa) continue;

    // Curve segment (linear): P(Q) = c0 + m·Q
    const m = (b.staticPressure_pa - a.staticPressure_pa) / (qb - qa);
    const c0 = a.staticPressure_pa - m * qa;

    // Solve k·Q² - m·Q - c0 = 0
    if (Math.abs(k) < 1e-12) continue;
    const disc = m * m + 4 * k * c0;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    const roots = [(m + sq) / (2 * k), (m - sq) / (2 * k)];
    for (const q of roots) {
      if (q >= qa - 1e-6 && q <= qb + 1e-6 && q > 0) return q;
    }
  }
  return null;
}

const KW_PER_HP = 0.745699872;

interface GridResult {
  rpm: number;
  bhp: number; // absorbed power in HP, at standard density
  withinEnvelope: boolean;
  /** Airflow (m³/hr) actually used — equals q unless lifted to the size's minimum. */
  deliveredQ: number;
  /** True when the requested flow was below the size's minimum and lifted up. */
  lifted: boolean;
}

/**
 * Interpolate the operating point on a full CFM×SP rating grid (each cell gives
 * the RPM and BHP for that airflow + static pressure). Returns null when the
 * data is a single fan curve rather than a grid (≥2 distinct SP levels each
 * with ≥2 airflow points) — callers then fall back to the fan-law method.
 *
 * When `liftToMinFlow` is set (axial fans, where static pressure is the priority
 * and a higher delivered flow is acceptable), a requested flow below the size's
 * lowest tabulated flow at the duty SP is lifted up to that minimum rather than
 * refused — the caller then steps up to a larger size if this size's minimum
 * still needs an over-ceiling rpm.
 */
function interpolateGrid(
  points: RatingPoint[],
  q: number,
  p: number,
  liftToMinFlow = false,
): GridResult | null {
  const bySp = new Map<number, { q: number; rpm: number; bhp: number }[]>();
  for (const pt of points) {
    if (pt.rpm <= 0) continue;
    const arr = bySp.get(pt.staticPressure_pa) ?? [];
    arr.push({ q: pt.airflow_m3hr, rpm: pt.rpm, bhp: pt.power_kw / KW_PER_HP });
    bySp.set(pt.staticPressure_pa, arr);
  }
  const spLevels = [...bySp.keys()]
    .filter((sp) => (bySp.get(sp)?.length ?? 0) >= 2)
    .sort((a, b) => a - b);
  if (spLevels.length < 2) return null; // single curve, not a grid
  for (const sp of spLevels) bySp.get(sp)!.sort((a, b) => a.q - b.q);

  const atQ = (series: { q: number; rpm: number; bhp: number }[], qq: number) => {
    const first = series[0];
    const last = series[series.length - 1];
    if (qq <= first.q) return { rpm: first.rpm, bhp: first.bhp, inRange: qq >= first.q - 1 };
    if (qq >= last.q) return { rpm: last.rpm, bhp: last.bhp, inRange: qq <= last.q + 1 };
    for (let i = 0; i < series.length - 1; i++) {
      const a = series[i];
      const b = series[i + 1];
      if (qq >= a.q && qq <= b.q) {
        const t = (qq - a.q) / (b.q - a.q);
        return { rpm: a.rpm + (b.rpm - a.rpm) * t, bhp: a.bhp + (b.bhp - a.bhp) * t, inRange: true };
      }
    }
    return { rpm: last.rpm, bhp: last.bhp, inRange: false };
  };

  const minSp = spLevels[0];
  const maxSp = spLevels[spLevels.length - 1];
  // A fan can always develop LESS than its lowest printed pressure, so a duty
  // below the minimum SP column is allowed and selected at that lowest column.
  // Only the high-pressure edge counts as outside the published data.
  const pAboveMax = p > maxSp + 1;
  let lo = minSp;
  let hi = maxSp;
  if (p <= minSp) lo = hi = minSp;
  else if (p >= maxSp) lo = hi = maxSp;
  else
    for (let i = 0; i < spLevels.length - 1; i++) {
      if (p >= spLevels[i] && p <= spLevels[i + 1]) {
        lo = spLevels[i];
        hi = spLevels[i + 1];
        break;
      }
    }

  const loS = bySp.get(lo)!;
  const hiS = bySp.get(hi)!;
  const t = lo === hi ? 0 : (p - lo) / (hi - lo);

  // Envelope = the airflow range interpolated between the two pressure levels
  // (the rating grid is triangular, so each SP level has its own CFM span).
  const minQ = loS[0].q + (hiS[0].q - loS[0].q) * t;
  const maxQ = loS[loS.length - 1].q + (hiS[hiS.length - 1].q - loS[loS.length - 1].q) * t;

  // Static-pressure-priority lift: deliver the size's minimum flow when the
  // request is below it (axial). Otherwise operate at the requested flow.
  const lifted = liftToMinFlow && q < minQ;
  const qEff = lifted ? minQ : q;

  const aLo = atQ(loS, qEff);
  const aHi = atQ(hiS, qEff);
  const rpm = aLo.rpm + (aHi.rpm - aLo.rpm) * t;
  const bhp = aLo.bhp + (aHi.bhp - aLo.bhp) * t;

  const qInRange = qEff >= minQ - 1 && qEff <= maxQ + 1;

  return { rpm: Math.round(rpm), bhp, withinEnvelope: !pAboveMax && qInRange, deliveredQ: qEff, lifted };
}

// ---------------------------------------------------------------------------
// Core selection
// ---------------------------------------------------------------------------

/**
 * Reference-curve airflow where static pressure == target. The curve is sorted
 * by airflow ascending (pressure descending). Returns null if the target
 * pressure exceeds the curve's shutoff pressure (cannot be developed here).
 */
function airflowAtPressure(curve: RatingPoint[], targetSp: number): number | null {
  if (targetSp > curve[0].staticPressure_pa) return null;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (targetSp <= a.staticPressure_pa && targetSp >= b.staticPressure_pa) {
      const span = a.staticPressure_pa - b.staticPressure_pa;
      const t = span === 0 ? 0 : (a.staticPressure_pa - targetSp) / span;
      return a.airflow_m3hr + (b.airflow_m3hr - a.airflow_m3hr) * t;
    }
  }
  return curve[curve.length - 1].airflow_m3hr; // below curve's min SP -> max rated flow
}

interface DirectDriveResult {
  rpm: number;
  pole: number;
  deliveredFlow_m3hr: number;
  powerStd_kw: number; // absorbed power (kW) at standard density
  efficiency: number | null;
  withinEnvelope: boolean;
  meetsFlow: boolean; // true if the delivered flow is at or above the requested flow
}

/**
 * Operating point on a CFM×SP rating grid at a FIXED speed: at the given rpm,
 * find the airflow the fan delivers at the required static pressure (and the
 * absorbed power). Each SP level is a series where airflow rises with rpm, so we
 * invert rpm→airflow per level, then interpolate across the two SP levels.
 * Returns null when the data is a single curve rather than a grid.
 */
function gridOperatingPoint(
  points: RatingPoint[],
  targetRpm: number,
  targetSp: number,
): { q: number; power_kw: number; inRange: boolean } | null {
  const bySp = new Map<number, { q: number; rpm: number; kw: number }[]>();
  for (const pt of points) {
    if (pt.rpm <= 0) continue;
    const arr = bySp.get(pt.staticPressure_pa) ?? [];
    arr.push({ q: pt.airflow_m3hr, rpm: pt.rpm, kw: pt.power_kw });
    bySp.set(pt.staticPressure_pa, arr);
  }
  const levels = [...bySp.keys()]
    .filter((sp) => (bySp.get(sp)?.length ?? 0) >= 2)
    .sort((a, b) => a - b);
  if (levels.length < 2) return null; // single curve, not a grid
  for (const sp of levels) bySp.get(sp)!.sort((a, b) => a.rpm - b.rpm);

  const atRpm = (series: { q: number; rpm: number; kw: number }[], rpm: number) => {
    const first = series[0];
    const last = series[series.length - 1];
    if (rpm <= first.rpm) return { q: first.q, kw: first.kw, inRange: rpm >= first.rpm - 1 };
    if (rpm >= last.rpm) return { q: last.q, kw: last.kw, inRange: rpm <= last.rpm + 1 };
    for (let i = 0; i < series.length - 1; i++) {
      const a = series[i];
      const b = series[i + 1];
      if (rpm >= a.rpm && rpm <= b.rpm) {
        const t = (rpm - a.rpm) / (b.rpm - a.rpm);
        return { q: a.q + (b.q - a.q) * t, kw: a.kw + (b.kw - a.kw) * t, inRange: true };
      }
    }
    return { q: last.q, kw: last.kw, inRange: false };
  };

  const minSp = levels[0];
  const maxSp = levels[levels.length - 1];
  const spInRange = targetSp >= minSp - 1 && targetSp <= maxSp + 1;
  let lo = minSp;
  let hi = maxSp;
  if (targetSp <= minSp) lo = hi = minSp;
  else if (targetSp >= maxSp) lo = hi = maxSp;
  else
    for (let i = 0; i < levels.length - 1; i++) {
      if (targetSp >= levels[i] && targetSp <= levels[i + 1]) {
        lo = levels[i];
        hi = levels[i + 1];
        break;
      }
    }

  const aLo = atRpm(bySp.get(lo)!, targetRpm);
  const aHi = atRpm(bySp.get(hi)!, targetRpm);
  const t = lo === hi ? 0 : (targetSp - lo) / (hi - lo);
  return {
    q: aLo.q + (aHi.q - aLo.q) * t,
    power_kw: aLo.kw + (aHi.kw - aLo.kw) * t,
    inRange: spInRange && aLo.inRange && aHi.inRange,
  };
}

/** Operating point for one direct-drive band, or null if the SP can't be developed there. */
function directDriveBand(
  band: { pole: number; minRpm: number; maxRpm: number },
  points: RatingPoint[],
  curve: RatingPoint[],
  referenceRpm: number,
  selectionPressure: number,
): Omit<DirectDriveResult, "meetsFlow"> | null {
  const rpm = Math.round((band.minRpm + band.maxRpm) / 2);
  const op = gridOperatingPoint(points, rpm, selectionPressure);
  if (op) {
    return {
      rpm,
      pole: band.pole,
      deliveredFlow_m3hr: op.q,
      powerStd_kw: op.power_kw,
      efficiency: null,
      withinEnvelope: op.inRange,
    };
  }
  // Fallback: single rated curve scaled by fan laws.
  const ratio = rpm / referenceRpm;
  const refSp = selectionPressure / (ratio * ratio);
  const qRef = airflowAtPressure(curve, refSp);
  if (qRef == null) return null; // can't develop this SP at this speed
  const refPower =
    interpAtAirflow(curve, qRef, "power_kw") ?? curve[curve.length - 1].power_kw;
  const within =
    refSp <= curve[0].staticPressure_pa &&
    refSp >= curve[curve.length - 1].staticPressure_pa &&
    qRef <= curve[curve.length - 1].airflow_m3hr + 1;
  return {
    rpm,
    pole: band.pole,
    deliveredFlow_m3hr: qRef * ratio,
    powerStd_kw: refPower * Math.pow(ratio, 3),
    efficiency: interpAtAirflow(curve, qRef, "efficiency"),
    withinEnvelope: within,
  };
}

/**
 * Direct-drive (CEBDD) operating point. Prioritise static pressure and motor
 * pole: try the 4-pole band first, then 2-pole; at the band's nominal speed find
 * the flow that develops the required SP, accepting a delivered flow at or above
 * the requested flow ("increase volume flow when needed"). Outlet velocity is
 * disregarded. Returns the first band that meets the requested flow; if none
 * does, returns the best-effort (highest-flow) band flagged meetsFlow=false, so
 * undersized neighbours are still shown next to the recommended pick.
 */
function selectDirectDrive(
  points: RatingPoint[],
  curve: RatingPoint[],
  referenceRpm: number,
  selectionPressure: number,
  requestedFlow_m3hr: number,
  bands: readonly { pole: number; minRpm: number; maxRpm: number }[] = DIRECT_DRIVE_BANDS,
): DirectDriveResult | null {
  let best: Omit<DirectDriveResult, "meetsFlow"> | null = null;
  for (const band of bands) {
    const r = directDriveBand(band, points, curve, referenceRpm, selectionPressure);
    if (!r) continue;
    if (r.deliveredFlow_m3hr >= requestedFlow_m3hr - 1) return { ...r, meetsFlow: true };
    if (!best || r.deliveredFlow_m3hr > best.deliveredFlow_m3hr) best = r;
  }
  return best ? { ...best, meetsFlow: false } : null;
}

/** Nominal induction-motor speeds (rpm) by pole count (60 Hz, loaded). */
const POLE_RPM: ReadonlyArray<readonly [number, number]> = [
  [2, 3600],
  [4, 1750],
  [6, 1200],
  [8, 800],
];
/** Motor pole count whose nominal speed is closest to a rated rpm. */
function polesForRpm(rpm: number): number {
  let best = POLE_RPM[0];
  for (const e of POLE_RPM) if (Math.abs(e[1] - rpm) < Math.abs(best[1] - rpm)) best = e;
  return best[0];
}

/**
 * Direct-drive "bands" for a natively-direct catalogue (propeller EWFDD): the
 * fan turns at its own rated motor speed(s), not the centrifugal 2-/4-pole
 * bands. Each distinct rated rpm becomes a fixed band. Ordered by ascending pole
 * count (descending rpm) so selection prefers the lower-pole motor — EWFDD runs
 * 4-pole or higher-pole, never 2-pole, and higher-pole motors are harder to find.
 */
function fixedSpeedBands(
  points: RatingPoint[],
): { pole: number; minRpm: number; maxRpm: number }[] {
  const rpms = [...new Set(points.filter((p) => p.rpm > 0).map((p) => p.rpm))].sort(
    (a, b) => b - a,
  );
  return rpms.map((r) => ({ pole: polesForRpm(r), minRpm: r, maxRpm: r }));
}

/** Interpolate a propeller row's CFM at a static pressure (in. w.g.). The curve
 *  is [sp_in, cfm] ascending by SP (CFM falls as SP rises). Returns null when the
 *  SP is above the row's highest tabulated point — the fan can't develop it. */
function interpCfmAtSp(curve: Array<[number, number]>, sp_in: number): number | null {
  if (!curve.length) return null;
  if (sp_in <= curve[0][0]) return curve[0][1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [s0, c0] = curve[i];
    const [s1, c1] = curve[i + 1];
    if (sp_in >= s0 && sp_in <= s1) {
      const t = s1 === s0 ? 0 : (sp_in - s0) / (s1 - s0);
      return c0 + t * (c1 - c0);
    }
  }
  return null; // beyond the highest tabulated SP
}

/**
 * Catalogue-row selection for propeller fans (EWF/EWFDD/PRV/PRVDD). These
 * catalogues are discrete tables — each row is a blade angle + motor HP + fan
 * RPM with a CFM-per-static-pressure curve and a MAX BHP. We pick an actual
 * printed row (no fan-law speed scaling), in this priority:
 *   1. volume flow + 2. static pressure — the row's CFM at the client's SP must
 *      meet the requested flow;
 *   3. fan RPM within the drive ceiling (belt ≤1200, direct ≤1750);
 *   4. outlet velocity ≤ 2200 fpm is the recommended ("good") range;
 *   5. blade angle 40° or below — of the ≤40° rows that meet the duty, the one
 *      with the SMALLEST motor (the most economical fan that still meets the
 *      flow), shown at its actual printed angle (never relabelled).
 */
function selectPropellerRow(model: FanModelInput, duty: DutyPoint): SelectionResult | null {
  const rowsSpec = model.specs?.rows;
  if (!Array.isArray(rowsSpec) || rowsSpec.length === 0) return null;
  const numv = (v: unknown): number | null =>
    typeof v === "number" && !Number.isNaN(v) ? v : null;

  const direct = String(model.specs?.drive ?? "") === "direct";
  const rpmCeiling = direct ? 1750 : 1200;
  const sp_in = duty.staticPressure_pa / PA_PER_INWG;
  const flow_cfm = duty.airflow_m3hr * CFM_PER_M3HR;
  const warnings: string[] = [];

  interface Cand {
    angle: number;
    hp: number;
    rpm: number;
    bhp: number;
    cfm: number;
  }
  const cands: Cand[] = [];
  for (const raw of rowsSpec as Array<Record<string, unknown>>) {
    const angle = numv(raw.a);
    const rpm = numv(raw.rpm);
    const hp = numv(raw.hp);
    const bhp = numv(raw.bhp);
    if (angle == null || rpm == null || hp == null || bhp == null) continue;
    if (angle > 40 || rpm > rpmCeiling) continue;
    if (!Array.isArray(raw.c)) continue;
    const curve = (raw.c as Array<[number, number]>)
      .filter((e) => Array.isArray(e) && e.length === 2)
      .map((e) => [Number(e[0]), Number(e[1])] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const cfmAtSp = interpCfmAtSp(curve, sp_in);
    if (cfmAtSp == null) continue; // can't develop this static pressure
    cands.push({ angle, hp, rpm, bhp, cfm: cfmAtSp });
  }
  if (cands.length === 0) return null;

  // Catalogue CFM are whole numbers and the duty CFM arrives via unit conversion
  // (cfm→m³/hr→cfm), which drifts by a tiny fraction. Compare with a 1 cfm
  // tolerance so a duty that lands exactly on a printed cell (e.g. 33668) still
  // counts as met — otherwise sub-cfm rounding excludes that row and bumps the
  // selection to the next motor size.
  const meeting = cands.filter((c) => c.cfm >= flow_cfm - 1);
  // No ≤40° row can deliver the requested flow at this static pressure — the
  // size cannot satisfy the duty, so it is excluded from the selection entirely
  // (a size that can't provide the requested volume flow is never shown).
  if (meeting.length === 0) return null;
  // Smallest motor first (the most economical fan that still meets the duty);
  // then the least-oversized printed row → smallest adequate CFM → lowest rpm.
  // The blade angle is whatever that row prints (e.g. a 30°/5 HP row is taken
  // over a 40°/7.5 HP row that also meets the flow).
  meeting.sort((a, b) => a.hp - b.hp || a.cfm - b.cfm || a.rpm - b.rpm);
  const chosen: Cand = meeting[0];

  // Outlet velocity from the REQUIRED flow through the opening (blade Ø + 1").
  const outletArea = numv(model.specs?.outletArea_ft2);
  let outletVelocity_fpm: number | null = null;
  let ovLimit_fpm: number | null = null;
  let ovWithinLimit: boolean | null = null;
  if (outletArea && outletArea > 0) {
    outletVelocity_fpm = Math.round(flow_cfm / outletArea);
    ovLimit_fpm = 2200;
    ovWithinLimit = outletVelocity_fpm <= ovLimit_fpm;
    if (!ovWithinLimit) {
      warnings.push(
        `Outlet velocity ${outletVelocity_fpm} fpm exceeds the recommended ${ovLimit_fpm} fpm — consider a larger size.`,
      );
    }
  }

  const motorHp = chosen.hp;
  const bhp = chosen.bhp;
  const motorKw = Math.round(hpToKw(motorHp) * 100) / 100;
  const motorPole = direct ? polesForRpm(chosen.rpm) : null;
  const selectedAirflow_m3hr = Math.round((chosen.cfm / CFM_PER_M3HR) * 100) / 100;
  const power_kw = Math.round(bhp * KW_PER_HP * 1000) / 1000;

  const confidence: Confidence = ovWithinLimit !== false ? "HIGH" : "LOW";
  const ovStr =
    outletVelocity_fpm != null ? ` OV ${outletVelocity_fpm} fpm (limit ${ovLimit_fpm}).` : "";
  const note =
    `${model.modelCode} ${chosen.angle}° blade at ${chosen.rpm} rpm — ` +
    `delivers ${Math.round(chosen.cfm)} cfm @ ${sp_in.toFixed(2)} in.w.g. ` +
    `MAX ${bhp.toFixed(2)} BHP → motor ${motorHp} HP (catalog).${ovStr} Confidence: ${confidence}.`;

  return {
    modelId: model.id,
    modelCode: model.modelCode,
    name: model.name,
    sizeLabel: model.sizeLabel ?? null,
    bladeAngle: chosen.angle,
    rpm: chosen.rpm,
    referenceRpm: chosen.rpm,
    speedRatio: 1,
    dutyAirflow_m3hr: duty.airflow_m3hr,
    selectedAirflow_m3hr,
    dutyStaticPressure_pa: duty.staticPressure_pa,
    selectionStaticPressure_pa: duty.staticPressure_pa,
    power_kw,
    bhp: Math.round(bhp * 100) / 100,
    motorKw,
    motorHp,
    motorPole,
    efficiency: null,
    serviceFactor: 1.15,
    outletVelocity_fpm,
    ovLimit_fpm,
    ovWithinLimit,
    maxRpm: rpmCeiling,
    rpmWithinMax: true,
    withinEnvelope: true,
    confidence,
    requiresEngineerConfirmation: confidence === "LOW" || ovWithinLimit === false,
    selectionNote: note,
    warnings,
  };
}

export function selectFan(
  model: FanModelInput,
  duty: DutyPoint,
  options: SelectionOptions = {},
): SelectionResult | null {
  // Propeller fans (EWF/EWFDD/PRV/PRVDD) select an actual catalogue row rather
  // than fan-law scaling a single design curve.
  if (model.specs?.propeller === true && Array.isArray(model.specs?.rows)) {
    return selectPropellerRow(model, duty);
  }
  const serviceFactor = options.serviceFactor ?? 1.15;
  const maxSpeedRatio = options.maxSpeedRatio ?? 1.15;
  const minSpeedRatio = options.minSpeedRatio ?? 0.5;

  const built = buildReferenceCurve(model.ratingPoints);
  if (!built) return null;
  const { referenceRpm, curve } = built;

  const warnings: string[] = [];

  // --- Density correction -------------------------------------------------
  const density =
    duty.density_kgm3 ??
    (duty.temperatureC != null
      ? densityFromTemperature(duty.temperatureC)
      : STANDARD_AIR_DENSITY);

  // Fan curves are at standard density. The pressure the fan must develop at
  // standard density to satisfy the actual duty:
  const selectionPressure =
    duty.staticPressure_pa * (STANDARD_AIR_DENSITY / density);
  if (Math.abs(density - STANDARD_AIR_DENSITY) > 0.01) {
    warnings.push(
      `Density-corrected for ${duty.temperatureC ?? "?"}°C air (ρ=${density.toFixed(3)} kg/m³).`,
    );
  }

  if (duty.airflow_m3hr <= 0 || selectionPressure < 0) return null;

  // Axial fans (TAF/VAF) prioritise static pressure and accept a higher
  // delivered flow, run below a design speed ceiling (e.g. 2000 rpm), and have
  // per-product SP caps — flagged here so the belt grid path can lift the flow
  // and the rpm/SP guards can step the selection up to a larger size.
  const isAxial = String(model.specs?.category ?? "") === "Axial Type";

  // Static-pressure application cap (axial TAF 1.5"/VAF 4" w.g.): a duty whose
  // SP exceeds the product's rated ceiling drops it from the results entirely
  // (e.g. a 2" duty excludes TAF, leaving VAF), rather than extrapolating.
  const maxSpRaw = model.specs?.maxStaticPressure_pa;
  const maxSp = typeof maxSpRaw === "number" && !Number.isNaN(maxSpRaw) ? maxSpRaw : null;
  if (maxSp != null && selectionPressure > maxSp + 1) return null;

  let withinEnvelope = true;
  let extrapolated = false;
  let rpm: number;
  let speedRatio: number;
  let dutyPowerStd: number; // absorbed power (kW) at standard density
  let efficiency: number | null = null;
  let motorPole: number | null = null;
  let selectedAirflow_m3hr: number | null = null;
  let usedGrid = false;

  let directMeetsFlow = true;
  if (options.directDrive) {
    // --- Direct-drive (CEBDD): fix speed to a pole band, meet the static
    // pressure, and let the delivered volume flow rise above the requested
    // flow when needed. Outlet velocity is disregarded. The valid pick is the
    // tightest band that meets the flow; undersized/oversized neighbours are
    // still returned (flagged) so they appear next to the recommendation. -----
    const customBands = Array.isArray(model.specs?.directBands)
      ? (model.specs!.directBands as Array<{ pole: number; minRpm: number; maxRpm: number }>).filter(
          (b) => b && typeof b.pole === "number" && typeof b.minRpm === "number" && typeof b.maxRpm === "number",
        )
      : [];
    const bands =
      model.specs?.fixedSpeedDirect === true
        ? fixedSpeedBands(model.ratingPoints)
        : customBands.length > 0
          ? customBands
          : DIRECT_DRIVE_BANDS;
    const dd = selectDirectDrive(model.ratingPoints, curve, referenceRpm, selectionPressure, duty.airflow_m3hr, bands);
    if (!dd) return null;
    rpm = dd.rpm;
    motorPole = dd.pole;
    directMeetsFlow = dd.meetsFlow;
    selectedAirflow_m3hr = Math.round(dd.deliveredFlow_m3hr);
    speedRatio = Math.round((rpm / referenceRpm) * 1000) / 1000;
    dutyPowerStd = dd.powerStd_kw;
    efficiency = dd.efficiency;
    withinEnvelope = dd.withinEnvelope;
    extrapolated = !dd.withinEnvelope;
    // Can't deliver the requested flow at the required static pressure → the
    // size cannot satisfy the duty, so it is excluded from the selection.
    if (!dd.meetsFlow) return null;
    if (dd.deliveredFlow_m3hr > duty.airflow_m3hr * 1.001) {
      warnings.push(
        `Delivers ~${Math.round(dd.deliveredFlow_m3hr * CFM_PER_M3HR)} cfm at the required static pressure (above the requested flow) at ${rpm} rpm, ${dd.pole}-pole.`,
      );
    }
    if (model.specs?.fixedSpeedDirect === true && motorPole >= 6) {
      warnings.push(
        `Needs a ${motorPole}-pole motor (~${rpm} rpm) — higher-pole motors can be harder to source.`,
      );
    }
  } else {

  // --- Preferred path: direct interpolation on the CFM×SP rating grid ------
  // Axial fans lift the flow up to the size's minimum when the request is below
  // it (static pressure is the priority; a higher delivered flow is accepted).
  const grid = interpolateGrid(model.ratingPoints, duty.airflow_m3hr, selectionPressure, isAxial);
  if (grid) {
    usedGrid = true;
    rpm = grid.rpm;
    dutyPowerStd = hpToKw(grid.bhp);
    withinEnvelope = grid.withinEnvelope;
    extrapolated = !grid.withinEnvelope;
    speedRatio = Math.round((rpm / referenceRpm) * 1000) / 1000;
    if (grid.lifted) {
      // Below the size's minimum flow at this SP — report the higher delivered
      // flow (the engine prefers the smallest size whose minimum still fits the
      // rpm ceiling, so a too-fast small size is dropped in favour of the next).
      selectedAirflow_m3hr = Math.round(grid.deliveredQ);
      warnings.push(
        `Delivers ~${Math.round(grid.deliveredQ * CFM_PER_M3HR)} cfm at the required static pressure (above the requested flow) at ${rpm} rpm.`,
      );
    }
    if (!withinEnvelope) {
      warnings.push(
        "Duty point is outside the rated grid; result is extrapolated and must be confirmed by an engineer.",
      );
    }
  } else {
    // --- Fallback: fan-law parabola through a single rated curve -----------
    const k = selectionPressure / (duty.airflow_m3hr * duty.airflow_m3hr);
    const qMin = curve[0].airflow_m3hr;
    const qMax = curve[curve.length - 1].airflow_m3hr;
    let qRef = findCurveIntersection(curve, k);
    if (qRef == null) {
      extrapolated = true;
      withinEnvelope = false;
      const endpoints = [curve[0], curve[curve.length - 1]];
      let best = endpoints[0];
      let bestErr = Infinity;
      for (const ep of endpoints) {
        const kEp = ep.staticPressure_pa / (ep.airflow_m3hr * ep.airflow_m3hr || 1);
        const err = Math.abs(kEp - k);
        if (err < bestErr) {
          bestErr = err;
          best = ep;
        }
      }
      qRef = best.airflow_m3hr;
      warnings.push(
        "Duty point falls outside the rated curve; result is extrapolated and must be confirmed by an engineer.",
      );
    } else if (qRef < qMin * 1.001 || qRef > qMax * 0.999) {
      withinEnvelope = false;
      warnings.push("Operating point is at the edge of the rated envelope.");
    }
    speedRatio = duty.airflow_m3hr / qRef;
    rpm = Math.round(referenceRpm * speedRatio);
    if (speedRatio > maxSpeedRatio || speedRatio < minSpeedRatio) {
      withinEnvelope = false;
      warnings.push(
        `Required speed (${rpm} rpm, ratio ${speedRatio.toFixed(2)}×) is outside the recommended ${minSpeedRatio}–${maxSpeedRatio}× band.`,
      );
    }
    const refPowerAtQ =
      interpAtAirflow(curve, qRef, "power_kw") ?? curve[curve.length - 1].power_kw;
    dutyPowerStd = refPowerAtQ * Math.pow(speedRatio, 3);
    efficiency = interpAtAirflow(curve, qRef, "efficiency");
  }
  } // end belt-drive path

  // --- Published-envelope guard (centrifugal catalogues) ------------------
  // The catalogue tables (CIEB/DIDWCEB/DIDWCFAB/CFAB) are selected by bilinear
  // interpolation across the printed CFM×SP grid (density-corrected above); fan
  // laws only fine-trim RPM inside that grid. We never invent a point the data
  // doesn't cover, so a duty that lands left of peak pressure (below the lowest
  // printed flow at the required SP) or outside the rated range (beyond the
  // printed flow/pressure span) is refused outright rather than extrapolated —
  // the engine will not quote a selection the published curve doesn't support.
  if (!options.directDrive && usedGrid && !withinEnvelope) {
    return null;
  }

  // Correct absorbed power for actual gas density.
  const dutyPower = dutyPowerStd * (density / STANDARD_AIR_DENSITY);

  // --- Motor sizing -------------------------------------------------------
  // Propeller fans (EWF/EWFDD/PRV/PRVDD) carry a catalog motor table: each MOTOR
  // HP paired with the MAX BHP it is rated to cover. The motor is read straight
  // from that column — the smallest motor whose MAX BHP covers the absorbed BHP
  // at the duty (no BHP/0.75). e.g. AV5400EWF at 4.79 BHP → 5 HP (max 5.42), at
  // 10.78 BHP → 10 HP (max 11.04). Non-propeller fans use the AFBM rule (BHP /
  // 0.75 rounded up to the next standard motor).
  const bhp = kwToHp(dutyPower);
  const motorTbl = model.specs?.motorTable;
  const hasMotorTable = Array.isArray(motorTbl) && motorTbl.length > 0;
  let motorHp: number;
  let motorBasis: "catalog" | "BHP/0.75";
  if (hasMotorTable) {
    const table = (motorTbl as Array<[number, number]>)
      .filter((e) => Array.isArray(e) && e.length === 2)
      .sort((a, b) => a[0] - b[0]);
    const hit = table.find(([, maxBhp]) => maxBhp >= bhp - 1e-9);
    // Above the largest catalog motor's envelope, fall back to a standard motor
    // that covers the absorbed BHP with the service factor.
    motorHp = hit ? hit[0] : motorAtLeastHp(bhp / serviceFactor);
    motorBasis = "catalog";
  } else {
    motorHp = suggestMotorHp(bhp);
    motorBasis = "BHP/0.75";
  }
  const motorKw = Math.round(hpToKw(motorHp) * 100) / 100;
  void serviceFactor; // retained in the result for display only

  // --- Outlet-velocity check ("good selection" rule) ----------------------
  const num = (v: unknown): number | null =>
    typeof v === "number" && !Number.isNaN(v) ? v : null;
  const outletArea = num(model.specs?.outletArea_ft2);
  const wheelDia =
    num(model.specs?.bladeDia_in) ?? num(model.specs?.wheelDia_in);
  // Forward-curve fans (CFAB) follow the same selection rule as CEB, but their
  // outlet-velocity limit is a flat 2000 fpm (higher than the CEB diameter-based
  // table); DIDWCFAB (double-width forward) uses 2200/2400 fpm by size. Direct
  // drive (CEBDD/CFABDD) disregards the OV limit either way.
  const isForwardCurve = /forward/i.test(String(model.specs?.bladeType ?? ""));
  const isDidwCfab = /DIDWCFAB$/i.test(model.modelCode);
  // CIEB (inline) reports outlet velocity at half scale, so its true OV is
  // double the nominal CFM/area; the OV limit is the CEB diameter table.
  const isCieb = /CIEB$/i.test(model.modelCode);
  // Propeller fans (EWF/EWFDD/PRV/PRVDD) report outlet velocity through the
  // opening (blade Ø + 1") with a recommended OV limit of 2200 fpm.
  const isPropeller = model.specs?.propeller === true;
  // Outlet velocity reflects the actual delivered flow (direct drive may raise it).
  const flowCfm = (selectedAirflow_m3hr ?? duty.airflow_m3hr) * CFM_PER_M3HR;
  let outletVelocity_fpm: number | null = null;
  let ovLimit_fpm: number | null = null;
  let ovWithinLimit: boolean | null = null;
  if (outletArea && outletArea > 0) {
    outletVelocity_fpm = Math.round((flowCfm / outletArea) * (isCieb ? 2 : 1));
    if (isPropeller) {
      // Recommended OV limit 2200 fpm — applies to belt and direct.
      ovLimit_fpm = 2200;
      ovWithinLimit = outletVelocity_fpm <= ovLimit_fpm;
      if (!ovWithinLimit) {
        warnings.push(
          `Outlet velocity ${outletVelocity_fpm} fpm exceeds the recommended ${ovLimit_fpm} fpm — consider a larger size.`,
        );
      }
    } else if (!options.directDrive) {
      // CEBDD/CFABDD disregard the OV limit — reported for info only.
      ovLimit_fpm = isDidwCfab
        ? didwCfabOvLimit(wheelDia)
        : isForwardCurve
          ? forwardCurveOvLimit(wheelDia)
          : outletVelocityLimit(wheelDia);
      ovWithinLimit = outletVelocity_fpm <= ovLimit_fpm;
      if (!ovWithinLimit) {
        warnings.push(
          `Outlet velocity ${outletVelocity_fpm} fpm exceeds the ${ovLimit_fpm} fpm limit — fan is undersized for this airflow.`,
        );
      }
    }
  }

  // Axial fans (TAF/VAF tube-/vane-axial) run far above the ~1200 rpm that the
  // centrifugal "good selection" rule recommends — their design speed is set by
  // the grid, capped by the axial design ceiling (maxRpm, e.g. 2000 rpm for
  // TAF/VAF). Exempt them from the 1200 rpm warning/downgrade so a valid
  // high-speed axial pick still scores HIGH (isAxial computed above).

  // --- Maximum-RPM check --------------------------------------------------
  const maxRpm = num(model.specs?.maxRpm) ?? num(model.specs?.maxRpmClassI);
  const rpmWithinMax = maxRpm == null ? true : rpm <= maxRpm;
  // Belt axial fans (TAF/VAF) are applied below their design speed ceiling
  // (2000 rpm): a duty that drives a size past that speed excludes the size
  // (pick a larger size, or VAF over TAF), rather than offering an over-speed
  // selection. Direct drive is fixed at ~1750 rpm, always under the ceiling.
  if (isAxial && !options.directDrive && !rpmWithinMax) return null;
  if (!rpmWithinMax) {
    warnings.push(`Required speed ${rpm} rpm exceeds the rated max ${maxRpm} rpm.`);
  } else if (rpm > 1200 && !options.directDrive && !isAxial) {
    warnings.push(`Speed ${rpm} rpm is above the recommended ~1200 rpm.`);
  }

  // --- Confidence scoring -------------------------------------------------
  let confidence: Confidence;
  if (options.directDrive) {
    // The recommended pick meets the requested flow within the rated curve at a
    // valid band speed. Undersized (below requested flow), over-speed, or
    // extrapolated neighbours stay in the list but at lower confidence so they
    // appear next to the recommendation without being recommended themselves.
    if (directMeetsFlow && withinEnvelope && rpmWithinMax) confidence = "HIGH";
    else if (directMeetsFlow && rpmWithinMax) confidence = "MEDIUM";
    else confidence = "LOW";
    // Direct propeller (EWFDD/FAWFDD/PRVDD) over the 2200 fpm recommended OV is
    // undersized — never a good pick, so drop it to LOW like belt does.
    if (ovWithinLimit === false) confidence = "LOW";
  } else if (extrapolated || !withinEnvelope) {
    confidence = "LOW";
  } else if (usedGrid) {
    confidence = "HIGH"; // direct grid interpolation is accurate within the envelope
  } else if (speedRatio >= 0.85 && speedRatio <= 1.08) {
    confidence = "HIGH";
  } else {
    confidence = "MEDIUM";
  }
  // AFBM constraints (belt drive): undersized (OV over limit) or over-speed is
  // never a good pick; above the recommended ~1200 rpm drops HIGH to MEDIUM.
  if (!options.directDrive) {
    if (ovWithinLimit === false || !rpmWithinMax) confidence = "LOW";
    else if (confidence === "HIGH" && rpm > 1200 && !isAxial) confidence = "MEDIUM";
  }

  const requiresEngineerConfirmation =
    confidence === "LOW" || !withinEnvelope || ovWithinLimit === false || !rpmWithinMax;

  const note = buildSelectionNote({
    modelCode: model.modelCode,
    rpm,
    speedRatio,
    dutyAirflow: duty.airflow_m3hr,
    dutyPressure: duty.staticPressure_pa,
    bhp,
    motorHp,
    motorBasis,
    outletVelocity_fpm,
    ovLimit_fpm,
    efficiency,
    confidence,
  });

  return {
    modelId: model.id,
    modelCode: model.modelCode,
    name: model.name,
    sizeLabel: model.sizeLabel ?? null,
    bladeAngle: num(model.specs?.bladeAngle_deg),
    rpm,
    referenceRpm,
    speedRatio: Math.round(speedRatio * 1000) / 1000,
    dutyAirflow_m3hr: duty.airflow_m3hr,
    selectedAirflow_m3hr,
    dutyStaticPressure_pa: duty.staticPressure_pa,
    selectionStaticPressure_pa: Math.round(selectionPressure * 100) / 100,
    power_kw: Math.round(dutyPower * 1000) / 1000,
    bhp: Math.round(bhp * 100) / 100,
    motorKw,
    motorHp,
    motorPole,
    efficiency: efficiency != null ? Math.round(efficiency * 1000) / 1000 : null,
    serviceFactor,
    outletVelocity_fpm,
    ovLimit_fpm,
    ovWithinLimit,
    maxRpm,
    rpmWithinMax,
    withinEnvelope,
    confidence,
    requiresEngineerConfirmation,
    selectionNote: note,
    warnings,
  };
}

function buildSelectionNote(p: {
  modelCode: string;
  rpm: number;
  speedRatio: number;
  dutyAirflow: number;
  dutyPressure: number;
  bhp: number;
  motorHp: number;
  motorBasis: "catalog" | "BHP/0.75";
  outletVelocity_fpm: number | null;
  ovLimit_fpm: number | null;
  efficiency: number | null;
  confidence: Confidence;
}): string {
  const eff = p.efficiency != null ? `, ~${Math.round(p.efficiency * 100)}% eff` : "";
  const ov =
    p.outletVelocity_fpm != null
      ? ` OV ${p.outletVelocity_fpm} fpm (limit ${p.ovLimit_fpm}).`
      : "";
  const motorBasis = p.motorBasis;
  return (
    `${p.modelCode} for ${Math.round(p.dutyAirflow)} m³/hr @ ${Math.round(p.dutyPressure)} Pa at ${p.rpm} rpm. ` +
    `Absorbed ${p.bhp.toFixed(2)} BHP → motor ${p.motorHp} HP (${motorBasis})${eff}.${ov} ` +
    `Confidence: ${p.confidence}.`
  );
}

/**
 * Rank candidate models against a duty point. HIGH confidence first, then
 * higher efficiency, then lower motor power, then speed ratio nearest 1.
 */
export function selectFans(
  models: FanModelInput[],
  duty: DutyPoint,
  options: SelectionOptions = {},
): SelectionResult[] {
  const results: SelectionResult[] = [];
  for (const m of models) {
    const r = selectFan(m, duty, options);
    if (r) results.push(r);
  }

  const rank: Record<Confidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  results.sort((a, b) => {
    // Fans that exceed the outlet-velocity limit sink to the bottom.
    const aOv = a.ovWithinLimit === false ? 1 : 0;
    const bOv = b.ovWithinLimit === false ? 1 : 0;
    if (aOv !== bOv) return aOv - bOv;
    // When BOTH exceed the OV limit, none is acceptable — prefer the larger fan
    // (lower outlet velocity, closest to within limit) so the recommendation
    // points the user up in size rather than down to the smallest, fastest one.
    if (
      aOv === 1 &&
      bOv === 1 &&
      a.outletVelocity_fpm != null &&
      b.outletVelocity_fpm != null &&
      a.outletVelocity_fpm !== b.outletVelocity_fpm
    ) {
      return a.outletVelocity_fpm - b.outletVelocity_fpm;
    }
    if (rank[a.confidence] !== rank[b.confidence])
      return rank[a.confidence] - rank[b.confidence];
    // Prefer the tightest delivered flow (least over-delivery above the request):
    // a belt fan that meets the request exactly carries no selectedAirflow
    // (excess 0) and beats an axial step-up or direct-drive size that delivers a
    // higher flow; among step-ups, the smallest over-delivery wins.
    const aExcess = (a.selectedAirflow_m3hr ?? a.dutyAirflow_m3hr) - a.dutyAirflow_m3hr;
    const bExcess = (b.selectedAirflow_m3hr ?? b.dutyAirflow_m3hr) - b.dutyAirflow_m3hr;
    if (Math.abs(aExcess - bExcess) > 1) return aExcess - bExcess;
    const effA = a.efficiency ?? 0;
    const effB = b.efficiency ?? 0;
    if (Math.abs(effA - effB) > 0.005) return effB - effA;
    if (Math.abs(a.motorKw - b.motorKw) > 1e-6) return a.motorKw - b.motorKw;
    return Math.abs(a.speedRatio - 1) - Math.abs(b.speedRatio - 1);
  });
  return results;
}
