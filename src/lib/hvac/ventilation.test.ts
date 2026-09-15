import { describe, it, expect } from "vitest";
import {
  solveVentilation,
  isVentilationError,
  BTU_PER_HP,
  BTU_PER_WATT,
  PEOPLE_ACTIVITY,
  ROOF_KINDS,
  type VentilationInput,
  type VentilationSolution,
} from "./ventilation";

/**
 * Sizing an exhaust fan.
 *
 * The owner: *"What is the proper computation for an exhaust fan or ventilation
 * fan?"* — two computations, and you install the larger. These tests pin both,
 * the boundary between them, and the two refusals that exist to stop somebody
 * quoting a fan for a job a fan cannot do.
 */

/** The worked example: a 20 × 30 × 6 m fabrication shop. */
const shop: VentilationInput = {
  length: 20, width: 30, height: 6, dimUnit: "m",
  outdoorTemp: 34, targetTemp: 39, tempUnit: "c",
  motorHp: 30, motorLoad: 0.85, motorEfficiency: 0.88,
  people: 20, activity: "machine",
  lightingWatts: 5000,
  roofArea: null, roofKind: "bare-metal",
  otherBtuh: null,
  ach: 8,
};

const solve = (over: Partial<VentilationInput> = {}): VentilationSolution => {
  const r = solveVentilation({ ...shop, ...over });
  if (r === null || isVentilationError(r)) throw new Error(`expected a solution, got ${JSON.stringify(r)}`);
  return r;
};
const errorOf = (over: Partial<VentilationInput>): string => {
  const r = solveVentilation({ ...shop, ...over });
  if (!isVentilationError(r)) throw new Error("expected a refusal");
  return r.error;
};
const gain = (s: VentilationSolution, key: string) => s.gains.find((g) => g.key === key)!;

describe("the room", () => {
  it("volume converts metres to cubic feet", () => {
    expect(solve().volumeFt3).toBeCloseTo(20 * 30 * 6 * 35.3147, 0);
  });

  it("roof area follows the footprint unless it is given", () => {
    expect(solve().roofFt2).toBeCloseTo(600 * 10.7639, 0);
    expect(solve({ roofArea: 400 }).roofFt2).toBeCloseTo(400 * 10.7639, 0);
  });

  it("feet in, feet out — no conversion either way", () => {
    const ft = solve({ length: 65.6168, width: 98.4252, height: 19.685, dimUnit: "ft" });
    expect(ft.volumeFt3).toBeCloseTo(solve().volumeFt3, -1);
  });
});

describe("the heat gain, term by term", () => {
  const s = solve();

  /** Nameplate HP is SHAFT power, so the motor's own losses land in the room too. */
  it("motors divide by efficiency rather than multiply", () => {
    expect(gain(s, "motors").btuh).toBeCloseTo((30 * BTU_PER_HP * 0.85) / 0.88, 0);
    expect(gain(s, "motors").btuh).toBeGreaterThan(30 * BTU_PER_HP * 0.85);
  });

  it("people use the sensible half only", () => {
    expect(gain(s, "people").btuh).toBeCloseTo(20 * 375, 6);
    expect(PEOPLE_ACTIVITY.find((a) => a.key === "machine")!.btuh).toBe(375);
  });

  it("lighting is watts × 3.412", () => {
    expect(gain(s, "lighting").btuh).toBeCloseTo(5000 * BTU_PER_WATT, 6);
  });

  it("the roof is area × its peak figure", () => {
    expect(gain(s, "roof").btuh).toBeCloseTo(600 * 10.7639 * 54, 0);
  });

  /** The commercially interesting fact: a bare roof is most of the load. */
  it("and on a bare metal roof it is three quarters of everything", () => {
    expect(gain(s, "roof").share).toBeGreaterThan(0.7);
  });

  it("insulating that roof takes the total down by more than half", () => {
    expect(solve({ roofKind: "insulated" }).totalBtuh).toBeLessThan(s.totalBtuh * 0.45);
  });

  it("a source left blank simply does not appear", () => {
    const bare = solve({ motorHp: null, people: null, lightingWatts: null, otherBtuh: null });
    expect(bare.gains.map((g) => g.key)).toEqual(["roof"]);
    expect(bare.gains[0].share).toBe(1);
  });

  it("shares always add to one", () => {
    expect(s.gains.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 10);
  });
});

