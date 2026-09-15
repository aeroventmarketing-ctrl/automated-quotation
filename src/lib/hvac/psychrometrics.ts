/**
 * Air-side heat: sensible, latent, total and the sensible heat ratio.
 *
 * Pure maths, no React — the staff tool and the public HVAC Tools page on the
 * storefront both render this, so a correction here reaches both at once. Same
 * arrangement as `ductulator.ts` and `fan-law.ts`.
 *
 * ## One constant, not four
 *
 * Every figure in this file is the same number wearing different clothes: the
 * MASS of dry air an airflow carries per hour.
 *
 *     ṁ = ρ × 60 × CFM = 4.5 × CFM        lb(dry air)/hr   at ρ = 0.075 lb/ft³
 *
 * Multiply that by a property of air and the familiar constants fall out:
 *
 *     sensible   4.5 × cp            = 1.08  (cp 0.240)   or 1.10  (cp 0.244)
 *     latent     4.5 × hfg / 7000    = 0.68  (hfg 1060)   or 0.69  (hfg 1076)
 *     total      4.5                 = 4.5   (enthalpy is already per lb)
 *
 * They are DERIVED here rather than typed in, because the relationship between
 * them is the thing that has to stay true. A constant typed in by hand is a
 * constant that can drift from the basis it came from.
 *
 * ## Why a basis, and not just a number
 *
 * The owner asked for a switchable sensible constant — 1.08 is what Philippine
 * practice and older Carrier worksheets use, 1.10 is current ASHRAE. But the
 * choice is not one number: pairing 1.08 with 0.69 would take the specific heat
 * from one authority and the latent heat from another, and the total would then
 * match neither. So the switch picks a BASIS and every constant moves together.
 *
 * ## Total heat = sensible + latent, and why not from enthalpy
 *
 * Computed the classic way — Qs from ΔT, Ql from ΔW, Qt from Δh — the three do
 * not close. On a 2000 cfm, 80 °F/50% → 55 °F/95% coil they are out by 2.1% on
 * the Carrier basis. Neither figure is wrong: the 0.68 constant uses a single
 * latent heat, while the entering and leaving air sit at different temperatures,
 * so the exact latent term carries a cross product the simplification drops.
 *
 * That is textbook behaviour and a calculator printing 6.24 TR in one box and
 * 6.38 TR in another would be reported as a bug. So **total is sensible plus
 * latent** — the three always add up and the SHR is consistent with them. When
 * enthalpies are also given, the enthalpy-based total is reported ALONGSIDE as a
 * cross-check with the gap named, which is how a mis-read psychrometric chart
 * gets caught.
 */

/** Standard air density, the basis of every constant here. */
export const STD_DENSITY_LB_FT3 = 0.075;
/** lb of dry air per hour, per cfm. ṁ = 0.075 lb/ft³ × 60 min/hr. */
export const MASS_PER_CFM = STD_DENSITY_LB_FT3 * 60; // 4.5
/** Grains of moisture per pound. */
export const GRAINS_PER_LB = 7000;
/** BTU/hr in one ton of refrigeration. */
export const BTU_PER_TON = 12000;

export type HeatBasis = "carrier" | "ashrae";

export interface BasisDef {
  key: HeatBasis;
  label: string;
  /** Specific heat of air, BTU/(lb·°F). */
  cp: number;
  /** Latent heat of vaporisation, BTU/lb. */
  hfg: number;
  note: string;
}

export const HEAT_BASES: BasisDef[] = [
  {
    key: "carrier",
    label: "1.08 · Carrier",
    cp: 0.24,
    hfg: 1060,
    note: "Dry-air specific heat. The classic figure, and what most Philippine worksheets use.",
  },
  {
    key: "ashrae",
    label: "1.10 · ASHRAE",
    cp: 0.244,
    hfg: 1076,
    note: "Moist-air specific heat, per ASHRAE Fundamentals. Reads about 1.8% higher than 1.08.",
  },
];

export const basisDef = (b: HeatBasis): BasisDef => HEAT_BASES.find((x) => x.key === b) ?? HEAT_BASES[0];

export interface HeatConstants {
  /** BTU/hr per (cfm · °F) — the 1.08 / 1.10. */
  sensible: number;
  /** BTU/hr per (cfm · gr/lb) — the 0.68 / 0.69. */
  latentGrains: number;
  /** BTU/hr per (cfm · BTU/lb) — the 4.5. */
  total: number;
}

