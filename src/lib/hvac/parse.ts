/**
 * Input parsing shared by the HVAC calculators. Every field in them is a
 * positive physical quantity, so a blank, a zero or anything unparseable all
 * mean the same thing: "not given".
 */
export const positive = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Rounding helpers used across the calculators' readouts. */
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A SIGNED quantity. A temperature is the reason this exists: 0 °C and −5 °C are
 * both real readings, and `positive` would throw them away as "not given".
 * Altitude too — sea level is 0 ft, not a blank.
 */
export const signed = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** A quantity that may be zero but not negative — a relative humidity of 0%. */
export const nonNegative = (s: string): number | null => {
  const n = signed(s);
  return n != null && n >= 0 ? n : null;
};
