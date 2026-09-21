import { describe, it, expect } from "vitest";
import {
  solveMoisture,
  isMoistureError,
  dewPointF,
  apparatusDewPoint,
  shallowestOffCoilRh,
  lbHrToLitresDay,
  PEOPLE_LATENT,
  fToC,
  type MoistureInput,
  type MoistureSolution,
  type CoilSolution,
} from "./moisture";
import { PEOPLE_ACTIVITY } from "./ventilation";
import {
  stdPressurePsia,
  humidityRatio,
  satPressurePsia,
  densityFactor,
  MASS_PER_CFM,
} from "./psychrometrics";

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

/** The same job with the coil block switched on. Off-coil 13 °C at 95% RH. */
const coilOf = (over: Partial<MoistureInput> = {}): CoilSolution => {
  const s = solve({ offCoilTemp: 13, offCoilRh: 95, ...over });
  if (!s.coil) throw new Error(`expected a coil, got refusal: ${s.coilRefusal}`);
  return s.coil;
};
const coilRefusalOf = (over: Partial<MoistureInput>): string => {
  const s = solve({ offCoilTemp: 13, offCoilRh: 95, ...over });
  if (!s.coilRefusal) throw new Error("expected a coil refusal");
  return s.coilRefusal;
};

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
 * The coil.
 *
 * Left out of the first cut on the stated grounds that bypass factor "needs coil
 * geometry". It does not, and these pin the construction that shows it doesn't:
 * a straight line between two air states, carried on to the saturation curve.
 */
describe("the coil — apparatus dew point and bypass factor", () => {
  /**
   * The definition, asserted directly rather than through a worked example: the
   * apparatus dew point is a SATURATED state, and it is ON the line between the
   * two air states. Those two facts are the whole construction.
   */
  it("lands on the saturation curve, and on the process line", () => {
    const c = coilOf();
    const p = stdPressurePsia(0);
    // Saturated: its humidity ratio is the most that air can hold at that temperature.
    expect(humidityRatio(c.adpF, 1, p)).toBeCloseTo(c.adpW, 8);
    // Collinear with on-coil and off-coil.
    const slope = (c.enteringW - c.leavingW) / (c.enteringTempF - c.leavingTempF);
    expect(c.leavingW + slope * (c.adpF - c.leavingTempF)).toBeCloseTo(c.adpW, 10);
  });

  it("sits below the off-coil temperature, which sits below the on-coil", () => {
    const c = coilOf();
    expect(c.adpF).toBeLessThan(c.leavingTempF);
    expect(c.leavingTempF).toBeLessThan(c.enteringTempF);
  });

  /**
   * The number the owner asked for, on the job this screen opens with: a 24 °C /
   * 55% room recirculated through a coil leaving at 13 °C / 95%.
   */
  it("puts a 24 °C room on a 13 °C coil at about a 12 °C ADP and a 0.10 bypass", () => {
    const c = coilOf();
    expect(fToC(c.adpF)).toBeCloseTo(11.8, 0);
    expect(c.bypassFactor).toBeCloseTo(0.1, 1);
    expect(c.contactFactor).toBeCloseTo(1 - c.bypassFactor, 10);
  });

  /** The definition of bypass factor, in temperature and in humidity ratio alike. */
  it("reads the same bypass factor off the temperatures and off the humidity ratios", () => {
    const c = coilOf();
    const byTemp = (c.leavingTempF - c.adpF) / (c.enteringTempF - c.adpF);
    const byW = (c.leavingW - c.adpW) / (c.enteringW - c.adpW);
    expect(c.bypassFactor).toBeCloseTo(byTemp, 12);
    expect(c.bypassFactor).toBeCloseTo(byW, 8);
  });

  it("is a perfect coil — bypass zero — when the air leaves saturated", () => {
    const c = coilOf({ offCoilRh: 100 });
    expect(c.bypassFactor).toBeCloseTo(0, 10);
    expect(c.adpF).toBeCloseTo(c.leavingTempF, 8);
  });

  /** More bypass is drier-leaving air at the same temperature, and a colder surface. */
  it("needs a colder surface, and bypasses more air, as the off-coil air gets drier", () => {
    const wet = coilOf({ offCoilRh: 98 });
    const dry = coilOf({ offCoilRh: 88 });
    expect(dry.adpF).toBeLessThan(wet.adpF);
    expect(dry.bypassFactor).toBeGreaterThan(wet.bypassFactor);
  });

  it("takes the on-coil air from the room or from outdoors, as asked", () => {
    expect(coilOf({ coilEntering: "room" }).enteringGrains).toBeCloseTo(solve().indoorGrains, 8);
    // 34 °C / 70% cooled to 13 °C is far too deep a line to meet saturation, so
    // the outdoor case is checked on a coil that can actually do it.
    const doas = solve({ coilEntering: "outdoor", offCoilTemp: 24, offCoilRh: 95 });
    expect(doas.coil!.enteringGrains).toBeCloseTo(solve().outdoorGrains, 8);
  });

  /**
   * The tie back to the water balance: this is the air that has to cross the
   * coil to take out the litres the rest of the screen just counted.
   */
  it("sizes the airflow across the coil from the day's water", () => {
    const s = solve({ offCoilTemp: 13, offCoilRh: 95 });
    const c = s.coil!;
    expect(c.coilCfm).toBeGreaterThan(0);
    // Put the airflow back through the coil and it removes exactly the balance —
    // the mass it carries, times the water it drops per pound.
    const mass = c.coilCfm! * MASS_PER_CFM * densityFactor(0, c.enteringTempF);
    expect(mass * (c.enteringW - c.leavingW)).toBeCloseTo(s.removalLbHr, 6);
  });

  it("has no airflow to quote when there is no water to remove", () => {
    const s = solve({
      outdoorTemp: 18, outdoorRh: 40, indoorTemp: 26, indoorRh: 60,
      offCoilTemp: 13, offCoilRh: 95,
    });
    expect(s.surplus).toBe(true);
    expect(s.coil!.coilCfm).toBeNull();
  });

  /**
   * The grand sensible heat ratio: the coil's OWN split, not the room's. It
   * falls as the coil is asked to leave the air drier, because that is latent
   * work — the same 19.8 °F of cooling doing more of it.
   */
  it("reports the coil's sensible share, which falls as it is asked to leave drier air", () => {
    const wet = coilOf({ offCoilRh: 98 });
    const dry = coilOf({ offCoilRh: 88 });
    expect(dry.gshr).toBeLessThan(wet.gshr);
    for (const c of [wet, dry]) {
      expect(c.gshr).toBeGreaterThan(0);
      expect(c.gshr).toBeLessThan(1);
    }
  });
});

