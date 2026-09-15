import { describe, it, expect } from "vitest";
import {
  airDensity,
  basisDef,
  densityFactor,
  enthalpy,
  heatConstants,
  humidityRatio,
  isAirHeatError,
  MASS_PER_CFM,
  solveAirHeat,
  toBtuh,
  type AirHeatInput,
  type AirHeatSolution,
} from "./psychrometrics";

/**
 * Air-side heat.
 *
 * The constants are DERIVED from one density and one pair of air properties, so
 * the tests check the derivation, not the arithmetic of numbers already typed
 * in: if `4.5 × 0.240` ever stops giving 1.08, the relationship has broken and
 * that is worth a failing test.
 */
const base: AirHeatInput = {
  mode: "heat",
  airflow: 2000,
  airflowUnit: "cfm",
  tempUnit: "f",
  humidityUnit: "rh",
  entering: { temp: 80, humidity: 50 },
  leaving: { temp: 55, humidity: 95 },
  basis: "carrier",
  altitude: 0,
  altitudeUnit: "ft",
  flowTemp: 70,
};
const solve = (over: Partial<AirHeatInput> = {}): AirHeatSolution => {
  const r = solveAirHeat({ ...base, ...over });
  if (r === null || isAirHeatError(r)) throw new Error(`expected a solution, got ${JSON.stringify(r)}`);
  return r;
};

describe("the constants come from one place", () => {
  it("mass flow is the whole story: 0.075 lb/ft³ × 60 min", () => {
    expect(MASS_PER_CFM).toBeCloseTo(4.5, 10);
  });

  it("Carrier: 4.5 × 0.240 = 1.08, and 4.5 × 1060/7000 = 0.68", () => {
    const c = heatConstants("carrier");
    expect(c.sensible).toBe(1.08);
    expect(c.latentGrains).toBe(0.68);
    expect(c.total).toBe(4.5);
  });

  it("ASHRAE: 4.5 × 0.244 = 1.10, and 4.5 × 1076/7000 = 0.69", () => {
    const c = heatConstants("ashrae");
    expect(c.sensible).toBe(1.1);
    expect(c.latentGrains).toBe(0.69);
    expect(c.total).toBe(4.5);
  });

  /**
   * The point of a basis rather than a loose number: pairing 1.08 with 0.69
   * would take the specific heat from Carrier and the latent heat from ASHRAE.
   */
  it("a basis moves every constant together", () => {
    expect(basisDef("carrier").cp).toBe(0.24);
    expect(basisDef("carrier").hfg).toBe(1060);
    expect(basisDef("ashrae").cp).toBe(0.244);
    expect(basisDef("ashrae").hfg).toBe(1076);
  });

  it("an unknown basis falls back rather than throwing", () => {
    expect(basisDef("nonsense" as never).key).toBe("carrier");
  });
});

describe("density", () => {
  /**
   * Standard air is DEFINED as exactly 0.075 lb/ft³; the ideal gas law at the
   * same point gives 0.07489. The factor ratios against the formula, not the
   * definition, so "standard" comes out at exactly 1 — otherwise a user who
   * touched nothing would be shown 4.49 where they expect 4.5.
   */
  it("standard conditions are exactly 1, definitional gap and all", () => {
    expect(airDensity(0, 70)).toBeCloseTo(0.07489, 5);
    expect(densityFactor(0, 70)).toBe(1);
    expect(heatConstants("carrier", densityFactor(0, 70))).toEqual({ sensible: 1.08, latentGrains: 0.68, total: 4.5 });
  });

  /** The case that makes this field worth having on the screen. */
  it("Baguio at ~1500 m is 17% down", () => {
    expect(densityFactor(4900, 70)).toBeCloseTo(0.835, 3);
  });

  it("hot air is thin air — a dryer exhaust at 150 °F", () => {
    expect(densityFactor(0, 150)).toBeCloseTo(0.869, 3);
  });

  it("and the constants move with it", () => {
    const hot = heatConstants("carrier", densityFactor(0, 150));
    expect(hot.sensible).toBeLessThan(1.08);
    expect(hot.sensible).toBeCloseTo(0.94, 2);
  });

  it("a load worked at altitude is smaller than the same one at sea level", () => {
    expect(solve({ altitude: 4900 }).sensible).toBeLessThan(solve({ altitude: 0 }).sensible);
  });
});

