/**
 * Sizing an exhaust or ventilation fan.
 *
 * The owner asked what the proper computation is, and the answer is that there
 * are two of them and you install the larger:
 *
 *     1 · AIR CHANGES   CFM = volume(ft³) × ACH / 60
 *     2 · HEAT BALANCE  CFM = Q(BTU/hr) / (1.08 × ΔT)
 *
 * The second is the one the Air Heat tool could already do, but only if you knew
 * to run it backwards and could state the heat gain — and it reported a ventilation
 * job as a NEGATIVE number, because from the air's point of view the air is being
 * heated. Correct, and the opposite sign from the figure a person wants to quote.
 * That is why this is its own calculation rather than a third mode over there.
 *
 * ## ΔT is a decision, not a measurement
 *
 * The trap in the heat balance is that ΔT looks like something you measure. It is
 * not: you cannot measure the room temperature of a building whose fan does not
 * exist yet. **ΔT is how far above OUTDOOR you are willing to let the room sit**,
 * and the airflow follows from that choice. Halve the allowed rise and you double
 * the fan.
 *
 * ## The limit that has to be said out loud
 *
 * Ventilation cannot cool below outdoor air. Ever. A room at outdoor + 5 °C on a
 * 34 °C day is a 39 °C room, and no fan makes it 24 °C. A client expecting that
 * needs refrigeration, and it is far cheaper to say so at quotation than after
 * installation — so a target at or below the outdoor temperature is REFUSED here
 * with that sentence, rather than quietly returning a huge airflow.
 *
 * Every figure below is a peak-condition estimate, and the roof usually dominates
 * everything else put together. That is worth knowing commercially as well as
 * technically: on the worked example the roof is 75% of the load, so insulation or
 * ridge ventilators attack the problem itself where a bigger fan only moves it.
 */

/** 1 hp, as heat. */
export const BTU_PER_HP = 2545;
/** 1 watt, as heat. */
export const BTU_PER_WATT = 3.412;
/** The sensible-heat constant — `heatConstants` in `psychrometrics` derives it. */
export const SENSIBLE_K = 1.08;
export const BTU_PER_TON = 12000;

export type DimUnit = "m" | "ft";
export type VentTempUnit = "c" | "f";

/* ------------------------------------------------------------------ *
 * The pick-lists, with their figures on them
 * ------------------------------------------------------------------ */

/**
 * Sensible heat per person — ASHRAE Fundamentals ch. 18. Sensible only: the
 * latent half is moisture, and a ventilation rate is set by temperature.
 */
export const PEOPLE_ACTIVITY = [
  { key: "seated", label: "Seated / very light", btuh: 245 },
  { key: "bench", label: "Light bench work", btuh: 275 },
  { key: "machine", label: "Light machine work, walking", btuh: 375 },
  { key: "heavy", label: "Heavy work", btuh: 580 },
] as const;
export type PeopleActivity = (typeof PEOPLE_ACTIVITY)[number]["key"];

/**
 * Roof gain at peak sun, BTU/hr per ft², as U × CLTD.
 *
 * Estimates, and the biggest single lever on the answer — a bare GI roof runs
 * six times an insulated one. Anyone with the actual roof build-up should work
 * out U × CLTD themselves and put it in as "other".
 */
export const ROOF_KINDS = [
  { key: "bare-metal", label: "Bare metal / GI sheet", btuhFt2: 54 },
  { key: "insulated", label: "Metal + 50 mm insulation", btuhFt2: 8 },
  { key: "concrete", label: "Concrete slab", btuhFt2: 15 },
  { key: "shaded", label: "Shaded, or a floor below", btuhFt2: 5 },
  { key: "none", label: "Ignore the roof", btuhFt2: 0 },
] as const;
export type RoofKind = (typeof ROOF_KINDS)[number]["key"];

/**
 * Air changes per hour — typical STARTING figures by occupancy, not code
 * compliance. Where a code, an insurer or a process spec governs (paint booths
 * and kitchen hoods usually do), that number wins over this list.
 */
export const ACH_PRESETS = [
  { key: "warehouse", label: "Warehouse / storage", ach: 5 },
  { key: "workshop", label: "Workshop / light factory", ach: 8 },
  { key: "assembly", label: "Assembly hall / hangar", ach: 8 },
  { key: "welding", label: "Welding shop", ach: 20 },
  { key: "kitchen", label: "Commercial kitchen", ach: 20 },
  { key: "toilet", label: "Toilet / washroom", ach: 12 },
  { key: "genset", label: "Generator / boiler room", ach: 25 },
  { key: "paint", label: "Paint / solvent area", ach: 30 },
] as const;
export type AchPreset = (typeof ACH_PRESETS)[number]["key"];

/** Typical motor efficiency, used to turn shaft HP into the heat it sheds. */
export const DEFAULT_MOTOR_EFFICIENCY = 0.88;
/** How much of the connected HP is actually turning at any moment. */
export const DEFAULT_MOTOR_LOAD = 0.85;

/* ------------------------------------------------------------------ *
 * Units
 * ------------------------------------------------------------------ */

export const M_TO_FT = 3.280839895;
export const toFt = (v: number, u: DimUnit) => (u === "m" ? v * M_TO_FT : v);
/** An ABSOLUTE temperature. */
export const toF = (v: number, u: VentTempUnit) => (u === "c" ? v * 1.8 + 32 : v);
/** A temperature DIFFERENCE — 1 °C of difference is 1.8 °F, with no offset. */
export const diffToF = (v: number, u: VentTempUnit) => (u === "c" ? v * 1.8 : v);
export const CFM_TO_M3HR = 1.69901082;

