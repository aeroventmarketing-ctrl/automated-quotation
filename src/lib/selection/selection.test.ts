import { describe, it, expect } from "vitest";
import {
  selectFan,
  selectFans,
  densityFromTemperature,
  suggestMotorHp,
  outletVelocityLimit,
  forwardCurveOvLimit,
  MOTOR_HP_LIST,
  type FanModelInput,
} from "./index";

// A synthetic fan model with a decreasing pressure curve at 1000 rpm.
const model: FanModelInput = {
  id: "m1",
  modelCode: "TEST-100",
  name: "Test Fan 100",
  sizeLabel: '24"',
  ratingPoints: [
    { rpm: 1000, airflow_m3hr: 0, staticPressure_pa: 500, power_kw: 0.5, efficiency: 0 },
    { rpm: 1000, airflow_m3hr: 1000, staticPressure_pa: 450, power_kw: 0.8, efficiency: 0.6 },
    { rpm: 1000, airflow_m3hr: 2000, staticPressure_pa: 350, power_kw: 1.0, efficiency: 0.72 },
    { rpm: 1000, airflow_m3hr: 3000, staticPressure_pa: 200, power_kw: 1.1, efficiency: 0.65 },
    { rpm: 1000, airflow_m3hr: 4000, staticPressure_pa: 0, power_kw: 1.2, efficiency: 0.3 },
  ],
};

describe("selectFan — on-curve duty", () => {
  it("hits a point exactly on the rated curve at ~rated speed", () => {
    const r = selectFan(model, { airflow_m3hr: 2000, staticPressure_pa: 350 })!;
    expect(r).not.toBeNull();
    expect(r.rpm).toBeGreaterThan(980);
    expect(r.rpm).toBeLessThan(1020);
    expect(r.speedRatio).toBeCloseTo(1, 1);
    expect(r.confidence).toBe("HIGH");
    expect(r.withinEnvelope).toBe(true);
    expect(r.requiresEngineerConfirmation).toBe(false);
  });

  it("sizes the motor as BHP/0.75 rounded up to the motor list", () => {
    const r = selectFan(model, { airflow_m3hr: 2000, staticPressure_pa: 350 })!;
    expect(MOTOR_HP_LIST).toContain(r.motorHp);
    expect(r.motorHp).toBeGreaterThanOrEqual(r.bhp / 0.75 - 1e-9);
    expect(r.motorKw).toBeGreaterThan(0);
  });
});

describe("AFBM selection rules", () => {
  it("rounds the motor up: BHP/0.75 then next size in the list", () => {
    expect(suggestMotorHp(1.5)).toBe(2); // 1.5/0.75 = 2.0
    expect(suggestMotorHp(2.1)).toBe(3); // 2.1/0.75 = 2.8 -> 3
    expect(suggestMotorHp(6)).toBe(10); // 6/0.75 = 8 -> 10
  });

  it("applies outlet-velocity limits by wheel diameter", () => {
    expect(outletVelocityLimit(24)).toBe(1800);
    expect(outletVelocityLimit(33)).toBe(2000);
    expect(outletVelocityLimit(44.5)).toBe(3000);
  });

  it("uses 2000 fpm for forward-curve, 2400 fpm for the largest sizes (27\"/30\")", () => {
    expect(forwardCurveOvLimit(15)).toBe(2000);
    expect(forwardCurveOvLimit(22)).toBe(2000);
    expect(forwardCurveOvLimit(26)).toBe(2400); // FC-126 (~27")
    expect(forwardCurveOvLimit(30.25)).toBe(2400); // FC-130 (~30")
  });

  it("flags an undersized fan (outlet velocity over the limit) as LOW", () => {
    const small: FanModelInput = {
      ...model,
      specs: { outletArea_ft2: 0.5, bladeDia_in: 12 }, // tiny outlet
    };
    const r = selectFan(small, { airflow_m3hr: 8000, staticPressure_pa: 250 })!;
    expect(r.ovWithinLimit).toBe(false);
    expect(r.confidence).toBe("LOW");
    expect(r.requiresEngineerConfirmation).toBe(true);
  });

  it("uses a flat 2000 fpm outlet-velocity limit for forward-curve (CFAB) fans", () => {
    // OV ≈ 1899 fpm at this duty: over the CEB 1800 limit (12" wheel) but within
    // the higher forward-curve 2000 fpm limit.
    const specs = { outletArea_ft2: 0.62, bladeDia_in: 12 };
    const duty = { airflow_m3hr: 2000, staticPressure_pa: 350 };
    const ceb = selectFan({ ...model, specs }, duty)!;
    expect(ceb.ovLimit_fpm).toBe(1800);
    expect(ceb.ovWithinLimit).toBe(false);
    expect(ceb.confidence).toBe("LOW");
    const fwd = selectFan({ ...model, specs: { ...specs, bladeType: "Forward Curved" } }, duty)!;
    expect(fwd.ovLimit_fpm).toBe(2000);
    expect(fwd.ovWithinLimit).toBe(true);
    expect(fwd.confidence).toBe("HIGH");
  });
});

