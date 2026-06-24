import { describe, it, expect } from "vitest";
import {
  selectFan,
  selectFans,
  densityFromTemperature,
  suggestMotorHp,
  outletVelocityLimit,
  forwardCurveOvLimit,
  didwCfabOvLimit,
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

  it("uses 2200 fpm (<30\") / 2400 fpm (>=30\") for DIDWCFAB", () => {
    expect(didwCfabOvLimit(12.25)).toBe(2200);
    expect(didwCfabOvLimit(27)).toBe(2200);
    expect(didwCfabOvLimit(30)).toBe(2400);
    expect(didwCfabOvLimit(36.5)).toBe(2400);
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

describe("selectFan — fixed-speed direct (EWFDD propeller): own rated speed", () => {
  // A natively-direct propeller fan runs at its own rated speed (here 860 rpm,
  // ~8-pole), not the centrifugal 2-/4-pole bands. Curve at 860 rpm.
  const ewfdd: FanModelInput = {
    id: "ewfdd",
    modelCode: "AV3600EWFDD",
    name: "Panel Fan 36 (EWFDD)",
    specs: { maxRpm: 860, propeller: true, fixedSpeedDirect: true },
    ratingPoints: [
      { rpm: 860, airflow_m3hr: 0, staticPressure_pa: 300, power_kw: 1.0 },
      { rpm: 860, airflow_m3hr: 1500, staticPressure_pa: 250, power_kw: 1.2 },
      { rpm: 860, airflow_m3hr: 3000, staticPressure_pa: 150, power_kw: 1.5 },
      { rpm: 860, airflow_m3hr: 4500, staticPressure_pa: 0, power_kw: 1.7 },
    ],
  };

  it("selects at the fan's own rated rpm, not a 4-/2-pole band", () => {
    const r = selectFan(ewfdd, { airflow_m3hr: 2000, staticPressure_pa: 150 }, { directDrive: true })!;
    expect(r).not.toBeNull();
    expect(r.rpm).toBe(860); // its own speed — never scaled up to ~1752
    expect(r.rpmWithinMax).toBe(true);
    expect(r.selectedAirflow_m3hr!).toBeGreaterThanOrEqual(2000);
    expect(r.confidence).toBe("HIGH");
  });

  it("excludes the size when the required SP exceeds what its fixed speed develops", () => {
    const r = selectFan(ewfdd, { airflow_m3hr: 2000, staticPressure_pa: 400 }, { directDrive: true });
    expect(r).toBeNull();
  });

  it("prefers the lower-pole motor (1160/6-pole over 860/8-pole) when both meet the flow", () => {
    // Two motor poles available: 860 (8-pole) and 1160 (6-pole). Higher-pole
    // motors are harder to source, so the 6-pole speed is preferred.
    const twoSpeed: FanModelInput = {
      ...ewfdd,
      id: "ewfdd2",
      modelCode: "AV2400EWFDD",
      specs: { maxRpm: 1160, propeller: true, fixedSpeedDirect: true },
      ratingPoints: [
        ...ewfdd.ratingPoints,
        { rpm: 1160, airflow_m3hr: 0, staticPressure_pa: 540, power_kw: 1.8 },
        { rpm: 1160, airflow_m3hr: 2000, staticPressure_pa: 450, power_kw: 2.2 },
        { rpm: 1160, airflow_m3hr: 4000, staticPressure_pa: 270, power_kw: 2.7 },
        { rpm: 1160, airflow_m3hr: 6000, staticPressure_pa: 0, power_kw: 3.1 },
      ],
    };
    const r = selectFan(twoSpeed, { airflow_m3hr: 1500, staticPressure_pa: 150 }, { directDrive: true })!;
    expect(r.rpm).toBe(1160);
    expect(r.motorPole).toBe(6);
  });

  it("reads the motor from the catalog MOTOR HP column: smallest motor whose MAX BHP covers the absorbed BHP", () => {
    // Motor table: 2 HP rated to 2.2 BHP, 3 HP to 3.3, 5 HP to 5.5. The duty
    // absorbs ~1.6 BHP, so the 2 HP motor (max 2.2) covers it — not BHP/0.75.
    const withMotor: FanModelInput = {
      ...ewfdd,
      id: "ewfdd3",
      specs: {
        maxRpm: 860,
        propeller: true,
        fixedSpeedDirect: true,
        motorTable: [[2, 2.2], [3, 3.3], [5, 5.5]],
      },
    };
    const r = selectFan(withMotor, { airflow_m3hr: 2000, staticPressure_pa: 150 }, { directDrive: true })!;
    expect(r.bhp).toBeLessThan(2.2);
    expect(r.motorHp).toBe(2); // smallest motor whose MAX BHP ≥ absorbed BHP
  });
});

describe("selectFan — propeller catalogue-row lookup (EWF/EWFDD/PRV/PRVDD)", () => {
  // A belt propeller fan whose catalogue offers 30°, 40° and 45° rows. Selection
  // picks an actual printed row (no fan-law scaling): the smallest motor among
  // the ≤40° rows that meet the flow at the client SP, within the 1200 rpm belt
  // ceiling — shown at that row's actual blade angle.
  const belt: FanModelInput = {
    id: "ewf",
    modelCode: "AV2400EWF",
    name: "Exhaust Wall Fan 24 (EWF)",
    specs: {
      propeller: true,
      drive: "belt",
      bladeDia_in: 23,
      outletArea_ft2: 3.0,
      maxRpm: 1200,
      rows: [
        { a: 30, hp: 3, rpm: 700, bhp: 3.2, c: [[0, 8000], [0.25, 7000], [0.5, 6000]] },
        { a: 40, hp: 5, rpm: 650, bhp: 5.0, c: [[0, 9000], [0.25, 8200], [0.5, 7400]] },
        { a: 45, hp: 7.5, rpm: 600, bhp: 7.6, c: [[0, 10000], [0.25, 9200], [0.5, 8400]] },
        { a: 40, hp: 7.5, rpm: 1300, bhp: 8.0, c: [[0, 14000], [0.25, 13000], [0.5, 12000]] },
      ],
    },
    ratingPoints: [],
  };

  it("picks the smallest-motor ≤40° row that meets the duty, shown at the row's actual angle and motor", () => {
    // Both the 30°/3 HP (7000 cfm) and 40°/5 HP (8200 cfm) rows meet 6500 cfm @
    // 0.25". The smallest motor that meets the duty wins → the 30°/3 HP row, not
    // the higher-angle/bigger-motor one. The 45° and >1200 rpm rows are excluded.
    const r = selectFan(belt, { airflow_m3hr: 6500 * 1.6990108, staticPressure_pa: 0.25 * 249.0889 })!;
    expect(r.motorHp).toBe(3); // smallest motor whose ≤40° row meets the flow
    expect(r.bladeAngle).toBe(30); // that row's actual angle, never 45°/relabelled
    expect(r.rpm).toBe(700); // the printed catalogue rpm (≤1200), not fan-law
    expect(r.confidence).toBe("HIGH");
    expect(r.ovWithinLimit).toBe(true); // OV 6500/3.0 ≈ 2167 ≤ 2200
  });

  it("never selects a row above the 1200 rpm belt ceiling or a 45° angle", () => {
    // A flow only the 1300-rpm or 45° rows could meet → undersized within the rules.
    const r = selectFan(belt, { airflow_m3hr: 8600 * 1.6990108, staticPressure_pa: 0.25 * 249.0889 })!;
    expect(r.bladeAngle).toBeLessThanOrEqual(40);
    expect(r.rpm).toBeLessThanOrEqual(1200);
    expect(r.withinEnvelope).toBe(false); // no ≤40°/≤1200rpm row reaches 8600 cfm
  });

  it("flags outlet velocity over 2200 fpm as LOW", () => {
    const tight: FanModelInput = {
      ...belt,
      id: "ewf2",
      specs: { ...belt.specs, outletArea_ft2: 2.0 }, // OV 6500/2.0 = 3250 > 2200
    };
    const r = selectFan(tight, { airflow_m3hr: 6500 * 1.6990108, staticPressure_pa: 0.25 * 249.0889 })!;
    expect(r.outletVelocity_fpm).toBe(3250);
    expect(r.ovWithinLimit).toBe(false);
    expect(r.confidence).toBe("LOW");
  });
});

describe("selectFan — centrifugal catalogue interpolation + envelope guard", () => {
  // A belt centrifugal whose catalogue prints a CFM×SP grid (1" and 2" levels,
  // three flows each). Selection is bilinear interpolation across the printed
  // grid; duties outside the published envelope (left of peak / beyond range)
  // are refused, never fan-law extrapolated.
  const cat: FanModelInput = {
    id: "didw",
    modelCode: "AV2400DIDWCEB",
    name: "Centrifugal Blower DIDW 24",
    specs: {
      category: "Centrifugal Type",
      drive: "belt",
      bladeDia_in: 24,
      outletArea_ft2: 4.0, // OV limit for a 24" wheel = 1800 fpm
    },
    ratingPoints: [
      // 1" w.g. level (flows 6000–8000)
      { rpm: 500, airflow_m3hr: 6000 * 1.6990108, staticPressure_pa: 1 * 249.0889, power_kw: 1.5 },
      { rpm: 600, airflow_m3hr: 7000 * 1.6990108, staticPressure_pa: 1 * 249.0889, power_kw: 2.0 },
      { rpm: 700, airflow_m3hr: 8000 * 1.6990108, staticPressure_pa: 1 * 249.0889, power_kw: 2.6 },
      // 2" w.g. level (flows 6000–8000)
      { rpm: 700, airflow_m3hr: 6000 * 1.6990108, staticPressure_pa: 2 * 249.0889, power_kw: 2.2 },
      { rpm: 800, airflow_m3hr: 7000 * 1.6990108, staticPressure_pa: 2 * 249.0889, power_kw: 2.9 },
      { rpm: 900, airflow_m3hr: 8000 * 1.6990108, staticPressure_pa: 2 * 249.0889, power_kw: 3.6 },
    ],
  };

  it("bilinearly interpolates an in-envelope duty (between SP levels and flows)", () => {
    // 7000 cfm @ 1.5" sits dead-centre: rpm interpolates to (600+800)/2 = 700.
    const r = selectFan(cat, { airflow_m3hr: 7000 * 1.6990108, staticPressure_pa: 1.5 * 249.0889 })!;
    expect(r.rpm).toBe(700);
    expect(r.withinEnvelope).toBe(true);
    expect(r.confidence).toBe("HIGH");
    expect(Math.round(r.dutyAirflow_m3hr / 1.6990108)).toBe(7000); // quote shows the client's duty
  });

  it("refuses (returns null) when the duty is left of peak — below the lowest printed flow", () => {
    // 4000 cfm @ 1.5" is left of the published minimum flow (6000) → surge region.
    const r = selectFan(cat, { airflow_m3hr: 4000 * 1.6990108, staticPressure_pa: 1.5 * 249.0889 });
    expect(r).toBeNull();
  });

  it("refuses (returns null) when the duty is beyond the rated range — above the printed pressure", () => {
    // 7000 cfm @ 3" exceeds the highest printed SP level (2") → not supported.
    const r = selectFan(cat, { airflow_m3hr: 7000 * 1.6990108, staticPressure_pa: 3 * 249.0889 });
    expect(r).toBeNull();
  });

  it("refuses (returns null) past the highest printed flow rather than extrapolating", () => {
    // 9000 cfm @ 1" is beyond the largest printed flow (8000) → refused.
    const r = selectFan(cat, { airflow_m3hr: 9000 * 1.6990108, staticPressure_pa: 1 * 249.0889 });
    expect(r).toBeNull();
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