/**
 * The three constants for a basis, at a given air density.
 *
 * Rounded to two decimals so the screen shows 1.08 and 0.68 — the numbers people
 * recognise and can check against a worksheet — rather than 1.0800000000000001.
 * At standard density that rounding is exact; away from it the density factor
 * has already moved the figure far more than the rounding does.
 */
export function heatConstants(basis: HeatBasis, densityFactor = 1): HeatConstants {
  const { cp, hfg } = basisDef(basis);
  const mass = MASS_PER_CFM * densityFactor;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    sensible: r2(mass * cp),
    latentGrains: r2((mass * hfg) / GRAINS_PER_LB),
    total: r2(mass),
  };
}

/* ------------------------------------------------------------------ *
 * Air density — altitude and temperature
 * ------------------------------------------------------------------ */

/** Barometric pressure at altitude, psia (ASHRAE standard atmosphere). */
export function stdPressurePsia(altitudeFt: number): number {
  return 14.696 * Math.pow(1 - 6.8754e-6 * altitudeFt, 5.2559);
}

/** Dry-air density (lb/ft³) from the ideal gas law, R = 53.35 ft·lbf/(lb·°R). */
export function airDensity(altitudeFt: number, tempF: number): number {
  return (stdPressurePsia(altitudeFt) * 144) / (53.35 * (tempF + 459.67));
}

/** The conditions the 1.08 / 0.68 / 4.5 constants are quoted at. */
export const STD_ALTITUDE_FT = 0;
export const STD_TEMP_F = 70;

/**
 * How far the air is from standard — every constant scales by this.
 *
 * Not a rounding detail: Baguio at 1500 m is 0.835, so a load worked at sea
 * level would be 17% out. Hot air is the same story — dryer exhaust at 150 °F is
 * 0.87.
 *
 * Measured against the density AT THE STANDARD POINT, not against the nominal
 * 0.075. Those two differ: standard air is *defined* as exactly 0.075 lb/ft³,
 * while the ideal gas law at 14.696 psia and 70 °F gives 0.07489 — 0.15% apart,
 * a definitional artefact and not a fact about anybody's air. Dividing by 0.075
 * would leak it into the answer, so a user who touches nothing would be shown a
 * total constant of 4.49 instead of the 4.5 they expect and would rightly ask
 * why. Ratioing against the same formula at the standard point makes standard
 * conditions come out at exactly 1, which is what "standard" has to mean.
 */
export function densityFactor(altitudeFt: number, tempF: number): number {
  return airDensity(altitudeFt, tempF) / airDensity(STD_ALTITUDE_FT, STD_TEMP_F);
}

/* ------------------------------------------------------------------ *
 * Psychrometrics — what a hygrometer reads, turned into what the maths needs
 * ------------------------------------------------------------------ */

/** Saturation pressure of water vapour (psia) over liquid water, ASHRAE eq. 6. */
export function satPressurePsia(tempF: number): number {
  const T = tempF + 459.67;
  return Math.exp(
    -1.0440397e4 / T +
      -1.129465e1 +
      -2.7022355e-2 * T +
      1.289036e-5 * T * T +
      -2.4780681e-9 * T * T * T +
      6.5459673 * Math.log(T),
  );
}

/** Humidity ratio (lb/lb dry air) from dry-bulb, relative humidity (0–1) and pressure. */
export function humidityRatio(tempF: number, rh: number, pPsia: number): number {
  const pw = Math.max(0, Math.min(1, rh)) * satPressurePsia(tempF);
  if (pw >= pPsia) return 0;
  return (0.621945 * pw) / (pPsia - pw);
}

/** Moist-air enthalpy, BTU per lb of DRY air. */
export function enthalpy(tempF: number, wLbLb: number): number {
  return 0.24 * tempF + wLbLb * (1061 + 0.444 * tempF);
}

/* ------------------------------------------------------------------ *
 * Units — I-P inside, anything the user likes outside
 * ------------------------------------------------------------------ */

export type HeatAirflowUnit = "cfm" | "m3hr" | "lps";
export type TempUnit = "f" | "c";
export type HumidityUnit = "rh" | "grains" | "gkg";
export type AltitudeUnit = "ft" | "m";

export const CFM_PER_M3HR = 1 / 1.69901082;
export const CFM_PER_LPS = 2.11888;

export const toCfm = (v: number, u: HeatAirflowUnit) =>
  u === "m3hr" ? v * CFM_PER_M3HR : u === "lps" ? v * CFM_PER_LPS : v;