/* ------------------------------------------------------------------ *
 * The calculation
 * ------------------------------------------------------------------ */

export interface VentilationInput {
  length: number | null;
  width: number | null;
  height: number | null;
  dimUnit: DimUnit;

  outdoorTemp: number | null;
  /** What the room is allowed to reach. Must be above outdoor — see the header. */
  targetTemp: number | null;
  tempUnit: VentTempUnit;

  /** Total connected horsepower of motors INSIDE the space. */
  motorHp: number | null;
  motorLoad: number;
  motorEfficiency: number;

  people: number | null;
  activity: PeopleActivity;

  lightingWatts: number | null;

  /** Defaults to length × width when left blank. */
  roofArea: number | null;
  roofKind: RoofKind;

  /** Ovens, furnaces, welding sets — anything with a figure of its own. */
  otherBtuh: number | null;

  ach: number | null;
}

export interface GainLine {
  key: string;
  label: string;
  btuh: number;
  /** Share of the total, 0–1. */
  share: number;
}

export interface VentilationSolution {
  volumeFt3: number;
  roofFt2: number;
  gains: GainLine[];
  totalBtuh: number;
  /** The allowed rise, in °F, however it was entered. */
  deltaTF: number;
  /** Airflow the heat balance needs. */
  heatCfm: number;
  /** Airflow the air-change rate needs. */
  achCfm: number;
  /** The larger of the two — what to install. */
  requiredCfm: number;
  governedBy: "heat" | "air-changes";
  /** Air changes per hour the installed figure actually delivers. */
  resultingAch: number;
}

export type VentilationResult = { error: string } | VentilationSolution | null;

export const isVentilationError = (r: VentilationResult): r is { error: string } =>
  r !== null && "error" in r;

const activityBtuh = (a: PeopleActivity) =>
  PEOPLE_ACTIVITY.find((x) => x.key === a)?.btuh ?? PEOPLE_ACTIVITY[0].btuh;
const roofBtuhFt2 = (k: RoofKind) =>
  ROOF_KINDS.find((x) => x.key === k)?.btuhFt2 ?? 0;

/**
 * Size the fan. `null` means "not enough entered yet" — the same convention as
 * the other calculators, so a half-filled form shows nothing rather than telling
 * the user off for not having finished typing.
 */
export function solveVentilation(i: VentilationInput): VentilationResult {
  if (i.length == null || i.width == null || i.height == null) return null;
  if (i.outdoorTemp == null || i.targetTemp == null) return null;

  const l = toFt(i.length, i.dimUnit);
  const w = toFt(i.width, i.dimUnit);
  const h = toFt(i.height, i.dimUnit);
  if (!(l > 0 && w > 0 && h > 0)) return { error: "Give the room all three dimensions, greater than zero." };
  const volumeFt3 = l * w * h;

  const outdoorF = toF(i.outdoorTemp, i.tempUnit);
  const targetF = toF(i.targetTemp, i.tempUnit);
  const deltaTF = targetF - outdoorF;
  if (deltaTF <= 0) {
    return {
      error:
        "Ventilation cannot cool below the outdoor air — it can only bring outdoor air in. Set the room target above the outdoor temperature, or the job needs refrigeration rather than a fan.",
    };
  }
  if (deltaTF < 1.8) {
    return {
      error:
        "That rise is under 1 °C. Ventilation chases outdoor temperature loosely, not precisely; allow at least 2–3 °C or the airflow runs away.",
    };
  }

  // Floor area doubles as roof area unless the user says otherwise.
  const roofFt2 = i.roofArea != null && i.roofArea > 0
    ? (i.dimUnit === "m" ? i.roofArea * M_TO_FT * M_TO_FT : i.roofArea)
    : l * w;

  const raw: { key: string; label: string; btuh: number }[] = [
    {
      key: "motors",
      label: "Motors in the space",
      // Nameplate HP is SHAFT power; the motor's own losses land in the room too,
      // which is why efficiency divides rather than multiplies.
      btuh: (i.motorHp ?? 0) > 0
        ? ((i.motorHp as number) * BTU_PER_HP * i.motorLoad) / Math.max(0.3, i.motorEfficiency)
        : 0,
    },
    { key: "people", label: "People", btuh: (i.people ?? 0) * activityBtuh(i.activity) },
    { key: "lighting", label: "Lighting", btuh: (i.lightingWatts ?? 0) * BTU_PER_WATT },
    { key: "roof", label: "Roof / solar", btuh: roofFt2 * roofBtuhFt2(i.roofKind) },
    { key: "other", label: "Process / other", btuh: i.otherBtuh ?? 0 },
  ];

  const totalBtuh = raw.reduce((a, g) => a + g.btuh, 0);
  if (!(totalBtuh > 0)) {
    return { error: "Add at least one heat source — motors, people, lighting, the roof or a process figure." };
  }
  const gains: GainLine[] = raw
    .filter((g) => g.btuh > 0)
    .map((g) => ({ ...g, share: g.btuh / totalBtuh }));

  const heatCfm = totalBtuh / (SENSIBLE_K * deltaTF);
  const achCfm = (volumeFt3 * (i.ach ?? 0)) / 60;
  const requiredCfm = Math.max(heatCfm, achCfm);

  return {
    volumeFt3,
    roofFt2,
    gains,
    totalBtuh,
    deltaTF,
    heatCfm,
    achCfm,
    requiredCfm,
    governedBy: heatCfm >= achCfm ? "heat" : "air-changes",
    resultingAch: (requiredCfm * 60) / volumeFt3,
  };
}
