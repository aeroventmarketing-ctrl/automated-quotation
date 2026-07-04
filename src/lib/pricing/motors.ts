/**
 * AFBM induction-motor price tables (TECO), used by the quote price calculator.
 * Price is the motor net price in PHP. Model code varies by supply voltage
 * (220 / 380-400 / 440 V) but the price does not. Data: "motor details for claude".
 *
 * Pricing rule (confirmed with AFBM):
 *   line price = blowerBody + motor
 *   + 10 percent of (blowerBody + motor) when 3-phase AND HP > 10 (dynamic balancing on-site)
 * Combined model on the quote = blowerModel immediately followed by the motor
 * model code, e.g. AV1225CEB + 15K3F3T  ->  "AV1225CEB15K3F3T".
 */

export type Voltage = "220" | "380" | "440";

export interface MotorRow {
  hp: number;
  phase: number; // 1 or 3
  pole: number; // 2 or 4
  price: number; // PHP
  m220: string | null;
  m380: string | null; // 380 and 400 V
  m440: string | null;
}

export const MOTORS: MotorRow[] = [
  { hp: 0.25, phase: 1, pole: 4, price: 14287, m220: "1FK1F2T", m380: null, m440: null },
  { hp: 0.5, phase: 1, pole: 4, price: 16669, m220: "1HK1F2T", m380: null, m440: null },
  { hp: 0.75, phase: 1, pole: 4, price: 20302, m220: "3FK1F2T", m380: null, m440: null },
  { hp: 1.0, phase: 1, pole: 4, price: 25314, m220: "1K1F2T", m380: null, m440: null },
  { hp: 1.5, phase: 1, pole: 4, price: 27320, m220: "1A1HK1F2T", m380: null, m440: null },
  { hp: 2.0, phase: 1, pole: 4, price: 32081, m220: "2K1F2T", m380: null, m440: null },
  { hp: 3.0, phase: 1, pole: 4, price: 39853, m220: "3K1F2T", m380: null, m440: null },
  { hp: 5.0, phase: 1, pole: 4, price: 48663, m220: "5K1F2T", m380: null, m440: null },
  { hp: 1.0, phase: 3, pole: 2, price: 10001, m220: "1K3F2T", m380: "1K3F3T", m440: "1K3F4T" },
  { hp: 1.5, phase: 3, pole: 2, price: 13572, m220: "1A1HK3F2T", m380: "1A1HK3F3T", m440: "1A1HK3F4T" },
  { hp: 2.0, phase: 3, pole: 2, price: 14286, m220: "2K3F2T", m380: "2K3F3T", m440: "2K3F4T" },
  { hp: 3.0, phase: 3, pole: 2, price: 15148, m220: "3K3F2T", m380: "3K3F3T", m440: "3K3F4T" },
  { hp: 5.0, phase: 3, pole: 2, price: 20358, m220: "5K3F2T", m380: "5K3F3T", m440: "5K3F4T" },
  { hp: 7.5, phase: 3, pole: 2, price: 28691, m220: "7A1HK3F2T", m380: "7A1HK3F3T", m440: "7A1HK3F4T" },
  { hp: 10.0, phase: 3, pole: 2, price: 32382, m220: "10K3F2T", m380: "10K3F3T", m440: "10K3F4T" },
  { hp: 15.0, phase: 3, pole: 2, price: 48694, m220: "15K3F2T", m380: "15K3F3T", m440: "15K3F4T" },
  { hp: 0.5, phase: 3, pole: 4, price: 8213, m220: "1HK3F2T", m380: "1HK3F3T", m440: "1HK3F4T" },
  { hp: 1.0, phase: 3, pole: 4, price: 10001, m220: "1K3F2T", m380: "1K3F3T", m440: "1K3F4T" },
  { hp: 1.5, phase: 3, pole: 4, price: 13572, m220: "1A1HK3F2T", m380: "1A1HK3F3T", m440: "1A1HK3F4T" },
  { hp: 2.0, phase: 3, pole: 4, price: 14048, m220: "2K3F2T", m380: "2K3F3T", m440: "2K3F4T" },
  { hp: 3.0, phase: 3, pole: 4, price: 17144, m220: "3K3F2T", m380: "3K3F3T", m440: "3K3F4T" },
  { hp: 5.0, phase: 3, pole: 4, price: 22144, m220: "5K3F2T", m380: "5K3F3T", m440: "5K3F4T" },
  { hp: 7.5, phase: 3, pole: 4, price: 28691, m220: "7A1HK3F2T", m380: "7A1HK3F3T", m440: "7A1HK3F4T" },
  { hp: 10.0, phase: 3, pole: 4, price: 33336, m220: "10K3F2T", m380: "10K3F3T", m440: "10K3F4T" },
  { hp: 15.0, phase: 3, pole: 4, price: 53457, m220: "15K3F2T", m380: "15K3F3T", m440: "15K3F4T" },
  { hp: 20.0, phase: 3, pole: 4, price: 62028, m220: "20K3F2T", m380: "20K3F3T", m440: "20K3F4T" },
  { hp: 25.0, phase: 3, pole: 4, price: 84651, m220: "25K3F2T", m380: "25K3F3T", m440: "25K3F4T" },
  { hp: 30.0, phase: 3, pole: 4, price: 87983, m220: "30K3F2T", m380: "30K3F3T", m440: "30K3F4T" },
  { hp: 40.0, phase: 3, pole: 4, price: 97508, m220: "40K3F2T", m380: "40K3F3T", m440: "40K3F4T" },
  { hp: 50.0, phase: 3, pole: 4, price: 125486, m220: "50K3F2T", m380: "50K3F3T", m440: "50K3F4T" },
  { hp: 60.0, phase: 3, pole: 4, price: 148821, m220: "60K3F2T", m380: "60K3F3T", m440: "60K3F4T" },
  { hp: 75.0, phase: 3, pole: 4, price: 172752, m220: "75K3F2T", m380: "75K3F3T", m440: "75K3F4T" },
  { hp: 100.0, phase: 3, pole: 4, price: 255854, m220: "100K3F2T", m380: "100K3F3T", m440: "100K3F4T" },
  // 3-phase 6-pole (direct-drive, ~1140–1260 rpm). Codes vary only by voltage
  // (same convention as 2-/4-pole); the pole is not encoded in the model code.
  { hp: 1.0, phase: 3, pole: 6, price: 15572, m220: "1K3F2T", m380: "1K3F3T", m440: "1K3F4T" },
  { hp: 1.5, phase: 3, pole: 6, price: 20572, m220: "1A1HK3F2T", m380: "1A1HK3F3T", m440: "1A1HK3F4T" },
  { hp: 2.0, phase: 3, pole: 6, price: 20572, m220: "2K3F2T", m380: "2K3F3T", m440: "2K3F4T" },
  { hp: 3.0, phase: 3, pole: 6, price: 24573, m220: "3K3F2T", m380: "3K3F3T", m440: "3K3F4T" },
  { hp: 5.0, phase: 3, pole: 6, price: 41718, m220: "5K3F2T", m380: "5K3F3T", m440: "5K3F4T" },
  { hp: 7.5, phase: 3, pole: 6, price: 49717, m220: "7A1HK3F2T", m380: "7A1HK3F3T", m440: "7A1HK3F4T" },
  { hp: 10.0, phase: 3, pole: 6, price: 62433, m220: "10K3F2T", m380: "10K3F3T", m440: "10K3F4T" },
  { hp: 15.0, phase: 3, pole: 6, price: 83577, m220: "15K3F2T", m380: "15K3F3T", m440: "15K3F4T" },
];

