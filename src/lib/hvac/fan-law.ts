/**
 * Fan affinity laws for a fixed fan changing speed:
 *   Q ∝ N      (airflow ∝ speed)
 *   P ∝ N²     (static pressure ∝ speed²)
 *   W ∝ N³     (power ∝ speed³)
 *
 * Pure maths, no React — the staff tool and the public HVAC Tools page on the
 * storefront both render this, so a correction here reaches both at once.
 * Units pass through unchanged: every relation is a ratio.
 */

export type FanLawMode = "rpm" | "cfm" | "sp" | "bhp";

export interface FanLawInput {
  /** Known operating point. `n1` is required; the rest are optional. */
  n1: number | null;
  q1: number | null;
  p1: number | null;
  w1: number | null;
  /** Which quantity the target value refers to. */
  mode: FanLawMode;
  target: number | null;
}

export interface FanLawSolution {
  /** Speed ratio N2/N1. */
  ratio: number;
  n2: number;
  q2: number | null;
  p2: number | null;
  w2: number | null;
}

export type FanLawResult = { error: string } | FanLawSolution | null;

export const isFanLawError = (r: FanLawResult): r is { error: string } =>
  r !== null && "error" in r;

/** Solve the new operating point. `null` means "not enough entered yet". */
export function solveFanLaw({ n1, q1, p1, w1, mode, target }: FanLawInput): FanLawResult {
  if (n1 == null) return { error: "Enter the known speed (RPM 1)." };
  if (target == null) return null;

  let ratio: number;
  if (mode === "rpm") {
    ratio = target / n1;
  } else if (mode === "cfm") {
    if (q1 == null) return { error: "Enter the known airflow (CFM 1) to solve by airflow." };
    ratio = target / q1;
  } else if (mode === "sp") {
    if (p1 == null) return { error: "Enter the known pressure (SP 1) to solve by pressure." };
    ratio = Math.sqrt(target / p1);
  } else {
    if (w1 == null) return { error: "Enter the known power (BHP 1) to solve by power." };
    ratio = Math.cbrt(target / w1);
  }
  if (!(ratio > 0) || !Number.isFinite(ratio)) return { error: "Check the values." };

  return {
    ratio,
    n2: mode === "rpm" ? target : n1 * ratio,
    q2: q1 != null ? q1 * ratio : null,
    p2: p1 != null ? p1 * ratio * ratio : null,
    w2: w1 != null ? w1 * ratio ** 3 : null,
  };
}
