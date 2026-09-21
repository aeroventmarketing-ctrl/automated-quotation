import { describe, it, expect } from "vitest";
import {
  solveMoisture,
  isMoistureError,
  dewPointF,
  lbHrToLitresDay,
  PEOPLE_LATENT,
  fToC,
  type MoistureInput,
  type MoistureSolution,
} from "./moisture";
import { PEOPLE_ACTIVITY } from "./ventilation";
import { stdPressurePsia, humidityRatio, satPressurePsia } from "./psychrometrics";

/**
 * Moisture Removal Analysis.
 *
 * The balance under all of it: `REMOVED = generated + ṁ·(W_out − W_in)`. These
 * pin the two air states it rests on, the sign of the outdoor-air term (which is
 * the whole commercial point), and the refusals.
 */

/** A Manila comfort job: 34 °C / 70% outside held at 24 °C / 55% inside. */
const manila: MoistureInput = {
  outdoorTemp: 34, outdoorRh: 70,
  indoorTemp: 24, indoorRh: 55,
  tempUnit: "c",
  altitude: 0, altitudeUnit: "m",
  ventAirflow: 1000, ventUnit: "cfm",
  people: 0, activity: "seated",
  process: null, processUnit: "kgh",
  other: null, otherUnit: "kgh",
  basis: "carrier",
};

const solve = (over: Partial<MoistureInput> = {}): MoistureSolution => {
  const r = solveMoisture({ ...manila, ...over });
  if (r === null || isMoistureError(r)) throw new Error(`expected a solution, got ${JSON.stringify(r)}`);
  return r;
};
const errorOf = (over: Partial<MoistureInput>): string => {
  const r = solveMoisture({ ...manila, ...over });
  if (!isMoistureError(r)) throw new Error("expected a refusal");
  return r.error;
};
const gain = (s: MoistureSolution, key: string) => s.gains.find((g) => g.key === key);

describe("the two air states", () => {
  /** Everything downstream is these two numbers, so they are pinned directly. */
  it("reads Manila outdoor air at about 166 gr/lb and the room at about 72", () => {
    const s = solve();
    expect(s.outdoorGrains).toBeCloseTo(166, 0);
    expect(s.indoorGrains).toBeCloseTo(72, 0);
    expect(s.deltaGrains).toBeCloseTo(94.5, 1);
  });

  it("agrees with the shared psychrometrics rather than keeping its own copy", () => {
    const s = solve();
    const p = stdPressurePsia(0);
    expect(s.outdoorW).toBeCloseTo(humidityRatio(34 * 1.8 + 32, 0.7, p), 10);
    expect(s.indoorW).toBeCloseTo(humidityRatio(24 * 1.8 + 32, 0.55, p), 10);
  });

  /**
   * RELATIVE humidity is not moisture content: the same air heated reads a lower
   * RH while carrying exactly the same water. If this ever stops holding, the
   * tool is reporting RH dressed up as a moisture load.
   */
  it("holds the humidity ratio flat when the same air is merely heated", () => {
    const p = stdPressurePsia(0);
    const w = humidityRatio(75, 0.6, p);
    // The RH that the SAME water shows at 95 °F, derived rather than scanned for:
    // vapour pressure is fixed by the water, so rh = pw / psat(95).
    const pw = (p * w) / (0.621945 + w);
    const rh = pw / satPressurePsia(95);
    expect(humidityRatio(95, rh, p)).toBeCloseTo(w, 9);
    expect(rh).toBeLessThan(0.6); // …at a visibly lower RH
  });
});

describe("the dew point, which decides whether a coil can work at all", () => {
  it("is the temperature at which the air is saturated", () => {
    const p = stdPressurePsia(0);
    const w = humidityRatio(80, 0.5, p);
    const dp = dewPointF(w, p);
    // At its own dew point the air is at 100% RH, carrying the same water.
    expect(humidityRatio(dp, 1, p)).toBeCloseTo(w, 6);
  });

  it("puts a 24 °C / 55% room at about 14 °C", () => {
    expect(fToC(solve().indoorDewPointF)).toBeCloseTo(14.2, 0);
  });

  /** Saturated air is at its dew point already. */
  it("equals the dry bulb at 100% RH", () => {
    expect(solve({ indoorRh: 100 }).indoorDewPointF).toBeCloseTo(24 * 1.8 + 32, 1);
  });

  it("is colder for drier air", () => {
    expect(solve({ indoorRh: 40 }).indoorDewPointF).toBeLessThan(solve({ indoorRh: 60 }).indoorDewPointF);
  });
});

