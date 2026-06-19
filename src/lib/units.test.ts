import { describe, it, expect } from "vitest";
import {
  convertAirflow,
  convertPressure,
  convertDimension,
  airflowToM3hr,
  pressureToPa,
  kwToHp,
  hpToKw,
  normalizeAirflowUnit,
  normalizePressureUnit,
} from "./units";

const approx = (a: number, b: number, tol = 1e-3) =>
  expect(Math.abs(a - b)).toBeLessThan(tol);

describe("airflow conversions", () => {
  it("CFM <-> m3/hr", () => {
    approx(convertAirflow(1000, "cfm", "m3hr"), 1699.01082, 0.01);
    approx(convertAirflow(1699.01082, "m3hr", "cfm"), 1000, 0.01);
  });

  it("m3/hr <-> m3/s", () => {
    approx(convertAirflow(3600, "m3hr", "m3s"), 1);
    approx(convertAirflow(1, "m3s", "m3hr"), 3600);
  });

  it("m3/hr <-> L/s", () => {
    approx(convertAirflow(3.6, "m3hr", "ls"), 1);
    approx(convertAirflow(1, "ls", "m3hr"), 3.6);
  });

  it("round-trips through SI", () => {
    const original = 5432;
    const back = convertAirflow(convertAirflow(original, "cfm", "m3s"), "m3s", "cfm");
    approx(back, original, 0.01);
  });

  it("identity conversion is exact", () => {
    expect(convertAirflow(1234, "cfm", "cfm")).toBe(1234);
  });

  it("airflowToM3hr matches table", () => {
    approx(airflowToM3hr(1, "cfm"), 1.69901082, 1e-6);
  });
});

describe("pressure conversions", () => {
  it("Pa <-> mmAq", () => {
    approx(convertPressure(9.80665, "pa", "mmaq"), 1);
    approx(convertPressure(1, "mmaq", "pa"), 9.80665);
  });

  it("Pa <-> inWG", () => {
    approx(convertPressure(249.0889, "pa", "inwg"), 1, 1e-3);
    approx(convertPressure(1, "inwg", "pa"), 249.0889, 1e-3);
  });

  it("Pa <-> kPa", () => {
    approx(convertPressure(1000, "pa", "kpa"), 1);
    approx(convertPressure(1, "kpa", "pa"), 1000);
  });

  it("mmAq <-> inWG round trip", () => {
    const original = 25;
    const back = convertPressure(convertPressure(original, "mmaq", "inwg"), "inwg", "mmaq");
    approx(back, original, 1e-3);
  });

  it("pressureToPa matches table", () => {
    approx(pressureToPa(2, "mmaq"), 19.6133, 1e-3);
  });
});

describe("dimension conversions", () => {
  it("mm <-> inch", () => {
    approx(convertDimension(25.4, "mm", "inch"), 1);
    approx(convertDimension(1, "inch", "mm"), 25.4);
  });
});

describe("power conversions", () => {
  it("kW <-> HP", () => {
    approx(kwToHp(0.745699872), 1, 1e-6);
    approx(hpToKw(1), 0.745699872, 1e-6);
  });
});

describe("unit string normalization", () => {
  it("normalizes airflow aliases", () => {
    expect(normalizeAirflowUnit("CFM")).toBe("cfm");
    expect(normalizeAirflowUnit("m³/hr")).toBe("m3hr");
    expect(normalizeAirflowUnit("CMH")).toBe("m3hr");
    expect(normalizeAirflowUnit("L/s")).toBe("ls");
    expect(normalizeAirflowUnit("garbage")).toBeNull();
    expect(normalizeAirflowUnit(null)).toBeNull();
  });

  it("normalizes pressure aliases", () => {
    expect(normalizePressureUnit("Pa")).toBe("pa");
    expect(normalizePressureUnit("mmH2O")).toBe("mmaq");
    expect(normalizePressureUnit("in WG")).toBe("inwg");
    expect(normalizePressureUnit("kPa")).toBe("kpa");
    expect(normalizePressureUnit("")).toBeNull();
  });
});
