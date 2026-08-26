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