describe("the two computations", () => {
  it("heat balance is Q ÷ (1.08 × ΔT)", () => {
    const s = solve();
    expect(s.deltaTF).toBeCloseTo(9, 6); // 5 °C of rise
    expect(s.heatCfm).toBeCloseTo(s.totalBtuh / (1.08 * 9), 4);
  });

  it("air changes is volume × ACH ÷ 60", () => {
    const s = solve();
    expect(s.achCfm).toBeCloseTo((s.volumeFt3 * 8) / 60, 4);
  });

  it("the answer is the larger of the two, and says which", () => {
    const s = solve();
    expect(s.requiredCfm).toBe(Math.max(s.heatCfm, s.achCfm));
    expect(s.governedBy).toBe("heat");
  });

  /** A cool store with nothing running: the air-change minimum takes over. */
  it("air changes govern when there is little heat", () => {
    const s = solve({ motorHp: null, people: 2, lightingWatts: 500, roofKind: "insulated", ach: 10 });
    expect(s.governedBy).toBe("air-changes");
    expect(s.requiredCfm).toBeCloseTo(s.achCfm, 6);
  });

  it("and the resulting ACH is reported back for the figure actually installed", () => {
    const s = solve();
    expect(s.resultingAch).toBeCloseTo((s.requiredCfm * 60) / s.volumeFt3, 6);
    expect(s.resultingAch).toBeGreaterThan(8); // heat governed, so above the 8 asked for
  });

  /** Halve the allowed rise and the fan doubles — the point of the whole tool. */
  it("the airflow is inversely proportional to the rise you allow", () => {
    const loose = solve({ targetTemp: 44 }); // +10 °C
    const tight = solve({ targetTemp: 39 }); // +5 °C
    expect(tight.heatCfm / loose.heatCfm).toBeCloseTo(2, 2);
  });
});

describe("the worked example lands where it did by hand", () => {
  const s = solve();
  it("total gain ≈ 447,000 BTU/hr — 37 tons of it", () => {
    expect(s.totalBtuh).toBeCloseTo(447058, -2);
    expect(s.totalBtuh / 12000).toBeCloseTo(37.3, 1);
  });
  it("heat balance ≈ 46,000 cfm, air changes ≈ 17,000", () => {
    expect(s.heatCfm).toBeCloseTo(45994, -2);
    expect(s.achCfm).toBeCloseTo(16951, -2);
  });
  it("so 46,000 cfm goes in, at about 22 air changes an hour", () => {
    expect(s.requiredCfm).toBeCloseTo(45994, -2);
    expect(s.resultingAch).toBeCloseTo(21.7, 1);
  });
});

describe("what it refuses, and why", () => {
  /**
   * The refusal that earns its place: a fan cannot beat ambient, and finding
   * that out after installation is the expensive way.
   */
  it("a target at or below outdoor is not a fan problem", () => {
    expect(errorOf({ targetTemp: 34 })).toMatch(/cannot cool below the outdoor air/);
    expect(errorOf({ targetTemp: 24 })).toMatch(/refrigeration/);
  });

  it("nor is a rise so tight the airflow runs away", () => {
    expect(errorOf({ targetTemp: 34.5 })).toMatch(/2–3 °C/);
  });

  it("a room with no heat in it needs no heat balance", () => {
    expect(errorOf({ motorHp: null, people: null, lightingWatts: null, roofKind: "none", otherBtuh: null }))
      .toMatch(/at least one heat source/);
  });

  it("and a room with no size is not a room", () => {
    expect(errorOf({ height: 0 })).toMatch(/all three dimensions/);
  });

  it("half a form is a blank, not an error", () => {
    expect(solveVentilation({ ...shop, length: null })).toBeNull();
    expect(solveVentilation({ ...shop, outdoorTemp: null })).toBeNull();
  });
});

describe("the figures on the pick-lists", () => {
  it("a bare metal roof is many times an insulated one", () => {
    const bare = ROOF_KINDS.find((r) => r.key === "bare-metal")!.btuhFt2;
    const ins = ROOF_KINDS.find((r) => r.key === "insulated")!.btuhFt2;
    expect(bare / ins).toBeGreaterThan(5);
  });

  it("and heavier work means more heat per person", () => {
    const b = PEOPLE_ACTIVITY.map((a) => a.btuh);
    expect([...b].sort((x, y) => x - y)).toEqual(b);
  });
});
