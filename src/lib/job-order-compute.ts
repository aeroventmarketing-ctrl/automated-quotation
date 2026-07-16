/**
 * Recomputes the Centrifugal Blower JO's derived values (the ones the template
 * computes with VLOOKUP/arithmetic) so they can be rendered into a PDF without
 * Excel. The lookup tables below are copied verbatim from the template's Source
 * sheet (blade table A4:F25, motor table P3:W56) and validated against the
 * template's own sample outputs.
 */
import type { FansJobOrder } from "@/lib/job-order";

// [diameter, bore, hub, shafting, bearing, shaftInches]
const BLADE_TABLE: Array<[number, string, string, string, string, number]> = [
  [9, "1”Ø bore x 5/16\" keyway", "2” Ø x 2” L x 1\"Ø bore x 5/16” keyway", "1\"Ø x 5/16” keyway", "UCP205", 1],
  [10.5, "1”Ø bore x 5/16\" keyway", "2” Ø x 2” L x 1\"Ø bore x 5/16” keyway", "1\"Ø x 5/16” keyway", "UCP205", 1],
  [12.25, "1 1/4”Ø bore x 3/8\" keyway", "2 1/2”Ø x 2 1/2”L x 1 1/4\"Ø bore x 3/8” keyway", "1 1/4\"Ø x 3/8” keyway", "UCP207", 1.25],
  [13.5, "1 1/4”Ø bore x 3/8\" keyway", "2 1/2”Ø x 2 1/2”L x 1 1/4\"Ø bore x 3/8” keyway", "1 1/4\"Ø x 3/8” keyway", "UCP207", 1.25],
  [15, "1 1/4”Ø bore x 3/8\" keyway", "2 1/2”Ø x 2 1/2”L x 1 1/4\"Ø bore x 3/8” keyway", "1 1/4\"Ø x 3/8” keyway", "UCP207", 1.25],
  [16.5, "1 1/4”Ø bore x 3/8\" keyway", "2 1/2”Ø x 2 1/2”L x 1 1/4\"Ø bore x 3/8” keyway", "1 1/4\"Ø x 3/8” keyway", "UCP207", 1.25],
  [18.25, "1 1/4”Ø bore x 3/8\" keyway", "2 1/2”Ø x 2 1/2”L x 1 1/4\"Ø bore x 3/8” keyway", "1 1/4\"Ø x 3/8” keyway", "UCP207", 1.25],
  [20, "1 1/4”Ø bore x 3/8\" keyway", "2 1/2”Ø x 2 1/2”L x 1 1/4\"Ø bore x 3/8” keyway", "1 1/4\"Ø x 3/8” keyway", "UCP207", 1.25],
  [22.25, "1 1/4”Ø bore x 3/8\" keyway", "2 1/2”Ø x 2 1/2”L x 1 1/4\"Ø bore x 3/8” keyway", "1 1/4\"Ø x 3/8” keyway", "UCP207", 1.25],
  [24.5, "1 1/2”Ø bore x 3/8\" keyway", "3”Ø x 3”L x 1 1/2”Ø bore x 3/8” keyway", "1 1/2”Ø x 3/8” keyway", "UCP208", 1.5],
  [27, "1 1/2”Ø bore x 3/8\" keyway", "3”Ø x 3”L x 1 1/2”Ø bore x 3/8” keyway", "1 1/2”Ø x 3/8” keyway", "UCP208", 1.5],
  [30, "1 3/4”Ø bore x 1/2\" keyway", "3 1/2” Ø x 3 1/2” L x 1 3/4\"Ø bore x 1/2” keyway", "1 3/4 x 1/2” keyway", "UCP209", 1.75],
  [33, "2”Ø bore x 1/2\" keyway", "4”Ø x 4”L x 2\"Ø bore x 1/2” keyway", "2\"Ø x 1/2” keyway", "UCP211", 2],
  [36.5, "2”Ø bore x 1/2\" keyway", "4”Ø x 4”L x 2\"Ø bore x 1/2” keyway", "2\"Ø x 1/2” keyway", "UCP211", 2],
  [40.25, "2 1/4”Ø x 1/2\" keyway", "4”Ø x 4”L x 2 1/4\"Ø bore x 1/2” keyway", "2 1/4”Ø x 1/2\" keyway", "UCP212", 2.25],
  [44.5, "2 1/4”Ø x 1/2\" keyway", "4”Ø x 4”L x 2 1/4\"Ø bore x 1/2” keyway", "2 1/4”Ø x 1/2\" keyway", "UCP212", 2.25],
  [49, "2 1/2”Ø x 1/2\" keyway", "4 1/2”Ø x 4 1/2”L x 2 1/2\"Ø bore x 1/2” keyway", "2 1/2\"Ø x 1/2” keyway", "UCP213", 2.5],
  [54.5, "2 1/2”Ø x 1/2\" keyway", "4 1/2”Ø x 4 1/2”L x 2 1/2\"Ø bore x 1/2” keyway", "2 1/2\"Ø x 1/2” keyway", "UCP213", 2.5],
  [60, "3”Ø x 1/2\" keyway", "5”Ø x 5”L x 3\"Ø bore x 1/2” keyway", "3\"Ø x 1/2” keyway", "UCP215", 3],
  [66, "3”Ø x 1/2\" keyway", "5”Ø x 5”L x 3\"Ø bore x 1/2” keyway", "3\"Ø x 1/2” keyway", "UCP215", 3],
  [73, "3”Ø x 1/2\" keyway", "5”Ø x 5”L x 3\"Ø bore x 1/2” keyway", "3\"Ø x 1/2” keyway", "UCP215", 3],
  [83, "3”Ø x 1/2\" keyway", "5”Ø x 5”L x 3\"Ø bore x 1/2” keyway", "3\"Ø x 1/2” keyway", "UCP215", 3],
];