describe("what the coil block refuses, and why", () => {
  it("an off-coil temperature at or above the on-coil air", () => {
    expect(coilRefusalOf({ offCoilTemp: 24 })).toMatch(/leave the coil colder than it arrives/);
    expect(coilRefusalOf({ offCoilTemp: 30 })).toMatch(/room air at 24 °C/);
  });

  it("an off-coil humidity outside 0–100", () => {
    expect(coilRefusalOf({ offCoilRh: 130 })).toMatch(/0 to 100/);
  });

  /**
   * The case that matters commercially, and the one that sends you to a
   * desiccant: the line from on-coil to off-coil passes UNDER the saturation
   * curve without touching it. No single saturated surface produces that leaving
   * state, so there is no apparatus dew point to report — and inventing one
   * would be the worst possible answer.
   */
  it("a duty too deep and too latent for one coil — no apparatus dew point exists", () => {
    const why = coilRefusalOf({ coilEntering: "outdoor", offCoilTemp: 13, offCoilRh: 95 });
    expect(why).toMatch(/No apparatus dew point/);
    expect(why).toMatch(/overcooling and reheat|desiccant/);
    // …and the function underneath says the same thing with a null, not a number.
    const p = stdPressurePsia(0);
    expect(
      apparatusDewPoint(93.2, humidityRatio(93.2, 0.7, p), 55.4, humidityRatio(55.4, 0.95, p), p),
    ).toBeNull();
  });

  /**
   * …and it does not stop at "no". The duty is ordinary — it is the 95% that is
   * wrong, because deep dehumidification leaves air all but saturated. Without
   * this the screen refuses every off-coil humidity anyone would think to type
   * and reads as "impossible", which is both discouraging and untrue.
   */
  it("says what off-coil humidity WOULD have one, rather than stopping at no", () => {
    const why = coilRefusalOf({ coilEntering: "outdoor", offCoilTemp: 17, offCoilRh: 95 });
    expect(why).toMatch(/shallowest one coil can leave it/);

    const p = stdPressurePsia(0);
    const onF = 34 * 1.8 + 32;
    const onW = humidityRatio(onF, 0.7, p);
    const offF = 17 * 1.8 + 32;
    const rh = shallowestOffCoilRh(onF, onW, offF, 95, p)!;
    expect(rh).toBeGreaterThan(95);
    expect(rh).toBeLessThanOrEqual(100);
    // It is a THRESHOLD: just above it there is an ADP, just below it there is not.
    const at = (r: number) =>
      apparatusDewPoint(onF, onW, offF, humidityRatio(offF, r / 100, p), p);
    expect(at(rh + 0.05)).not.toBeNull();
    expect(at(rh - 0.05)).toBeNull();
  });

  it("an off-coil state wetter than the air arriving", () => {
    expect(coilRefusalOf({ indoorRh: 20, offCoilTemp: 13, offCoilRh: 95 }))
      .toMatch(/leave the coil WETTER/);
  });

  it("is simply absent when nothing was asked — the rest of the screen is unchanged", () => {
    const s = solve();
    expect(s.coil).toBeNull();
    expect(s.coilRefusal).toBeNull();
    expect(s.removalLitresDay).toBeCloseTo(solve({ offCoilTemp: 13 }).removalLitresDay, 10);
  });

  /** A refusal is about the COIL, and must not take the water balance down with it. */
  it("leaves the water balance standing when the coil cannot be solved", () => {
    const s = solve({ coilEntering: "outdoor", offCoilTemp: 13 });
    expect(s.coil).toBeNull();
    expect(s.coilRefusal).toBeTruthy();
    expect(s.removalLitresDay).toBeCloseTo(660, -2);
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