describe("humidity, as an instrument reads it", () => {
  it("80 °F at 50% RH is 76.5 gr/lb", () => {
    expect(humidityRatio(80, 0.5, 14.696) * 7000).toBeCloseTo(76.5, 1);
  });

  it("95 °F at 60% RH — a Manila afternoon — is 150 gr/lb", () => {
    expect(humidityRatio(95, 0.6, 14.696) * 7000).toBeCloseTo(150.1, 1);
  });

  it("enthalpy of that afternoon air is 46.4 BTU/lb", () => {
    expect(enthalpy(95, humidityRatio(95, 0.6, 14.696))).toBeCloseTo(46.45, 2);
  });

  it("grains can be typed straight in", () => {
    const s = solve({ humidityUnit: "grains", entering: { temp: 80, humidity: 76.47 }, leaving: { temp: 55, humidity: 61.1 } });
    expect(s.enteringGrains).toBeCloseTo(76.47, 2);
  });

  it("and g/kg is exactly seven times grains", () => {
    const s = solve({ humidityUnit: "gkg", entering: { temp: 80, humidity: 10 }, leaving: { temp: 55, humidity: 8 } });
    expect(s.enteringGrains).toBeCloseTo(70, 6);
  });
});

describe("the worked example on the page", () => {
  /** 2000 cfm, room 80 °F/50% RH → supply 55 °F/95% RH, Carrier basis. */
  const s = solve();

  it("sensible = 1.08 × 2000 × 25", () => {
    expect(s.sensible).toBeCloseTo(54000, 0);
    expect(s.deltaTF).toBeCloseTo(25, 6);
  });

  it("latent = 0.68 × 2000 × 15.37", () => {
    expect(s.latent!).toBeCloseTo(20903, 0);
  });

  it("total is the two of them, so the screen adds up", () => {
    expect(s.total).toBeCloseTo(s.sensible + s.latent!, 6);
    expect(s.total).toBeCloseTo(74903, 0);
  });

  it("SHR is sensible over that same total", () => {
    expect(s.shr!).toBeCloseTo(0.721, 3);
  });

  it("ASHRAE reads about 1.8% higher", () => {
    expect(solve({ basis: "ashrae" }).sensible / s.sensible).toBeCloseTo(1.0185, 3);
  });
});

describe("the enthalpy cross-check", () => {
  it("is absent until both enthalpies are given", () => {
    expect(solve().crossCheck).toBeNull();
    expect(solve({ entering: { temp: 80, humidity: 50, enthalpy: 31.18 } }).crossCheck).toBeNull();
  });

  /**
   * The gap is the constants' own simplification, not an error: 0.68 uses a
   * single latent heat while the two states sit at different temperatures.
   */
  it("names the ~2% gap on the Carrier basis", () => {
    const c = solve({
      entering: { temp: 80, humidity: 50, enthalpy: 31.179 },
      leaving: { temp: 55, humidity: 95, enthalpy: 22.674 },
    }).crossCheck!;
    expect(c.total).toBeCloseTo(76545, 0);
    expect(c.gapPct).toBeCloseTo(-2.15, 1);
  });

  it("and shrinks to well under 1% on the ASHRAE basis", () => {
    const c = solve({
      basis: "ashrae",
      entering: { temp: 80, humidity: 50, enthalpy: 31.179 },
      leaving: { temp: 55, humidity: 95, enthalpy: 22.674 },
    }).crossCheck!;
    expect(Math.abs(c.gapPct)).toBeLessThan(1);
  });
});

