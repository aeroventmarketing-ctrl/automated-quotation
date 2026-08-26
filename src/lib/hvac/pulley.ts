/**
 * Belt-drive pulley (sheave) maths. The driver and driven sheaves share the same
 * belt speed, so:
 *
 *   motorRPM · motorØ = fanRPM · fanØ
 *
 * Give any three of the four and the fourth follows. Pure maths, no React — the
 * staff tool and the public HVAC Tools page on the storefront both render this.
 */

export type DimUnit = "in" | "mm";

export interface PulleyInput {
  motorRpm: number | null;
  motorDia: number | null;
  fanDia: number | null;
  fanRpm: number | null;
  /** Unit the two diameters (and the centre distance) are given in. */
  dimUnit: DimUnit;
  /** Optional centre distance, for the belt pitch length. */
  center: number | null;
}

export interface PulleySolution {
  motorRpm: number;
  motorDia: number;
  fanDia: number;
  fanRpm: number;
  /** Driven : driver speed ratio (fan RPM ÷ motor RPM). */
  ratio: number;
  beltFpm: number;
  beltMs: number;
  /** Belt pitch length in `unit`, when a centre distance was given. */
  beltLen: number | null;
  unit: DimUnit;
}

export type PulleyResult = { error: string } | PulleySolution;

export const isPulleyError = (r: PulleyResult): r is { error: string } => "error" in r;

const FPM_PER_MS = 0.00508; // fpm -> m/s

export function solvePulley({ motorRpm, motorDia, fanDia, fanRpm, dimUnit, center }: PulleyInput): PulleyResult {
  const provided = [motorRpm, motorDia, fanDia, fanRpm].filter((v) => v != null).length;
  if (provided < 3) return { error: "Enter any three of motor RPM, motor Ø, fan Ø, fan RPM." };
  if (provided > 3) return { error: "Leave one field blank to solve for it." };

  let mr = motorRpm;
  let md = motorDia;
  let fd = fanDia;
  let fr = fanRpm;
  if (mr == null) mr = (fr! * fd!) / md!;
  else if (md == null) md = (fr! * fd!) / mr;
  else if (fd == null) fd = (mr * md) / fr!;
  else if (fr == null) fr = (mr * md) / fd;

  if (![mr, md, fd, fr].every((x) => x != null && Number.isFinite(x) && x > 0)) {
    return { error: "Check the values." };
  }

  // Belt speed is a physical quantity, so the diameter has to reach inches
  // regardless of which unit the user typed in.
  const diaIn = dimUnit === "mm" ? md! / 25.4 : md!;
  const beltFpm = (Math.PI * diaIn * mr!) / 12;

  let beltLen: number | null = null;
  if (center != null) {
    const big = Math.max(md!, fd!);
    const small = Math.min(md!, fd!);
    beltLen = 2 * center + (Math.PI * (big + small)) / 2 + (big - small) ** 2 / (4 * center);
  }

  return {
    motorRpm: mr!,
    motorDia: md!,
    fanDia: fd!,
    fanRpm: fr!,
    ratio: fr! / mr!,
    beltFpm,
    beltMs: beltFpm * FPM_PER_MS,
    beltLen,
    unit: dimUnit,
  };
}