/**
 * Explosion-proof (TEFC-EX) motor net prices by HP — the 4-pole explosion-proof
 * list. Belt-drive fans use a 4-pole EX motor; direct-drive may use 2-/4-/6-pole,
 * but only these (HP-keyed) prices are published, so they apply to any pole. When
 * a HP has no EX price the standard price is used as a fallback. The 1 HP unit is
 * flagged available June 2026. Model code swaps the trailing "T" (TEFC) for "X".
 */
export const EXPROOF_PRICE_BY_HP: Record<number, number> = {
  1: 39590, 2: 47567, 3: 57200, 5: 59157, 7.5: 81134, 10: 91823, 15: 128098, 20: 153386, 25: 193276,
};

export function lookupMotor(hp: number, phase: number, pole: number): MotorRow | undefined {
  return MOTORS.find((m) => m.hp === hp && m.phase === phase && m.pole === pole);
}

export function motorModelCode(m: MotorRow, volts: Voltage, exproof = false): string | null {
  const code = volts === "220" ? m.m220 : volts === "380" ? m.m380 : m.m440;
  if (!code) return null;
  // Explosion-proof motors swap the trailing "T" (TEFC) indicator for "X".
  return exproof ? code.replace(/T$/, "X") : code;
}

/** Net motor price — the explosion-proof price when flagged (falls back to standard). */
export function motorNetPrice(m: MotorRow, exproof = false): number {
  return exproof ? EXPROOF_PRICE_BY_HP[m.hp] ?? m.price : m.price;
}

/** True when the explosion-proof variant of this HP has a published price. */
export function hasExproofPrice(hp: number): boolean {
  return EXPROOF_PRICE_BY_HP[hp] != null;
}

/** The dynamic-balancing-on-site charge (+10%) applies to 3-phase motors above 10 HP. */
export function dynamicBalancingApplies(hp: number, phase: number): boolean {
  return phase === 3 && hp > 10;
}

/** Distinct HP options available for a given phase/pole, ascending. */
export function hpOptions(phase: number, pole: number): number[] {
  return MOTORS.filter((m) => m.phase === phase && m.pole === pole)
    .map((m) => m.hp)
    .sort((a, b) => a - b);
}

/**
 * Net selling price for one unit = (body + motor), +10% when dynamic balancing applies.
 * Pass motorPrice = 0 when no motor has been chosen yet.
 */
export function computeUnitPrice(
  bodyPrice: number,
  motorPrice: number,
  hp: number,
  phase: number,
): number {
  const sub = bodyPrice + motorPrice;
  const total = dynamicBalancingApplies(hp, phase) ? sub * 1.1 : sub;
  return Math.round(total * 100) / 100;
}

/** Blower model immediately followed by the motor model code (no separator). */
export function combinedModel(blowerModel: string, motorModel: string | null): string {
  return motorModel ? `${blowerModel}${motorModel}` : blowerModel;
}
