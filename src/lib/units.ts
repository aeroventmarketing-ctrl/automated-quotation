/**
 * Deterministic unit-conversion utilities.
 *
 * IMPORTANT: The AI never performs numeric unit conversions — only this module
 * does. Everything is stored internally in SI: airflow in m³/hr, pressure in Pa,
 * dimensions in mm. Display happens in whatever unit the client originally used.
 */

// ---------------------------------------------------------------------------
// Airflow — canonical SI unit: m³/hr
// ---------------------------------------------------------------------------

export type AirflowUnit = "cfm" | "m3hr" | "m3s" | "ls";

// Multiplier to convert 1 unit -> m³/hr
const AIRFLOW_TO_M3HR: Record<AirflowUnit, number> = {
  m3hr: 1,
  cfm: 1.69901082, // 1 ft³/min = 0.028316846592 m³ * 60 min
  m3s: 3600,
  ls: 3.6, // 1 L/s = 0.001 m³/s * 3600
};

export function airflowToM3hr(value: number, unit: AirflowUnit): number {
  return value * AIRFLOW_TO_M3HR[unit];
}

export function airflowFromM3hr(valueM3hr: number, unit: AirflowUnit): number {
  return valueM3hr / AIRFLOW_TO_M3HR[unit];
}

export function convertAirflow(
  value: number,
  from: AirflowUnit,
  to: AirflowUnit,
): number {
  return airflowFromM3hr(airflowToM3hr(value, from), to);
}

// ---------------------------------------------------------------------------
// Pressure — canonical SI unit: Pa
// ---------------------------------------------------------------------------

export type PressureUnit = "pa" | "mmaq" | "inwg" | "kpa";

// Multiplier to convert 1 unit -> Pa
const PRESSURE_TO_PA: Record<PressureUnit, number> = {
  pa: 1,
  mmaq: 9.80665, // 1 mm H2O (mmAq) at 4°C
  inwg: 249.0889, // 1 inch water gauge at 4°C
  kpa: 1000,
};

export function pressureToPa(value: number, unit: PressureUnit): number {
  return value * PRESSURE_TO_PA[unit];
}

export function pressureFromPa(valuePa: number, unit: PressureUnit): number {
  return valuePa / PRESSURE_TO_PA[unit];
}

export function convertPressure(
  value: number,
  from: PressureUnit,
  to: PressureUnit,
): number {
  return pressureFromPa(pressureToPa(value, from), to);
}

// ---------------------------------------------------------------------------
// Dimension — canonical SI unit: mm
// ---------------------------------------------------------------------------

export type DimensionUnit = "mm" | "inch";

const DIMENSION_TO_MM: Record<DimensionUnit, number> = {
  mm: 1,
  inch: 25.4,
};

export function dimensionToMm(value: number, unit: DimensionUnit): number {
  return value * DIMENSION_TO_MM[unit];
}

export function dimensionFromMm(valueMm: number, unit: DimensionUnit): number {
  return valueMm / DIMENSION_TO_MM[unit];
}

export function convertDimension(
  value: number,
  from: DimensionUnit,
  to: DimensionUnit,
): number {
  return dimensionFromMm(dimensionToMm(value, from), to);
}

// ---------------------------------------------------------------------------
// Power helpers (used by the selection engine output)
// ---------------------------------------------------------------------------

export const KW_PER_HP = 0.745699872;

export function kwToHp(kw: number): number {
  return kw / KW_PER_HP;
}

export function hpToKw(hp: number): number {
  return hp * KW_PER_HP;
}

// ---------------------------------------------------------------------------
// Normalization helpers — tolerant parsing of free-text unit strings
// ---------------------------------------------------------------------------

const AIRFLOW_ALIASES: Record<string, AirflowUnit> = {
  cfm: "cfm",
  "ft3/min": "cfm",
  "cf/m": "cfm",
  "m3/hr": "m3hr",
  "m³/hr": "m3hr",
  m3hr: "m3hr",
  cmh: "m3hr",
  "m3/h": "m3hr",
  "m3/s": "m3s",
  "m³/s": "m3s",
  cms: "m3s",
  "l/s": "ls",
  lps: "ls",
  ls: "ls",
};

const PRESSURE_ALIASES: Record<string, PressureUnit> = {
  pa: "pa",
  pascal: "pa",
  mmaq: "mmaq",
  mmh2o: "mmaq",
  "mm h2o": "mmaq",
  "mm aq": "mmaq",
  mmwc: "mmaq",
  inwg: "inwg",
  "in wg": "inwg",
  "inch wg": "inwg",
  "in. w.g.": "inwg",
  kpa: "kpa",
};

export function normalizeAirflowUnit(raw: string | null | undefined): AirflowUnit | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "");
  return AIRFLOW_ALIASES[key] ?? AIRFLOW_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function normalizePressureUnit(raw: string | null | undefined): PressureUnit | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "");
  return PRESSURE_ALIASES[key] ?? PRESSURE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export const AIRFLOW_UNIT_LABELS: Record<AirflowUnit, string> = {
  cfm: "CFM",
  m3hr: "m³/hr",
  m3s: "m³/s",
  ls: "L/s",
};

export const PRESSURE_UNIT_LABELS: Record<PressureUnit, string> = {
  pa: "Pa",
  mmaq: "mmAq",
  inwg: "inWG",
  kpa: "kPa",
};