// [key, rpm, shaftDia, keyway, hp, phase, pole, pulleyBelt]
const MOTOR_TABLE: Array<[string, number, number, number, number, number, number, string]> = [
  ["1/4 HP, 1PH, TECO", 1715, 14, 5, 0.25, 1, 4, "1A"], ["1/2 HP, 1PH, TECO", 1750, 19, 6, 0.5, 1, 4, "1A"], ["3 /4 HP, 1PH, TECO", 1750, 19, 6, 0.75, 1, 4, "1A"], ["1 HP, 1PH, TECO", 1750, 24, 8, 1, 1, 4, "2A"], ["1.5 HP, 1PH, TECO", 1750, 24, 8, 1.5, 1, 4, "2B"], ["2 HP, 1PH, TECO", 1750, 28, 8, 2, 1, 4, "2B"], ["3 HP, 1PH, TECO", 1750, 28, 8, 3, 1, 4, "2B"], ["5 HP, 1PH, TECO", 1750, 28, 8, 5, 1, 4, "2B"], ["1/2 HP, 3PH, TECO", 1680, 14, 5, 0.5, 3, 4, "1A"], ["1 HP, 3PH, TECO", 1710, 19, 6, 1, 3, 4, "2A"], ["1 1/2 HP, 3PH, TECO", 1720, 24, 8, 1.5, 3, 4, "2B"], ["2 HP, 3PH, TECO", 1715, 24, 8, 2, 3, 4, "2B"], ["3 HP, 3PH, TECO", 1735, 28, 8, 3, 3, 4, "2B"], ["5 HP, 3PH, TECO", 1745, 28, 8, 5, 3, 4, "2B"], ["7 1/2 HP, 3PH, TECO", 1750, 38, 10, 7.5, 3, 4, "2B"], ["10 HP, 3PH, TECO", 1750, 38, 10, 10, 3, 4, "3B"], ["15 HP, 3PH, TECO", 1760, 42, 12, 15, 3, 4, "3B"], ["20 HP, 3PH, TECO", 1760, 42, 12, 20, 3, 4, "3C "], ["25 HP, 3PH, TECO", 1760, 48, 14, 25, 3, 4, "3C "], ["30 HP, 3PH, TECO", 1765, 48, 14, 30, 3, 4, "4C"], ["40 HP, 3PH, TECO", 1760, 55, 16, 40, 3, 4, "5C"], ["50 HP, 3PH, TECO", 1770, 60, 18, 50, 3, 4, "6C"], ["60 HP, 3PH, TECO", 1765, 60, 18, 60, 3, 4, "6C"], ["75 HP, 3PH, TECO", 1775, 65, 18, 75, 3, 4, "6C"], ["100 HP, 3PH, TECO", 1775, 75, 20, 100, 3, 4, "6C"], ["125 HP, 3PH, TECO", 1770, 75, 20, 125, 3, 4, "6C"], ["150 HP, 3PH, TECO", 1770, 85, 22, 150, 3, 4, "6C"], ["175 HP, 3PH, TECO", 1770, 85, 22, 175, 3, 4, "6C"], ["200 HP, 3PH, TECO", 1775, 95, 25, 200, 3, 4, "6C"], ["250 HP, 3PH, TECO", 1775, 95, 25, 250, 3, 4, "6C"], ["300 HP, 3PH, TECO", 1775, 95, 25, 300, 3, 4, "6C"], ["1/2 HP, 3PH, Hyundai", 1660, 14, 5, 0.5, 3, 4, "1A"], ["1 HP, 3PH, Hyundai", 1668, 19, 6, 1, 3, 4, "2A"], ["1 1/2 HP, 3PH, Hyundai", 1680, 24, 8, 1.5, 3, 4, "2B"], ["2 HP, 3PH, Hyundai", 1680, 24, 8, 2, 3, 4, "2B"], ["3 HP, 3PH, Hyundai", 1716, 28, 8, 3, 3, 4, "2B"], ["5.5 HP, 3PH, Hyundai", 1728, 28, 8, 5.5, 3, 4, "2B"], ["7 1/2 HP, 3PH, Hyundai", 1728, 38, 10, 7.5, 3, 4, "2B"], ["10 HP, 3PH, Hyundai", 1728, 38, 10, 10, 3, 4, "3B"], ["15 HP, 3PH, Hyundai", 1728, 42, 12, 15, 3, 4, "3B"], ["20 HP, 3PH, Hyundai", 1752, 42, 12, 20, 3, 4, "3C "], ["25 HP, 3PH, Hyundai", 1752, 48, 14, 25, 3, 4, "3C "], ["30 HP, 3PH, Hyundai", 1764, 48, 14, 30, 3, 4, "4C"], ["40 HP, 3PH, Hyundai", 1764, 55, 16, 40, 3, 4, "5C"], ["50 HP, 3PH, Hyundai", 1764, 55, 16, 50, 3, 4, "6C"], ["60 HP, 3PH, Hyundai", 1770, 55, 16, 60, 3, 4, "6C"], ["75 HP, 3PH, Hyundai", 1770, 60, 18, 75, 3, 4, "6C"], ["100 HP, 3PH, Hyundai", 1776, 75, 20, 100, 3, 4, "6C"], ["125 HP, 3PH, Hyundai", 1776, 75, 20, 125, 3, 4, "6C"], ["150 HP, 3PH, Hyundai", 1776, 80, 22, 150, 3, 4, "6C"], ["180 HP, 3PH, Hyundai", 1776, 80, 22, 180, 3, 4, "6C"], ["200 HP, 3PH, Hyundai", 1776, 80, 22, 200, 3, 4, "6C"], ["270 HP, 3PH, Hyundai", 1776, 80, 22, 270, 3, 4, "6C"], ["340 HP, 3PH, Hyundai", 1788, 95, 25, 340, 3, 4, "6C"],
];