describe("units in, same answer out", () => {
  it("m³/h and L/s agree with cfm", () => {
    const a = solve().sensible;
    expect(solve({ airflow: 2000 * 1.69901082, airflowUnit: "m3hr" }).sensible).toBeCloseTo(a, 6);
    expect(solve({ airflow: 2000 / 2.11888, airflowUnit: "lps" }).sensible).toBeCloseTo(a, 6);
  });

  /** A temperature DIFFERENCE is not a temperature — both states convert first. */
  it("°C states give the same ΔT in °F", () => {
    const s = solve({
      tempUnit: "c",
      entering: { temp: (80 - 32) / 1.8, humidity: 50 },
      leaving: { temp: (55 - 32) / 1.8, humidity: 95 },
      flowTemp: (70 - 32) / 1.8,
    });
    expect(s.deltaTF).toBeCloseTo(25, 6);
    expect(s.sensible).toBeCloseTo(54000, 0);
  });

  it("metres and feet describe the same mountain", () => {
    expect(solve({ altitude: 1493.5, altitudeUnit: "m" }).densityFactor)
      .toBeCloseTo(solve({ altitude: 4900, altitudeUnit: "ft" }).densityFactor, 4);
  });
});

describe("a half-filled form says nothing, a wrong one says what", () => {
  it("nothing yet — no error, no answer", () => {
    expect(solveAirHeat({ ...base, airflow: null })).toBeNull();
    expect(solveAirHeat({ ...base, entering: { temp: null, humidity: 50 } })).toBeNull();
  });

  it("zero airflow is a mistake, not a blank", () => {
    const r = solveAirHeat({ ...base, airflow: 0 });
    expect(isAirHeatError(r) && r.error).toMatch(/greater than zero/);
  });

  it("humidity for one state only cannot be halved into an answer", () => {
    const r = solveAirHeat({ ...base, leaving: { temp: 55, humidity: null } });
    expect(isAirHeatError(r) && r.error).toMatch(/both air states/);
  });

  it("RH over 100 is refused rather than quietly clamped", () => {
    const r = solveAirHeat({ ...base, entering: { temp: 80, humidity: 140 } });
    expect(isAirHeatError(r) && r.error).toMatch(/0 to 100/);
  });

  it("an absurd altitude is refused", () => {
    expect(isAirHeatError(solveAirHeat({ ...base, altitude: 90000 }))).toBe(true);
  });

  /** Heating, or plain ventilation: no humidity anywhere, and that is fine. */
  it("sensible-only still answers, with no latent and no SHR", () => {
    const s = solve({ entering: { temp: 80, humidity: null }, leaving: { temp: 55, humidity: null } });
    expect(s.latent).toBeNull();
    expect(s.shr).toBeNull();
    expect(s.total).toBeCloseTo(s.sensible, 6);
  });

  /** Heating: the leaving air is warmer, so the sensible heat is negative. */
  it("a heating coil reads negative rather than refusing", () => {
    const s = solve({ entering: { temp: 60, humidity: null }, leaving: { temp: 95, humidity: null } });
    expect(s.sensible).toBeCloseTo(-75600, 0);
  });
});

/**
 * The reverse: a load and a temperature difference, find the airflow.
 *
 * The owner, after using the forward one: *"Add the reverse solve for required
 * CFM."* It is the commoner question on a real job — you are given a room load
 * and a supply temperature and what you need is the fan.
 *
 * It shares the forward mode's code from `cfm` onwards, and these tests exist to
 * prove that sharing holds: the airflow it gives back, fed into the forward
 * mode, must return the load it was asked for.
 */
