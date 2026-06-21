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

/** AFBM outlet-velocity limit (fpm) by wheel diameter (inches). */
export function outletVelocityLimit(wheelDia_in: number | null): number {
  if (wheelDia_in == null) return 1800;
  if (wheelDia_in <= 27) return 1800;
  if (wheelDia_in <= 36.5) return 2000;
  return 3000;
}

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
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface SelectionResult {
  modelId: string;
  modelCode: string;
  name: string;
  sizeLabel?: string | null;
  rpm: number;
  referenceRpm: number;
  speedRatio: number;
  dutyAirflow_m3hr: number;
  dutyStaticPressure_pa: number;
  /** Static pressure used internally for selection (density-corrected to standard air). */
  selectionStaticPressure_pa: number;
  power_kw: number; // absorbed power at duty (density-corrected)
  bhp: number; // absorbed power in HP
  motorKw: number; // sized standard motor
  motorHp: number; // suggested motor (BHP/0.75 rounded up to the motor list)
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
}

/**
 * Interpolate the operating point on a full CFM×SP rating grid (each cell gives
 * the RPM and BHP for that airflow + static pressure). Returns null when the
 * data is a single fan curve rather than a grid (≥2 distinct SP levels each
 * with ≥2 airflow points) — callers then fall back to the fan-law method.
 */
function interpolateGrid(
  points: RatingPoint[],
  q: number,
  p: number,
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
  const pInRange = p >= minSp - 1 && p <= maxSp + 1;
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
  const aLo = atQ(loS, q);
  const aHi = atQ(hiS, q);
  const t = lo === hi ? 0 : (p - lo) / (hi - lo);
  const rpm = aLo.rpm + (aHi.rpm - aLo.rpm) * t;
  const bhp = aLo.bhp + (aHi.bhp - aLo.bhp) * t;

  // Envelope = the airflow range interpolated between the two pressure levels
  // (the rating grid is triangular, so each SP level has its own CFM span).
  const minQ = loS[0].q + (hiS[0].q - loS[0].q) * t;
  const maxQ = loS[loS.length - 1].q + (hiS[hiS.length - 1].q - loS[loS.length - 1].q) * t;
  const qInRange = q >= minQ - 1 && q <= maxQ + 1;

  return { rpm: Math.round(rpm), bhp, withinEnvelope: pInRange && qInRange };
}

// ---------------------------------------------------------------------------
// Core selection
// ---------------------------------------------------------------------------

export function selectFan(
  model: FanModelInput,
  duty: DutyPoint,
  options: SelectionOptions = {},
): SelectionResult | null {
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

  let withinEnvelope = true;
  let extrapolated = false;
  let rpm: number;
  let speedRatio: number;
  let dutyPowerStd: number; // absorbed power (kW) at standard density
  let efficiency: number | null = null;

  // --- Preferred path: direct interpolation on the CFM×SP rating grid ------
  const grid = interpolateGrid(model.ratingPoints, duty.airflow_m3hr, selectionPressure);
  if (grid) {
    rpm = grid.rpm;
    dutyPowerStd = hpToKw(grid.bhp);
    withinEnvelope = grid.withinEnvelope;
    extrapolated = !grid.withinEnvelope;
    speedRatio = Math.round((rpm / referenceRpm) * 1000) / 1000;
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

  // Correct absorbed power for actual gas density.
  const dutyPower = dutyPowerStd * (density / STANDARD_AIR_DENSITY);

  // --- Motor sizing (AFBM rule: BHP / 0.75, rounded up to the motor list) --
  const bhp = kwToHp(dutyPower);
  const motorHp = suggestMotorHp(bhp);
  const motorKw = Math.round(hpToKw(motorHp) * 100) / 100;
  void serviceFactor; // retained in the result for display only

  // --- Outlet-velocity check ("good selection" rule) ----------------------
  const num = (v: unknown): number | null =>
    typeof v === "number" && !Number.isNaN(v) ? v : null;
  const outletArea = num(model.specs?.outletArea_ft2);
  const wheelDia =
    num(model.specs?.bladeDia_in) ?? num(model.specs?.wheelDia_in);
  const dutyCfm = duty.airflow_m3hr * CFM_PER_M3HR;
  let outletVelocity_fpm: number | null = null;
  let ovLimit_fpm: number | null = null;
  let ovWithinLimit: boolean | null = null;
  if (outletArea && outletArea > 0) {
    outletVelocity_fpm = Math.round(dutyCfm / outletArea);
    ovLimit_fpm = outletVelocityLimit(wheelDia);
    ovWithinLimit = outletVelocity_fpm <= ovLimit_fpm;
    if (!ovWithinLimit) {
      warnings.push(
        `Outlet velocity ${outletVelocity_fpm} fpm exceeds the ${ovLimit_fpm} fpm limit — fan is undersized for this airflow.`,
      );
    }
  }

  // --- Maximum-RPM check --------------------------------------------------
  const maxRpm = num(model.specs?.maxRpm) ?? num(model.specs?.maxRpmClassI);
  const rpmWithinMax = maxRpm == null ? true : rpm <= maxRpm;
  if (!rpmWithinMax) {
    warnings.push(`Required speed ${rpm} rpm exceeds the rated max ${maxRpm} rpm.`);
  } else if (rpm > 1200) {
    warnings.push(`Speed ${rpm} rpm is above the recommended ~1200 rpm.`);
  }

  // --- Confidence scoring -------------------------------------------------
  let confidence: Confidence;
  if (extrapolated || !withinEnvelope) {
    confidence = "LOW";
  } else if (grid) {
    confidence = "HIGH"; // direct grid interpolation is accurate within the envelope
  } else if (speedRatio >= 0.85 && speedRatio <= 1.08) {
    confidence = "HIGH";
  } else {
    confidence = "MEDIUM";
  }
  // AFBM constraints: undersized (OV over limit) or over-speed is never a good pick;
  // above the recommended ~1200 rpm drops a HIGH pick to MEDIUM.
  if (ovWithinLimit === false || !rpmWithinMax) confidence = "LOW";
  else if (confidence === "HIGH" && rpm > 1200) confidence = "MEDIUM";

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
    rpm,
    referenceRpm,
    speedRatio: Math.round(speedRatio * 1000) / 1000,
    dutyAirflow_m3hr: duty.airflow_m3hr,
    dutyStaticPressure_pa: duty.staticPressure_pa,
    selectionStaticPressure_pa: Math.round(selectionPressure * 100) / 100,
    power_kw: Math.round(dutyPower * 1000) / 1000,
    bhp: Math.round(bhp * 100) / 100,
    motorKw,
    motorHp,
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
  return (
    `${p.modelCode} for ${Math.round(p.dutyAirflow)} m³/hr @ ${Math.round(p.dutyPressure)} Pa at ${p.rpm} rpm. ` +
    `Absorbed ${p.bhp.toFixed(2)} BHP → motor ${p.motorHp} HP (BHP/0.75)${eff}.${ov} ` +
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
    if (rank[a.confidence] !== rank[b.confidence])
      return rank[a.confidence] - rank[b.confidence];
    const effA = a.efficiency ?? 0;
    const effB = b.efficiency ?? 0;
    if (Math.abs(effA - effB) > 0.005) return effB - effA;
    if (Math.abs(a.motorKw - b.motorKw) > 1e-6) return a.motorKw - b.motorKw;
    return Math.abs(a.speedRatio - 1) - Math.abs(b.speedRatio - 1);
  });
  return results;
}
