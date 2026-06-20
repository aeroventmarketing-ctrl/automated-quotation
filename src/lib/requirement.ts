/**
 * Bridge between AI-extracted inquiry items (client units) and the deterministic
 * selection engine (SI units). All conversion happens here via lib/units — never
 * by the AI.
 */
import {
  airflowToM3hr,
  pressureToPa,
  normalizeAirflowUnit,
  normalizePressureUnit,
  type AirflowUnit,
  type PressureUnit,
} from "./units";

export interface ParsedRequirement {
  airflow?: number | null;
  airflowUnit?: string | null;
  staticPressure?: number | null;
  pressureUnit?: string | null;
  qty?: number | null;
  application?: string | null;
  modelText?: string | null;
  notes?: string | null;
  temperatureC?: number | null;
}

export interface DutyPointSI {
  airflow_m3hr: number;
  staticPressure_pa: number;
  temperatureC?: number;
  /** The original units the client used, for display. */
  sourceAirflowUnit: AirflowUnit | null;
  sourcePressureUnit: PressureUnit | null;
}

/**
 * Convert a parsed requirement into an SI duty point usable by the selection
 * engine. Returns null when airflow or pressure is missing/unparseable.
 */
export function toDutyPoint(req: ParsedRequirement): DutyPointSI | null {
  if (req.airflow == null || req.staticPressure == null) return null;

  const aUnit = normalizeAirflowUnit(req.airflowUnit) ?? "m3hr";
  const pUnit = normalizePressureUnit(req.pressureUnit) ?? "pa";

  const airflow_m3hr = airflowToM3hr(req.airflow, aUnit);
  const staticPressure_pa = pressureToPa(req.staticPressure, pUnit);

  return {
    airflow_m3hr,
    staticPressure_pa,
    temperatureC: req.temperatureC ?? undefined,
    sourceAirflowUnit: aUnit,
    sourcePressureUnit: pUnit,
  };
}
