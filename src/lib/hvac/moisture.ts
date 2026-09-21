/**
 * Moisture Removal Analysis — the latent half of a job, counted as WATER rather
 * than as heat.
 *
 * The Air Heat tool already reports a latent load in BTU/hr. That is the same
 * physics, but it is the wrong unit for three of the questions this business
 * actually gets asked:
 *
 *   - *"How many litres a day does this dehumidifier have to pull?"*
 *   - *"Will a bigger exhaust fan fix the damp?"*
 *   - *"How cold does the coil have to get before anything condenses at all?"*
 *
 * ## The balance, which is the whole tool
 *
 * At steady state the water going in equals the water coming out:
 *
 *     generated inside  +  ṁ·W_outdoor  =  ṁ·W_indoor  +  REMOVED
 *
 * Rearranged, that is what the equipment has to take out:
 *
 *     REMOVED = generated  +  ṁ·(W_outdoor − W_indoor)
 *
 * `W` is the HUMIDITY RATIO — pounds of water per pound of dry air. Not relative
 * humidity: RH moves when you heat or cool the same air, so two rooms at "60%"
 * can hold quite different amounts of water. Every figure here goes through `W`.
 *
 * ## Why the outdoor-air term is the headline in Manila
 *
 * On a 34 °C / 70% day the outdoor air carries about 166 gr/lb. A 24 °C / 55%
 * room carries about 72. Every 1,000 cfm of that outdoor air therefore drags in
 * roughly **660 litres of water a day** — before a single person walks in. In a
 * temperate climate ventilation is a sensible-heat problem; here it is mostly a
 * water problem, and that is what this screen exists to show.
 *
 * ## The sign that matters
 *
 * `ṁ·(W_outdoor − W_indoor)` is SIGNED, and both signs are real:
 *
 *   - Outdoor wetter than the target (the tropical norm) → ventilation ADDS to
 *     the load, and no amount of fan will dry the room.
 *   - Outdoor drier than the room (a wet process — a laundry, a drying room, a
 *     pool hall) → ventilation REMOVES water for nothing, and the right answer
 *     may be an exhaust fan rather than a machine.
 *
 * So the tool works out both, and says which applies rather than assuming. It is
 * the same honesty the ventilation calculator owes its users about cooling: a
 * fan cannot beat ambient, and here it cannot dry below ambient either.
 */
import {
  MASS_PER_CFM,
  GRAINS_PER_LB,
  GRAINS_PER_GKG,
  BTU_PER_TON,
  basisDef,
  densityFactor,
  humidityRatio,
  satPressurePsia,
  stdPressurePsia,
  btuToKw,
  toCfm,
  toF,
  toFt,
  type HeatBasis,
  type HeatAirflowUnit,
  type TempUnit,
  type AltitudeUnit,
} from "./psychrometrics";

export { BTU_PER_TON };

/** Water: 1 kg is 1 litre, near enough for a drain line. */
export const KG_PER_LB = 0.45359237;
export const HOURS_PER_DAY = 24;

/** lb/hr of water into the units a dehumidifier is sold in. */
export const lbHrToKgHr = (lbHr: number) => lbHr * KG_PER_LB;
export const lbHrToLitresDay = (lbHr: number) => lbHr * KG_PER_LB * HOURS_PER_DAY;

/**
 * LATENT heat per person, BTU/hr — ASHRAE Fundamentals ch. 18, and deliberately
 * the other half of `ventilation.ts`'s `PEOPLE_ACTIVITY`, which carries the
 * SENSIBLE figures for the same four activities.
 *
 * Latent overtakes sensible as the work gets harder: a seated person is 245
 * sensible against 155 latent, while heavy work is 580 against 870. A workshop
 * full of people is a wetter room than its temperature suggests.
 */
export const PEOPLE_LATENT = [
  { key: "seated", label: "Seated / very light", btuh: 155 },
  { key: "bench", label: "Light bench work", btuh: 275 },
  { key: "machine", label: "Light machine work, walking", btuh: 475 },
  { key: "heavy", label: "Heavy work", btuh: 870 },
] as const;
export type PeopleLatent = (typeof PEOPLE_LATENT)[number]["key"];

const latentPerPerson = (a: PeopleLatent) =>
  PEOPLE_LATENT.find((x) => x.key === a)?.btuh ?? PEOPLE_LATENT[0].btuh;

/** How a process load is typed in — both are in daily use on a job sheet. */
export type WaterRateUnit = "kgh" | "lday";
export const toLbHr = (v: number, u: WaterRateUnit) =>
  (u === "lday" ? v / HOURS_PER_DAY : v) / KG_PER_LB;

/* ------------------------------------------------------------------ *
 * Dew point — the number that decides whether a coil can work at all
 * ------------------------------------------------------------------ */