describe("the outdoor-air term, and its sign", () => {
  /**
   * The headline figure: 1,000 cfm of Manila outdoor air is about 660 litres of
   * water a day, before a single person walks in. If this number ever moves,
   * every quotation built on the screen moves with it.
   */
  it("brings in roughly 660 litres a day per 1,000 cfm", () => {
    const s = solve();
    expect(s.ventLbHr).toBeGreaterThan(0);
    expect(s.removalLitresDay).toBeCloseTo(660, -2);
    expect(lbHrToLitresDay(s.removalLbHr)).toBeCloseTo(s.removalLitresDay, 6);
  });

  it("scales with the airflow", () => {
    expect(solve({ ventAirflow: 2000 }).removalLbHr).toBeCloseTo(solve().removalLbHr * 2, 6);
  });

  /**
   * The other sign, and the reason this is a calculator rather than a constant:
   * where the outdoor air is DRIER than the room, ventilation takes water away.
   */
  it("goes NEGATIVE when the outdoor air is drier than the room", () => {
    const dry = solve({ outdoorTemp: 20, outdoorRh: 30, indoorTemp: 28, indoorRh: 80, process: 5, processUnit: "kgh" });
    expect(dry.ventLbHr).toBeLessThan(0);
    expect(gain(dry, "vent")!.label).toMatch(/carries it away/);
    // …and a term that removes takes no share of what is added.
    expect(gain(dry, "vent")!.share).toBe(0);
  });

  it("is zero when no outdoor air is brought in", () => {
    const s = solve({ ventAirflow: 0, people: 10 });
    expect(s.ventLbHr).toBe(0);
    expect(gain(s, "vent")).toBeUndefined();
  });
});

describe("the internal sources", () => {
  it("counts people by their LATENT figure, not their sensible one", () => {
    const s = solve({ ventAirflow: 0, people: 10, activity: "heavy" });
    // 870 BTU/hr each ÷ 1060 BTU/lb.
    expect(s.internalLbHr).toBeCloseTo((10 * 870) / 1060, 6);
  });

  /**
   * Latent OVERTAKES sensible as the work gets harder — a seated person is 245
   * sensible against 155 latent, heavy work 580 against 870. The two lists are
   * the two halves of the same ASHRAE table and must stay in step.
   */
  it("is the other half of the ventilation tool's sensible table", () => {
    expect(PEOPLE_LATENT.map((p) => p.key)).toEqual(PEOPLE_ACTIVITY.map((p) => p.key));
    const seated = PEOPLE_LATENT[0].btuh / PEOPLE_ACTIVITY[0].btuh;
    const heavy = PEOPLE_LATENT[3].btuh / PEOPLE_ACTIVITY[3].btuh;
    expect(seated).toBeLessThan(1); // seated: mostly sensible
    expect(heavy).toBeGreaterThan(1); // heavy work: mostly latent
  });

  it("takes a process figure in kg/h or in litres a day, identically", () => {
    const a = solve({ ventAirflow: 0, process: 24, processUnit: "kgh" });
    const b = solve({ ventAirflow: 0, process: 24 * 24, processUnit: "lday" });
    expect(a.removalLbHr).toBeCloseTo(b.removalLbHr, 6);
  });

  it("adds them all up", () => {
    const s = solve({ ventAirflow: 0, people: 5, activity: "seated", process: 2, processUnit: "kgh", other: 1, otherUnit: "kgh" });
    expect(s.internalLbHr).toBeCloseTo((5 * 155) / 1060 + 3 / 0.45359237, 6);
  });

  it("shares of everything that ADDS come to one", () => {
    const s = solve({ people: 20, process: 3, processUnit: "kgh" });
    expect(s.gains.filter((g) => g.lbPerHr > 0).reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 10);
  });
});

describe("what the equipment has to do", () => {
  it("is generated plus the outdoor-air term", () => {
    const s = solve({ people: 20, process: 2, processUnit: "kgh" });
    expect(s.removalLbHr).toBeCloseTo(s.internalLbHr + s.ventLbHr, 6);
  });

  it("converts to the units a dehumidifier is sold in", () => {
    const s = solve();
    expect(s.removalKgHr).toBeCloseTo(s.removalLbHr * 0.45359237, 6);
    expect(s.removalLitresDay).toBeCloseTo(s.removalKgHr * 24, 6);
  });

  it("and to the latent load a coil is sized on", () => {
    const s = solve();
    expect(s.latentBtuh).toBeCloseTo(s.removalLbHr * 1060, 6);
    expect(s.latentTons).toBeCloseTo(s.latentBtuh / 12000, 6);
  });

  /**
   * NEVER negative. Where the outdoor air carries off more than the room makes,
   * the answer is "nothing to remove", not a negative dehumidifier.
   */
  it("floors at zero, and says the room will sit drier than asked", () => {
    const s = solve({ outdoorTemp: 18, outdoorRh: 40, indoorTemp: 26, indoorRh: 60 });
    expect(s.ventLbHr).toBeLessThan(0);
    expect(s.removalLbHr).toBe(0);
    expect(s.surplus).toBe(true);
    expect(s.latentBtuh).toBe(0);
  });
});