describe("selectFan — fan laws", () => {
  it("requires higher speed for higher pressure at same airflow", () => {
    const r = selectFan(model, { airflow_m3hr: 2000, staticPressure_pa: 700 })!;
    expect(r.rpm).toBeGreaterThan(1000);
    expect(r.speedRatio).toBeGreaterThan(1);
    // Power scales with speed^3, so it should exceed the rated-speed power.
    expect(r.power_kw).toBeGreaterThan(1.0);
  });

  it("requires lower speed for a gentle duty", () => {
    const r = selectFan(model, { airflow_m3hr: 1500, staticPressure_pa: 150 })!;
    expect(r.speedRatio).toBeLessThan(1);
    expect(r.rpm).toBeLessThan(1000);
  });
});

describe("selectFan — envelope guarding", () => {
  it("flags an extreme out-of-envelope duty as LOW confidence requiring confirmation", () => {
    const r = selectFan(model, { airflow_m3hr: 2000, staticPressure_pa: 5000 })!;
    expect(r.confidence).toBe("LOW");
    expect(r.requiresEngineerConfirmation).toBe(true);
    expect(r.withinEnvelope).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("never returns withinEnvelope=true for a duty far above the curve", () => {
    const r = selectFan(model, { airflow_m3hr: 6000, staticPressure_pa: 800 })!;
    expect(r.withinEnvelope).toBe(false);
  });
});

describe("selectFan — density correction", () => {
  it("requires more pressure capability for hot (less dense) air", () => {
    const cold = selectFan(model, { airflow_m3hr: 2000, staticPressure_pa: 300 })!;
    const hot = selectFan(model, {
      airflow_m3hr: 2000,
      staticPressure_pa: 300,
      temperatureC: 200,
    })!;
    // Hot air -> higher equivalent standard-density pressure -> higher speed.
    expect(hot.selectionStaticPressure_pa).toBeGreaterThan(
      cold.selectionStaticPressure_pa,
    );
    expect(hot.rpm).toBeGreaterThan(cold.rpm);
  });

  it("densityFromTemperature decreases with temperature", () => {
    expect(densityFromTemperature(20)).toBeCloseTo(1.2, 2);
    expect(densityFromTemperature(200)).toBeLessThan(1.2);
  });
});

describe("selectFan — normalization from mixed RPM data", () => {
  it("collapses points at different RPMs onto one curve via fan laws", () => {
    const mixed: FanModelInput = {
      id: "m2",
      modelCode: "MIX-1",
      name: "Mixed",
      ratingPoints: [
        // Same physical fan, half the data taken at 500 rpm.
        { rpm: 500, airflow_m3hr: 500, staticPressure_pa: 112.5, power_kw: 0.1 },
        { rpm: 1000, airflow_m3hr: 2000, staticPressure_pa: 350, power_kw: 1.0 },
        { rpm: 1000, airflow_m3hr: 3000, staticPressure_pa: 200, power_kw: 1.1 },
      ],
    };
    const r = selectFan(mixed, { airflow_m3hr: 2000, staticPressure_pa: 350 });
    expect(r).not.toBeNull();
    expect(r!.referenceRpm).toBe(1000);
  });
});

describe("selectFan — insufficient data", () => {
  it("returns null when fewer than 2 rating points", () => {
    const thin: FanModelInput = {
      id: "m3",
      modelCode: "THIN",
      name: "Thin",
      ratingPoints: [{ rpm: 1000, airflow_m3hr: 1000, staticPressure_pa: 200, power_kw: 0.5 }],
    };
    expect(selectFan(thin, { airflow_m3hr: 1000, staticPressure_pa: 200 })).toBeNull();
  });
});

describe("selectFan — direct drive (CEBDD): SP + pole priority", () => {
  // Reference curve taken at 1750 rpm so the 4-pole nominal speed (~1752) ≈ ref.
  const dd: FanModelInput = {
    id: "dd",
    modelCode: "AVDDCEB",
    name: "Direct Drive",
    specs: { outletArea_ft2: 5, bladeDia_in: 24, maxRpm: 4000 },
    ratingPoints: model.ratingPoints.map((p) => ({ ...p, rpm: 1750 })),
  };

  it("meets a modest SP on the 4-pole band at roughly the requested flow", () => {
    const r = selectFan(dd, { airflow_m3hr: 2000, staticPressure_pa: 350 }, { directDrive: true })!;
    expect(r).not.toBeNull();
    expect(r.motorPole).toBe(4);
    expect(r.rpm).toBeGreaterThanOrEqual(1662);
    expect(r.rpm).toBeLessThanOrEqual(1842);
    expect(r.selectedAirflow_m3hr).toBeGreaterThanOrEqual(2000);
    expect(r.confidence).toBe("HIGH");
    // Outlet-velocity limit is disregarded for CEBDD.
    expect(r.ovLimit_fpm).toBeNull();
    expect(r.ovWithinLimit).toBeNull();
  });

  it("escalates to 2-pole when the SP can't be made on the 4-pole band, raising the flow", () => {
    const r = selectFan(dd, { airflow_m3hr: 2000, staticPressure_pa: 620 }, { directDrive: true })!;
    expect(r).not.toBeNull();
    expect(r.motorPole).toBe(2);
    expect(r.rpm).toBeGreaterThanOrEqual(3325);
    expect(r.rpm).toBeLessThanOrEqual(3684);
    // Volume flow is increased to land on the curve at the required SP.
    expect(r.selectedAirflow_m3hr!).toBeGreaterThan(2000);
  });

  it("excludes a size that can't develop the SP even on the 2-pole band", () => {
    const r = selectFan(dd, { airflow_m3hr: 2000, staticPressure_pa: 2100 }, { directDrive: true });
    expect(r).toBeNull();
  });

  it("belt drive (no flag) keeps a null pole and no selected airflow", () => {
    const r = selectFan(dd, { airflow_m3hr: 2000, staticPressure_pa: 350 })!;
    expect(r).not.toBeNull();
    expect(r.motorPole).toBeNull();
    expect(r.selectedAirflow_m3hr).toBeNull();
  });

  it("reads a CFM×SP rating grid at the fixed pole speed (not the fan-law curve)", () => {
    // Grid data: each SP level is a series where airflow rises with rpm.
    const grid: FanModelInput = {
      id: "grid",
      modelCode: "AVGRIDCEB",
      name: "Grid Fan",
      specs: { maxRpm: 4000 },
      ratingPoints: [
        { rpm: 800, airflow_m3hr: 1000, staticPressure_pa: 100, power_kw: 0.4 },
        { rpm: 1200, airflow_m3hr: 2000, staticPressure_pa: 100, power_kw: 0.7 },
        { rpm: 1700, airflow_m3hr: 3000, staticPressure_pa: 100, power_kw: 1.1 },
        { rpm: 2200, airflow_m3hr: 4000, staticPressure_pa: 100, power_kw: 1.6 },
        { rpm: 1300, airflow_m3hr: 1000, staticPressure_pa: 250, power_kw: 0.6 },
        { rpm: 1600, airflow_m3hr: 2000, staticPressure_pa: 250, power_kw: 0.95 },
        { rpm: 2000, airflow_m3hr: 3000, staticPressure_pa: 250, power_kw: 1.4 },
        { rpm: 2500, airflow_m3hr: 4000, staticPressure_pa: 250, power_kw: 2.0 },
      ],
    };
    const r = selectFan(grid, { airflow_m3hr: 2000, staticPressure_pa: 250 }, { directDrive: true })!;
    expect(r).not.toBeNull();
    expect(r.motorPole).toBe(4); // ~1752 rpm lands on the 4-pole band
    expect(r.selectedAirflow_m3hr!).toBeGreaterThan(2000); // flow raised to land on the curve
    expect(r.confidence).toBe("HIGH");
  });
});

describe("selectFans — ranking", () => {
  it("ranks HIGH-confidence candidates before LOW-confidence ones", () => {
    const big: FanModelInput = {
      ...model,
      id: "big",
      modelCode: "BIG-200",
      ratingPoints: model.ratingPoints.map((p) => ({
        ...p,
        airflow_m3hr: p.airflow_m3hr * 2,
        staticPressure_pa: p.staticPressure_pa * 2,
      })),
    };
    const ranked = selectFans([model, big], {
      airflow_m3hr: 2000,
      staticPressure_pa: 350,
    });
    expect(ranked.length).toBe(2);
    expect(ranked[0].confidence).toBe("HIGH");
    // The well-matched small fan should rank first.
    expect(ranked[0].modelCode).toBe("TEST-100");
  });
});
