import { describe, it, expect } from "vitest";
import { solvePressurization, isPressError, maxPaForDoorForce, doorForce, PRESS_SAMPLE, type PressResult } from "./pressurization";
import { solvePlume, solveAch, isSmokeError, PLUME_SAMPLE, ACH_SAMPLE, type PlumeResult, type AchResult } from "./smoke-exhaust";

const press = (patch: Partial<typeof PRESS_SAMPLE> = {}) => {
  const r = solvePressurization({ ...PRESS_SAMPLE, ...patch });
  if (isPressError(r)) throw new Error(r.error);
  return r as PressResult;
};

describe("stair pressurization — the 15-storey sample", () => {
  const r = press();
  it("one row per floor, G to L15", () => {
    expect(r.rows.map((x) => x.name)).toEqual(["G", ...Array.from({ length: 15 }, (_, i) => `L${i + 1}`)]);
  });
  it("hot day: the top floor holds the design 50 Pa, stack effect lifts the bottom by 3460·H·(1/To − 1/Ti)", () => {
    const stack = Math.abs(3460 * 52.5 * (1 / 305.15 - 1 / 299.15));
    expect(r.stackPa).toBeCloseTo(stack, 1);
    expect(r.rows[15].dpPa).toBe(50);
    expect(r.rows[0].dpPa).toBeCloseTo(50 + stack, 1);
    expect(r.highestAtBottom).toBe(true);
  });
  it("door force: 40 N closer + W·A·ΔP / 2(W − d); 100 N allows 58.2 Pa on a 0.9 × 2.1 m door", () => {
    expect(maxPaForDoorForce(100, 40, 0.9, 2.1)).toBeCloseTo(58.2, 1);
    expect(doorForce(50, 40, 0.9, 2.1)).toBeCloseTo(40 + (0.9 * 0.9 * 2.1 * 50) / (2 * 0.825), 6);
    expect(r.overFloors).toEqual(r.rows.filter((x) => x.dpPa > 58.2).map((x) => x.name));
    expect(r.overFloors.length).toBeGreaterThan(0);
  });
  it("leakage 0.83·A·√ΔP; the open fire-floor door at 0.75 m/s governs; +15% for the ductwork", () => {
    expect(r.rows[15].leakageM3s).toBeCloseTo(0.83 * 0.01 * Math.sqrt(50), 3);
    expect(r.openDoorM3s).toBeCloseTo(0.75 * 0.9 * 2.1, 2);
    expect(r.governedBy).toBe("door-open");
    expect(r.fanM3s).toBeCloseTo(r.openCaseM3s * 1.15, 1);
    // From the unrounded m³/s, so within one rounding step of the shown figure.
    expect(Math.abs(r.fanCfm - r.fanM3s * 2118.88)).toBeLessThan(11);
  });
  it("fan pressure: the top floor's pressure plus the system losses", () => {
    expect(r.fanPa).toBe(300);
    expect(r.fanInwg).toBeCloseTo(1.2, 1);
  });
  it("relief vent dumps the open-door air at the design pressure", () => {
    expect(r.reliefAreaM2).toBeCloseTo((r.openCaseM3s - r.leakClosedM3s) / (0.83 * Math.sqrt(50)), 1);
  });
});

describe("stair pressurization — other cases", () => {
  it("no stack effect when the stair and outdoors are the same temperature — every floor at design", () => {
    const r = press({ outdoorC: 26, stairC: 26 });
    expect(new Set(r.rows.map((x) => x.dpPa))).toEqual(new Set([50]));
    expect(r.overFloors).toEqual([]);
  });
  it("cold day: the bottom holds design, pressure rises going up, and the fan sees the top", () => {
    const r = press({ outdoorC: 10, stairC: 20 });
    expect(r.highestAtBottom).toBe(false);
    expect(r.rows[0].dpPa).toBe(50);
    expect(r.rows[15].dpPa).toBeGreaterThan(50);
    expect(r.fanPa).toBe(Math.round(50 + r.stackPa + 250));
  });
  it("NFPA 92 (no open-door case): doors-closed leakage governs; no relief vent", () => {
    const r = press({ designPa: 25, minPa: 12.5, doorForceLimitN: 133, openDoorVelocity: 0 });
    expect(r.governedBy).toBe("doors-closed");
    expect(r.openCaseM3s).toBe(0);
    expect(r.reliefAreaM2).toBe(0);
    expect(r.overFloors).toEqual([]);
  });
  it("design below the minimum flags the floors that stay under it", () => {
    const r = press({ designPa: 10, minPa: 12.5, outdoorC: 26, stairC: 26 });
    expect(r.underFloors.length).toBe(16);
  });
  it("refuses impossible input with a reason", () => {
    expect(isPressError(solvePressurization({ ...PRESS_SAMPLE, floors: 0 }))).toBe(true);
    expect(isPressError(solvePressurization({ ...PRESS_SAMPLE, fireFloor: 20 }))).toBe(true);
    expect(isPressError(solvePressurization({ ...PRESS_SAMPLE, closerForceN: 120 }))).toBe(true);
  });
});

describe("smoke exhaust — NFPA 92 axisymmetric plume, the 5 MW mall atrium", () => {
  const r = solvePlume(PLUME_SAMPLE) as PlumeResult;
  it("flame height 0.166·Qc^0.4; mass flow above it 0.071·Qc^⅓·z^5⁄3 + 0.0018·Qc", () => {
    const Qc = 3500;
    expect(r.flameHeightM).toBeCloseTo(0.166 * Math.pow(Qc, 0.4), 2);
    expect(r.massFlowKgs).toBeCloseTo(0.071 * Math.cbrt(Qc) * Math.pow(6, 5 / 3) + 0.0018 * Qc, 1);
  });
  it("hot smoke, low density: ~34 m³/s, ~72,000 CFM; no plugholing at 4 points", () => {
    expect(r.smokeC).toBeGreaterThan(150);
    expect(r.exhaustM3s).toBeCloseTo(33.9, 0);
    expect(r.exhaustCfm).toBeGreaterThan(70000);
    expect(r.plugholing).toBe(false);
    expect(r.minPoints).toBe(1);
    expect(r.fanClassC).toBe(200);
  });
  it("a shallow layer plug-holes: fewer cubic metres per point allowed, more points needed", () => {
    const s = solvePlume({ ...PLUME_SAMPLE, layerDepthM: 1, exhaustPoints: 2 }) as PlumeResult;
    expect(s.plugholing).toBe(true);
    expect(s.minPoints).toBeGreaterThan(2);
  });
  it("below the flame height the near-field formula applies", () => {
    const s = solvePlume({ ...PLUME_SAMPLE, clearHeightM: 2 }) as PlumeResult;
    expect(s.massFlowKgs).toBeCloseTo(0.032 * Math.pow(3500, 0.6) * 2, 1);
  });
  it("make-up air: the same mass at outdoor density, area for 1.02 m/s", () => {
    expect(r.makeupAreaM2).toBeCloseTo(r.makeupM3s / 1.02, 0);
  });
  it("refuses a missing fire", () => {
    expect(isSmokeError(solvePlume({ ...PLUME_SAMPLE, fireKw: 0 }))).toBe(true);
  });
});

describe("smoke exhaust — air changes", () => {
  it("60 × 40 × 3 m car park at 10 ACH → 20 m³/s, split over 2 fans", () => {
    const r = solveAch(ACH_SAMPLE) as AchResult;
    expect(r.volumeM3).toBe(7200);
    expect(r.exhaustM3s).toBe(20);
    expect(r.perFanCfm).toBe(Math.round((20 * 2118.88) / 2));
  });
});