describe("can a fan do it instead?", () => {
  /**
   * The question asked on every damp-building job, and the answer the customer
   * has to be shown rather than told.
   */
  it("refuses dilution when the outdoor air is not drier than the target", () => {
    const s = solve();
    expect(s.dilutionCfm).toBeNull();
    expect(s.dilutionRefusal).toMatch(/cannot dry it/);
    expect(s.dilutionRefusal).toMatch(/coil or a dehumidifier, not a bigger fan/);
  });

  /** …and sizes it when the room really is wetter than outside. */
  it("sizes the airflow for a wet process in drier air", () => {
    const s = solve({ outdoorTemp: 20, outdoorRh: 40, indoorTemp: 30, indoorRh: 70, ventAirflow: 0, process: 5, processUnit: "kgh" });
    expect(s.dilutionRefusal).toBeNull();
    expect(s.dilutionCfm).toBeGreaterThan(0);
    // Feed that airflow back in and the room holds: removal falls to nothing.
    const back = solve({ outdoorTemp: 20, outdoorRh: 40, indoorTemp: 30, indoorRh: 70, ventAirflow: s.dilutionCfm!, process: 5, processUnit: "kgh" });
    expect(back.removalLbHr).toBeCloseTo(0, 6);
  });

  it("needs no air at all when nothing is generated", () => {
    expect(solve({ outdoorTemp: 20, outdoorRh: 30, indoorTemp: 28, indoorRh: 80, ventAirflow: 500 }).dilutionCfm).toBe(0);
  });
});

describe("what it refuses, and why", () => {
  it("a humidity outside 0–100 is the problem, and is named as the problem", () => {
    expect(errorOf({ outdoorRh: 140 })).toMatch(/0 to 100/);
    expect(errorOf({ indoorRh: -5 })).toMatch(/0 to 100/);
  });

  /**
   * NOTHING moving, which is not the same as nothing ADDING: outdoor air drier
   * than the target with a fan running is a real answer (the room dries), and
   * the first cut of this refusal threw it away. Only a form with no air and no
   * source has nothing to say.
   */
  it("refuses only when no air moves AND nothing inside is wetting the room", () => {
    expect(errorOf({ outdoorTemp: 20, outdoorRh: 30, indoorTemp: 28, indoorRh: 80, ventAirflow: 0 }))
      .toMatch(/Nothing here is moving moisture/);
    // …the same still air, with a source in the room, answers instead.
    expect(solve({ outdoorTemp: 20, outdoorRh: 30, indoorTemp: 28, indoorRh: 80, ventAirflow: 0, process: 2, processUnit: "kgh" }).removalLbHr)
      .toBeGreaterThan(0);
    // …and moving air with no source answers too, because the room dries.
    expect(solve({ outdoorTemp: 20, outdoorRh: 30, indoorTemp: 28, indoorRh: 80, ventAirflow: 500 }).surplus).toBe(true);
  });

  it("an altitude that is not a height above sea level", () => {
    expect(errorOf({ altitude: 99000 })).toMatch(/Altitude looks wrong/);
  });

  it("half a form is a blank, not an error", () => {
    expect(solveMoisture({ ...manila, outdoorTemp: null })).toBeNull();
    expect(solveMoisture({ ...manila, indoorRh: null })).toBeNull();
  });
});

/**
 * Altitude pulls in TWO directions, and the first draft of this file asserted
 * only one of them — that thin air carries less water per cfm, so the load must
 * fall. It rose. Both effects are real:
 *
 *   - less MASS per cfm            (pushes the load DOWN)
 *   - more WATER per pound of dry air at the same temperature and RH, because
 *     `W = 0.622·pw/(p − pw)` and `p` is smaller   (pushes the load UP)
 *
 * At 2,000 m the second wins. Which way the NET goes is not a fact to assert in
 * general, so these pin the two mechanisms instead.
 */
describe("altitude, which cuts both ways", () => {
  const high = () => solve({ altitude: 2000, altitudeUnit: "m" });

  it("carries MORE water per pound of dry air at the same temperature and RH", () => {
    expect(high().outdoorGrains).toBeGreaterThan(solve().outdoorGrains);
    expect(high().indoorGrains).toBeGreaterThan(solve().indoorGrains);
  });

  it("…while moving LESS dry air per cfm", () => {
    expect(high().ventMassLbHr).toBeLessThan(solve().ventMassLbHr);
  });

  it("and drops the pressure the whole calculation stands on", () => {
    expect(high().pressurePsia).toBeLessThan(solve().pressurePsia);
  });
});