describe("solving backwards for the airflow", () => {
  const rev = (over: Partial<AirHeatInput> = {}): AirHeatSolution => {
    const r = solveAirHeat({ ...base, mode: "airflow", airflow: null, load: 24000, loadUnit: "btuh", ...over });
    if (r === null || isAirHeatError(r)) throw new Error(`expected a solution, got ${JSON.stringify(r)}`);
    return r;
  };

  it("24,000 BTU/hr across 25 °F needs 889 cfm", () => {
    // 24000 / (1.08 × 25) = 888.9
    expect(rev().cfm).toBeCloseTo(888.9, 1);
  });

  /** The round trip. If these ever disagree, the two modes have drifted apart. */
  it("round-trips: put that airflow back in and the load comes out", () => {
    const cfm = rev().cfm;
    const forward = solveAirHeat({ ...base, airflow: cfm });
    if (forward === null || isAirHeatError(forward)) throw new Error("no forward solution");
    expect(forward.sensible).toBeCloseTo(24000, 6);
  });

  it("the solved airflow carries the latent and total heat those air states imply", () => {
    const s = rev();
    expect(s.latent).toBeCloseTo(s.constants.latentGrains * s.cfm * (s.enteringGrains! - s.leavingGrains!), 6);
    expect(s.total).toBeCloseTo(s.sensible + s.latent!, 6);
    expect(s.shr!).toBeCloseTo(0.721, 3);
  });

  it("a bigger constant needs less air for the same load", () => {
    expect(rev({ basis: "ashrae" }).cfm).toBeLessThan(rev({ basis: "carrier" }).cfm);
  });

  /** Thin air carries less heat per cfm, so the fan has to move more of it. */
  it("and thin air needs more", () => {
    expect(rev({ altitude: 4900 }).cfm).toBeGreaterThan(rev({ altitude: 0 }).cfm);
  });

  describe("the load, in whatever the job sheet used", () => {
    it("tons and kW land on the same airflow as BTU/hr", () => {
      const a = rev().cfm;
      expect(rev({ load: 2, loadUnit: "tons" }).cfm).toBeCloseTo(a, 6);
      expect(rev({ load: 24000 * 1055.05585 / 3600 / 1000, loadUnit: "kw" }).cfm).toBeCloseTo(a, 6);
    });
    it("and the conversions are what they claim", () => {
      expect(toBtuh(1, "tons")).toBe(12000);
      expect(toBtuh(1, "kw")).toBeCloseTo(3412.14, 2);
      expect(toBtuh(500, "btuh")).toBe(500);
    });
  });

  /**
   * A job sheet says "24,000 BTU/hr" whether the coil heats or cools. Refusing a
   * heating load over a sign the user never typed would be pedantry.
   */
  it("a heating coil is the same sum", () => {
    const s = rev({ entering: { temp: 60, humidity: null }, leaving: { temp: 95, humidity: null } });
    expect(s.cfm).toBeCloseTo(24000 / (1.08 * 35), 6);
    expect(s.sensible).toBeCloseTo(-24000, 6); // negative: heat going IN, as in the forward mode
  });

  describe("what it refuses", () => {
    it("no load yet is a blank, not an error", () => {
      expect(solveAirHeat({ ...base, mode: "airflow", airflow: null, load: null })).toBeNull();
    });

    /** The division by zero, said in words rather than as Infinity cfm. */
    it("equal temperatures cannot carry a load at any airflow", () => {
      const r = solveAirHeat({ ...base, mode: "airflow", airflow: null, load: 24000, leaving: { temp: 80, humidity: 95 } });
      expect(isAirHeatError(r) && r.error).toMatch(/different temperatures/);
    });

    it("a zero load is a mistake, not a blank", () => {
      const r = solveAirHeat({ ...base, mode: "airflow", airflow: null, load: 0 });
      expect(isAirHeatError(r) && r.error).toMatch(/sensible load/);
    });

    it("and the airflow box is ignored entirely in this mode", () => {
      expect(rev({ airflow: 99999 }).cfm).toBeCloseTo(888.9, 1);
    });
  });
});