/** An ABSOLUTE temperature. Never use this on a difference. */
export const toF = (v: number, u: TempUnit) => (u === "c" ? v * 1.8 + 32 : v);
export const toFt = (v: number, u: AltitudeUnit) => (u === "m" ? v / 0.3048 : v);
/** 1 g/kg is exactly 7 gr/lb (both are mass ratios; 1000 g/kg = 7000 gr/lb). */
export const GRAINS_PER_GKG = 7;

/** BTU/hr into the units the answer is read in. */
export const btuToKw = (btuh: number) => (btuh * 1055.05585) / 3600 / 1000;
export const btuToTons = (btuh: number) => btuh / BTU_PER_TON;

/** …and back, for a load typed in whatever the job sheet used. */
export type LoadUnit = "btuh" | "tons" | "kw";
export const toBtuh = (v: number, u: LoadUnit) =>
  u === "tons" ? v * BTU_PER_TON : u === "kw" ? (v * 1000 * 3600) / 1055.05585 : v;

/* ------------------------------------------------------------------ *
 * The calculation
 * ------------------------------------------------------------------ */

/** One air state, as the user gives it. */
export interface AirState {
  /** Dry-bulb temperature, in `tempUnit`. */
  temp: number | null;
  /** Humidity, read as `humidityUnit` says. Null when only sensible is wanted. */
  humidity: number | null;
  /** Enthalpy in BTU/lb — optional, and only ever used as a cross-check. */
  enthalpy?: number | null;
}

/**
 * Which way round the sum is worked.
 *
 * `heat` — the airflow is known, find the heat it carries.
 * `airflow` — the sensible load is known, find the airflow that carries it.
 *
 * The second is the commoner question in practice: a job gives you a room load
 * and a supply temperature, and what you need is the fan. It is the same
 * equation rearranged, so it is the same code with `cfm` arriving from a
 * different place — not a second calculator that could disagree with the first.
 *
 * **Sensible drives it, never total.** The airflow through a coil is set by the
 * sensible load and the supply-air temperature difference; the total decides how
 * big the coil is, not how much air the fan moves.
 */
export type AirHeatMode = "heat" | "airflow";

export interface AirHeatInput {
  mode: AirHeatMode;
  /** `heat` mode: the airflow being moved. */
  airflow: number | null;
  airflowUnit: HeatAirflowUnit;
  /** `airflow` mode: the SENSIBLE load the air has to carry. */
  load?: number | null;
  loadUnit?: LoadUnit;
  tempUnit: TempUnit;
  humidityUnit: HumidityUnit;
  /** Entering air — the room, or the coil's on-coil condition. */
  entering: AirState;
  /** Leaving air — the supply, or the off-coil condition. */
  leaving: AirState;
  basis: HeatBasis;
  /** Site altitude. Standard air is sea level. */
  altitude: number | null;
  altitudeUnit: AltitudeUnit;
  /** The air temperature WHERE THE AIRFLOW WAS MEASURED, in `tempUnit`. */
  flowTemp: number | null;
}

export interface AirHeatSolution {
  /** The airflow, in cfm — given in `heat` mode, solved in `airflow` mode. */
  cfm: number;
  /** The constants actually used, after the density factor. */
  constants: HeatConstants;
  densityFactor: number;
  density: number;
  pressurePsia: number;
  /** BTU/hr. */
  sensible: number;
  latent: number | null;
  /** Sensible + latent (sensible alone when no humidity was given). */
  total: number;
  /** Qs / Qt — null when there is no latent half to compare against. */
  shr: number | null;
  deltaTF: number;
  /** Humidity ratios actually used, gr/lb. */
  enteringGrains: number | null;
  leavingGrains: number | null;
  /**
   * The enthalpy cross-check, when both enthalpies were given: the total the
   * enthalpy difference implies, and how far it sits from sensible + latent.
   * A gap of a percent or two is the constants' own simplification; a large one
   * means a state was misread.
   */
  crossCheck: { total: number; gapPct: number } | null;
}

export type AirHeatResult = { error: string } | AirHeatSolution | null;

export const isAirHeatError = (r: AirHeatResult): r is { error: string } =>
  r !== null && "error" in r;

/**
 * Solve the air-side heat. `null` means "not enough entered yet" — the same
 * convention as `solveFanLaw`, so a half-filled form shows nothing rather than
 * an error telling the user off for not having finished typing.
 */