export interface JobOrderComputed {
  shafting: string;
  bearing: string;
  hub: string;
  bore: string;
  motorRpm: string;
  motorShaftDia: string;
  motorKeyway: string;
  motorHpNum: string;
  motorPhase: string;
  motorPole: string;
  pulleyBelt: string;
  computedFanRpm: string;
  motorPulleyHub: string;
  fanPulleyHub: string;
  bearingQty: string;
}

const num = (s: string): number => Number(String(s ?? "").replace(/,/g, "").trim());

/** Derive the JO's computed values from its inputs + the template's tables. */
export function computeJobOrder(jo: FansJobOrder): JobOrderComputed {
  const dia = num(jo.bladeDiameter);
  const blade = BLADE_TABLE.find((r) => r[0] === dia) ?? [...BLADE_TABLE].reverse().find((r) => r[0] <= dia);
  const motor = MOTOR_TABLE.find((r) => r[0].trim() === (jo.motorHp ?? "").trim());

  const shaftIn = blade ? blade[5] : NaN;
  const motorRpm = motor ? motor[1] : NaN;
  const motorShaftDia = motor ? motor[2] : NaN;
  const mPulley = num(jo.motorPulley);
  const fPulley = num(jo.fanPulley);

  const fanRpm = Number.isFinite(motorRpm) && fPulley ? Math.ceil((motorRpm * mPulley) / fPulley) : NaN;
  const motorPulleyHub = Number.isFinite(motorShaftDia) ? motorShaftDia + 36 : NaN;
  const fanPulleyHub = Number.isFinite(shaftIn) ? Math.ceil(shaftIn * 25.4 + 36) : NaN;
  const qty = num(jo.quantity);

  const show = (n: number) => (Number.isFinite(n) ? String(n) : "");
  return {
    shafting: blade ? blade[3] : "",
    bearing: blade ? blade[4] : "",
    hub: blade ? blade[2] : "",
    bore: blade ? blade[1] : "",
    motorRpm: show(motorRpm),
    motorShaftDia: show(motorShaftDia),
    motorKeyway: motor ? String(motor[3]) : "",
    motorHpNum: motor ? String(motor[4]) : "",
    motorPhase: motor ? String(motor[5]) : "",
    motorPole: motor ? String(motor[6]) : "",
    pulleyBelt: motor ? motor[7].trim() : "",
    computedFanRpm: show(fanRpm),
    motorPulleyHub: show(motorPulleyHub),
    fanPulleyHub: show(fanPulleyHub),
    bearingQty: Number.isFinite(qty) ? String(qty * 2) : "",
  };
}
