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

import { kwToHp } from "../units";

// Standard air at 20°C, sea level.
export const STANDARD_AIR_DENSITY = 1.2; // kg/m³

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
  motorKw: number; // sized standard motor after service factor
  motorHp: number;
  efficiency: number | null;
  serviceFactor: number;
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

function pickStandardMotor(requiredKw: number): number {
  for (const kw of STANDARD_MOTOR_KW) {
    if (kw >= requiredKw - 1e-9) return kw;
  }
  // Beyond the largest standard size — return required, rounded up.
  return Math.ceil(requiredKw);
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

  // --- Fan-law parabola through the duty point ----------------------------
  const k = selectionPressure / (duty.airflow_m3hr * duty.airflow_m3hr);

  const qMin = curve[0].airflow_m3hr;
  const qMax = curve[curve.length - 1].airflow_m3hr;

  let qRef = findCurveIntersection(curve, k);
  let withinEnvelope = true;
  let extrapolated = false;

  if (qRef == null) {
    // No clean crossing within the curve — extrapolate from the nearest end
    // point along the fan-law parabola. Always flagged for engineer review.
    extrapolated = true;
    withinEnvelope = false;
    // Choose the curve endpoint whose own parabola constant is closest to k.
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

  // --- Speed ratio via fan laws -------------------------------------------
  const speedRatio = duty.airflow_m3hr / qRef; // = N_duty / N_ref
  const rpm = Math.round(referenceRpm * speedRatio);

  if (speedRatio > maxSpeedRatio || speedRatio < minSpeedRatio) {
    withinEnvelope = false;
    warnings.push(
      `Required speed (${rpm} rpm, ratio ${speedRatio.toFixed(2)}×) is outside the recommended ${minSpeedRatio}–${maxSpeedRatio}× band.`,
    );
  }

  // --- Power & efficiency at the operating point --------------------------
  const refPowerAtQ =
    interpAtAirflow(curve, qRef, "power_kw") ?? curve[curve.length - 1].power_kw;
  // Scale power by speed³, then correct for actual gas density.
  const dutyPowerStd = refPowerAtQ * Math.pow(speedRatio, 3);
  const dutyPower = dutyPowerStd * (density / STANDARD_AIR_DENSITY);

  const efficiency = interpAtAirflow(curve, qRef, "efficiency");

  const requiredMotorKw = dutyPower * serviceFactor;
  const motorKw = pickStandardMotor(requiredMotorKw);
  const motorHp = Math.round(kwToHp(motorKw) * 100) / 100;

  // --- Confidence scoring -------------------------------------------------
  let confidence: Confidence;
  if (extrapolated || !withinEnvelope) {
    confidence = "LOW";
  } else if (speedRatio >= 0.85 && speedRatio <= 1.08) {
    confidence = "HIGH";
  } else {
    confidence = "MEDIUM";
  }

  const requiresEngineerConfirmation = confidence === "LOW" || !withinEnvelope;

  const note = buildSelectionNote({
    modelCode: model.modelCode,
    rpm,
    speedRatio,
    dutyAirflow: duty.airflow_m3hr,
    dutyPressure: duty.staticPressure_pa,
    motorKw,
    motorHp,
    serviceFactor,
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
    motorKw,
    motorHp,
    efficiency: efficiency != null ? Math.round(efficiency * 1000) / 1000 : null,
    serviceFactor,
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
  motorKw: number;
  motorHp: number;
  serviceFactor: number;
  efficiency: number | null;
  confidence: Confidence;
}): string {
  const eff = p.efficiency != null ? `, ~${Math.round(p.efficiency * 100)}% eff` : "";
  const speed =
    Math.abs(p.speedRatio - 1) < 0.02
      ? "at rated speed"
      : `at ${p.rpm} rpm (${p.speedRatio.toFixed(2)}× reference via fan laws)`;
  return (
    `${p.modelCode} selected for ${Math.round(p.dutyAirflow)} m³/hr @ ${Math.round(p.dutyPressure)} Pa ${speed}. ` +
    `Motor ${p.motorKw} kW (${p.motorHp} HP) incl. ${p.serviceFactor}× service factor${eff}. ` +
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