/**
 * The temperature at which this air starts to condense, °F.
 *
 * Bisection rather than one of the published curve-fits: `satPressurePsia` is
 * already here and is monotonic over the range, so inverting it numerically is
 * exact to the tolerance asked for and cannot disagree with the humidity ratios
 * computed a few lines away. A fit would be faster and would drift from them.
 *
 * Matters commercially, not just technically: a coil whose surface never gets
 * below this figure removes NO water however long it runs, and "the aircon is
 * running but the room is still damp" is nearly always this.
 */
export function dewPointF(wLbLb: number, pPsia: number): number {
  if (!(wLbLb > 0)) return Number.NEGATIVE_INFINITY;
  const pw = (pPsia * wLbLb) / (0.621945 + wLbLb);
  let lo = -80;
  let hi = 200;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (satPressurePsia(mid) < pw) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------------ *
 * The calculation
 * ------------------------------------------------------------------ */

export interface MoistureInput {
  /** The air being brought in — outdoor, on almost every job. */
  outdoorTemp: number | null;
  outdoorRh: number | null;
  /** What the room is to be held at. */
  indoorTemp: number | null;
  indoorRh: number | null;
  tempUnit: TempUnit;

  altitude: number | null;
  altitudeUnit: AltitudeUnit;

  /** Outdoor air entering — ventilation, infiltration, or both. */
  ventAirflow: number | null;
  ventUnit: HeatAirflowUnit;

  people: number | null;
  activity: PeopleLatent;

  /** A process figure somebody measured: tanks, washing, cooking, drying. */
  process: number | null;
  processUnit: WaterRateUnit;
  /** Anything else with a number of its own — curing concrete, wet goods. */
  other: number | null;
  otherUnit: WaterRateUnit;

  basis: HeatBasis;
}

export interface MoistureGain {
  key: string;
  label: string;
  /** Water this term ADDS (+) or REMOVES (−), lb/hr. */
  lbPerHr: number;
  /** Share of everything that ADDS, 0–1. Zero for a term that removes. */
  share: number;
}

export interface MoistureSolution {
  /** Humidity ratios, lb/lb — everything else is derived from these two. */
  outdoorW: number;
  indoorW: number;
  outdoorGrains: number;
  indoorGrains: number;
  /** Outdoor minus indoor, gr/lb. Positive is the tropical case. */
  deltaGrains: number;

  /** The coil has to get below this, or nothing condenses. °F. */
  indoorDewPointF: number;
  outdoorDewPointF: number;

  gains: MoistureGain[];
  /** Water generated INSIDE — everything but the outdoor-air term. */
  internalLbHr: number;
  /** The outdoor-air term, signed: + brings water in, − carries it away. */
  ventLbHr: number;

  /** What the equipment must remove. Never negative — see `surplus`. */
  removalLbHr: number;
  removalKgHr: number;
  removalLitresDay: number;

  latentBtuh: number;
  latentTons: number;
  latentKw: number;

  /**
   * True when the outdoor air already carries off more than the room makes, so
   * nothing has to be removed and the room will settle DRIER than the target.
   */
  surplus: boolean;

  /**
   * Airflow that would hold the target by dilution alone, cfm — null when the
   * outdoor air is not drier than the target, which is most of the year here.
   */
  dilutionCfm: number | null;
  /** Why dilution cannot do it, when it cannot. */
  dilutionRefusal: string | null;

  /** The dry-air mass flow the outdoor-air term was worked out on, lb/hr. */
  ventMassLbHr: number;
  pressurePsia: number;
}

export type MoistureResult = { error: string } | MoistureSolution | null;

export const isMoistureError = (r: MoistureResult): r is { error: string } =>
  r !== null && "error" in r;

/**
 * Work out what has to come out of the air.
 *
 * `null` means "not enough entered yet" — the same convention as the other
 * calculators, so a half-filled form shows nothing rather than telling the user
 * off for not having finished typing.
 */
export function solveMoisture(i: MoistureInput): MoistureResult {
  if (i.outdoorTemp == null || i.indoorTemp == null) return null;
  if (i.outdoorRh == null || i.indoorRh == null) return null;

  // Say what is WRONG before what is MISSING — the same ordering mistake the
  // Air Heat tool made, where an RH of 140 was reported as a missing humidity.
  for (const rh of [i.outdoorRh, i.indoorRh]) {
    if (rh < 0 || rh > 100.01) return { error: "Relative humidity runs from 0 to 100%." };
  }

  const altFt = toFt(i.altitude ?? 0, i.altitudeUnit);
  if (!Number.isFinite(altFt) || altFt < -1500 || altFt > 30000) {
    return { error: "Altitude looks wrong — enter a height above sea level." };
  }
  const pPsia = stdPressurePsia(altFt);

  const outF = toF(i.outdoorTemp, i.tempUnit);
  const inF = toF(i.indoorTemp, i.tempUnit);
  const outdoorW = humidityRatio(outF, i.outdoorRh / 100, pPsia);
  const indoorW = humidityRatio(inF, i.indoorRh / 100, pPsia);
  if (!Number.isFinite(outdoorW) || !Number.isFinite(indoorW)) {
    return { error: "Check the temperatures and humidities." };
  }

  // The dry-air mass the outdoor-air term rides on. Density follows the OUTDOOR
  // temperature, because that is the air being brought in — a fan handling
  // 34 °C air moves less mass per cfm than the 70 °F standard assumes.
  const cfm = i.ventAirflow == null ? 0 : toCfm(i.ventAirflow, i.ventUnit);
  if (cfm < 0 || !Number.isFinite(cfm)) return { error: "Enter an airflow of zero or more." };
  const dFactor = densityFactor(altFt, outF);
  const ventMassLbHr = MASS_PER_CFM * dFactor * cfm;
  const ventLbHr = ventMassLbHr * (outdoorW - indoorW);

  const hfg = basisDef(i.basis).hfg;
  const peopleLbHr = ((i.people ?? 0) * latentPerPerson(i.activity)) / hfg;
  const processLbHr = i.process == null ? 0 : toLbHr(i.process, i.processUnit);
  const otherLbHr = i.other == null ? 0 : toLbHr(i.other, i.otherUnit);
  if (peopleLbHr < 0 || processLbHr < 0 || otherLbHr < 0) {
    return { error: "A moisture source cannot be negative." };
  }

  const internalLbHr = peopleLbHr + processLbHr + otherLbHr;
  const raw = [
    { key: "vent", label: cfm > 0 && ventLbHr < 0 ? "Outdoor air (carries it away)" : "Outdoor air", lbPerHr: ventLbHr },
    { key: "people", label: "People", lbPerHr: peopleLbHr },
    { key: "process", label: "Process", lbPerHr: processLbHr },
    { key: "other", label: "Other", lbPerHr: otherLbHr },
  ];

  const added = raw.reduce((a, g) => a + Math.max(0, g.lbPerHr), 0);
  /**
   * Refuse only when NOTHING is moving — no source inside, and no outdoor air
   * carrying water either way.
   *
   * The first cut refused whenever nothing was ADDING, which threw away a real
   * and useful answer: outdoor air drier than the target, no process running,
   * and the room dries itself. That is not an empty form, it is the reason
   * somebody would open this screen before buying a dehumidifier they do not
   * need. Found by a test asking for exactly that case and getting an error.
   */
  if (!(added > 0) && ventLbHr === 0) {
    return {
      error:
        "Nothing here is moving moisture. Bring in some outdoor air, or enter the people and the process that wet the room.",
    };
  }
  const gains: MoistureGain[] = raw
    .filter((g) => g.lbPerHr !== 0)
    .map((g) => ({ ...g, share: g.lbPerHr > 0 ? g.lbPerHr / added : 0 }));

  const net = internalLbHr + ventLbHr;
  const surplus = net <= 0;
  const removalLbHr = Math.max(0, net);
  const latentBtuh = removalLbHr * hfg;

  /**
   * Could a fan do this instead?
   *
   * Only when the target is WETTER than outdoors — a drying room in cool air,
   * not a comfort target in Manila. Worth answering out loud either way: the
   * question "can we just put in a bigger exhaust fan?" is asked on nearly every
   * damp-building job, and the answer is usually no for a reason the customer
   * can be shown rather than asserted.
   */
  let dilutionCfm: number | null = null;
  let dilutionRefusal: string | null = null;
  const dryingPotential = indoorW - outdoorW; // lb/lb each pound of air can absorb
  if (dryingPotential > 1e-9) {
    dilutionCfm = internalLbHr > 0
      ? internalLbHr / (MASS_PER_CFM * dFactor * dryingPotential)
      : 0;
  } else {
    dilutionRefusal =
      "The outdoor air is not drier than the room you are asking for, so ventilation cannot dry it — every extra cfm brings more water in. This needs a coil or a dehumidifier, not a bigger fan.";
  }

  return {
    outdoorW,
    indoorW,
    outdoorGrains: outdoorW * GRAINS_PER_LB,
    indoorGrains: indoorW * GRAINS_PER_LB,
    deltaGrains: (outdoorW - indoorW) * GRAINS_PER_LB,
    indoorDewPointF: dewPointF(indoorW, pPsia),
    outdoorDewPointF: dewPointF(outdoorW, pPsia),
    gains,
    internalLbHr,
    ventLbHr,
    removalLbHr,
    removalKgHr: lbHrToKgHr(removalLbHr),
    removalLitresDay: lbHrToLitresDay(removalLbHr),
    latentBtuh,
    latentTons: latentBtuh / BTU_PER_TON,
    latentKw: btuToKw(latentBtuh),
    surplus,
    dilutionCfm,
    dilutionRefusal,
    ventMassLbHr,
    pressurePsia: pPsia,
  };
}

/** gr/lb into g/kg, for the half of the world that reads it that way. */
export const grainsToGkg = (gr: number) => gr / GRAINS_PER_GKG;
/** A temperature DIFFERENCE is 1.8 °F per °C, with no offset. */
export const fToC = (f: number) => (f - 32) / 1.8;