export function solveAirHeat(input: AirHeatInput): AirHeatResult {
  const { entering, leaving, basis } = input;
  if (entering.temp == null || leaving.temp == null) return null;
  const reverse = input.mode === "airflow";
  if (reverse ? input.load == null : input.airflow == null) return null;

  const altFt = toFt(input.altitude ?? 0, input.altitudeUnit);
  if (!Number.isFinite(altFt) || altFt < -1500 || altFt > 30000) {
    return { error: "Altitude looks wrong — enter a height above sea level." };
  }
  // Standard air unless told otherwise: the flow temperature defaults to 70 °F.
  const flowF = input.flowTemp == null ? 70 : toF(input.flowTemp, input.tempUnit);
  const dFactor = densityFactor(altFt, flowF);
  if (!(dFactor > 0) || !Number.isFinite(dFactor)) return { error: "Check the altitude and air temperature." };
  const constants = heatConstants(basis, dFactor);

  const t1 = toF(entering.temp, input.tempUnit);
  const t2 = toF(leaving.temp, input.tempUnit);
  const deltaTF = t1 - t2;

  // The only thing the two modes disagree about is where `cfm` comes from.
  // Everything past this point is one code path, so the reverse answer can never
  // drift from the forward one — put the airflow it gives back in and the load
  // it was asked for comes out.
  let cfm: number;
  if (reverse) {
    // Magnitudes: a job sheet says "24,000 BTU/hr" whether the coil heats or
    // cools, and refusing a heating load because the arithmetic made the airflow
    // negative would be pedantry about a sign the user never typed.
    const btuh = Math.abs(toBtuh(input.load!, input.loadUnit ?? "btuh"));
    if (!(btuh > 0)) return { error: "Enter the sensible load the air has to carry." };
    if (Math.abs(deltaTF) < 0.05) {
      return { error: "Give the entering and leaving air different temperatures — air at the room temperature carries no sensible heat, however much of it there is." };
    }
    cfm = btuh / (constants.sensible * Math.abs(deltaTF));
  } else {
    cfm = toCfm(input.airflow!, input.airflowUnit);
    if (!(cfm > 0) || !Number.isFinite(cfm)) return { error: "Enter an airflow greater than zero." };
  }
  if (!Number.isFinite(cfm)) return { error: "Check the figures." };

  const sensible = constants.sensible * cfm * deltaTF;

  // Humidity is optional: a ventilation or heating job is often sensible-only,
  // and demanding a humidity to get an answer would make the tool useless there.
  const pPsia = stdPressurePsia(altFt);
  // Say what is WRONG before saying what is MISSING: a relative humidity of 140
  // used to come back as "give the humidity for both air states", which is not
  // the problem and sends the reader looking at the wrong box.
  if (input.humidityUnit === "rh") {
    for (const s of [entering, leaving]) {
      if (s.humidity != null && (s.humidity < 0 || s.humidity > 100.01)) {
        return { error: "Relative humidity runs from 0 to 100%." };
      }
    }
  }
  const grainsOf = (s: AirState, tF: number): number | null => {
    if (s.humidity == null) return null;
    if (input.humidityUnit === "grains") return s.humidity;
    if (input.humidityUnit === "gkg") return s.humidity * GRAINS_PER_GKG;
    return humidityRatio(tF, s.humidity / 100, pPsia) * GRAINS_PER_LB;
  };
  const w1 = grainsOf(entering, t1);
  const w2 = grainsOf(leaving, t2);
  if ((w1 == null) !== (w2 == null)) {
    return { error: "Give the humidity for both air states, or for neither." };
  }

  const latent = w1 != null && w2 != null ? constants.latentGrains * cfm * (w1 - w2) : null;
  // Total is sensible + latent, so the three figures on screen always add up.
  const total = sensible + (latent ?? 0);
  const shr = latent != null && total !== 0 ? sensible / total : null;

  // The enthalpy cross-check, only when both were given.
  let crossCheck: AirHeatSolution["crossCheck"] = null;
  const h1 = entering.enthalpy;
  const h2 = leaving.enthalpy;
  if (h1 != null && h2 != null && Number.isFinite(h1) && Number.isFinite(h2)) {
    const byEnthalpy = constants.total * cfm * (h1 - h2);
    crossCheck = {
      total: byEnthalpy,
      gapPct: byEnthalpy === 0 ? 0 : ((total - byEnthalpy) / byEnthalpy) * 100,
    };
  }

  return {
    cfm,
    constants,
    densityFactor: dFactor,
    density: airDensity(altFt, flowF),
    pressurePsia: pPsia,
    sensible,
    latent,
    total,
    shr,
    deltaTF,
    enteringGrains: w1,
    leavingGrains: w2,
    crossCheck,
  };
}
