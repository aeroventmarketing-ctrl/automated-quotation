/**
 * HYUNDAI induction-motor SELLING database — imported from the admin-provided
 * "Hyundai INDUCTION MOTOR - FOR SELLING DATABASE" workbook (clean "HYUNDAI" sheet).
 *
 * Used ONLY by the standalone Induction Motor (Hyundai) product line, mirroring
 * lib/teco-induction-selling.ts. Prices are net (VAT-exclusive) PHP selling prices;
 * foot- and flange-mounted are listed separately (flange = null when not offered
 * for that HP). Hyundai motors are all 3-phase TEFC in 2- / 4- / 6-pole; there is
 * no single-phase or Explosion-Proof range. Keyed `${hp}|${pole}`.
 */
export interface HyundaiSellingRow {
  hp: number;
  pole: number;
  kw: number | null;
  rpm: number | null;
  frame: string;
  foot: number;
  flange: number | null;
}

export const HYUNDAI_SELLING: Record<string, HyundaiSellingRow> = {
  "0.5|2": { hp: 0.5, pole: 2, kw: 0.37, rpm: 3228, frame: "71M", foot: 8302, flange: 8302 },
  "1|2": { hp: 1, pole: 2, kw: 0.75, rpm: 3396, frame: "80M", foot: 9106, flange: 10846 },
  "1.5|2": { hp: 1.5, pole: 2, kw: 1.1, rpm: 3396, frame: "80M", foot: 9641, flange: 15340 },
  "2|2": { hp: 2, pole: 2, kw: 1.5, rpm: 3408, frame: "90S", foot: 12453, flange: 15399 },
  "3|2": { hp: 3, pole: 2, kw: 2.2, rpm: 3408, frame: "90L", foot: 13658, flange: 17140 },
  "5.5|2": { hp: 5.5, pole: 2, kw: 4, rpm: 3468, frame: "112M", foot: 19148, flange: 21692 },
  "7.5|2": { hp: 7.5, pole: 2, kw: 5.5, rpm: 3480, frame: "132S", foot: 27182, flange: 31735 },
  "10|2": { hp: 10, pole: 2, kw: 7.5, rpm: 3480, frame: "132S", foot: 30664, flange: 33475 },
  "15|2": { hp: 15, pole: 2, kw: 11, rpm: 3516, frame: "160M", foot: 45928, flange: 50347 },
  "20|2": { hp: 20, pole: 2, kw: 15, rpm: 3516, frame: "160M", foot: 54899, flange: 63737 },
  "25|2": { hp: 25, pole: 2, kw: 18.5, rpm: 3516, frame: "160L", foot: 60122, flange: 75386 },
  "30|2": { hp: 30, pole: 2, kw: 22, rpm: 3528, frame: "180M", foot: 82349, flange: 98015 },
  "40|2": { hp: 40, pole: 2, kw: 30, rpm: 3540, frame: "200L", foot: 93329, flange: 105781 },
  "50|2": { hp: 50, pole: 2, kw: 37, rpm: 3540, frame: "200L", foot: 115422, flange: 136712 },
  "60|2": { hp: 60, pole: 2, kw: 45, rpm: 3564, frame: "225M", foot: 155860, flange: null },
  "75|2": { hp: 75, pole: 2, kw: 55, rpm: 3564, frame: "250M", foot: 174874, flange: null },
  "100|2": { hp: 100, pole: 2, kw: 75, rpm: 3564, frame: "280S", foot: 234325, flange: null },
  "125|2": { hp: 125, pole: 2, kw: 90, rpm: 3564, frame: "280M", foot: 322833, flange: null },
  "150|2": { hp: 150, pole: 2, kw: 110, rpm: 3576, frame: "315S", foot: 536270, flange: null },
  "0.5|4": { hp: 0.5, pole: 4, kw: 0.37, rpm: 1596, frame: "71M", foot: 7700, flange: 9106 },
  "1|4": { hp: 1, pole: 4, kw: 0.75, rpm: 1668, frame: "80M", foot: 9674, flange: 10712 },
  "1.5|4": { hp: 1.5, pole: 4, kw: 1.1, rpm: 1680, frame: "90S", foot: 12183, flange: 14863 },
  "2|4": { hp: 2, pole: 4, kw: 1.5, rpm: 1680, frame: "90L", foot: 12493, flange: 15265 },
  "3|4": { hp: 3, pole: 4, kw: 2.2, rpm: 1716, frame: "100L", foot: 15273, flange: 15935 },
  "5.5|4": { hp: 5.5, pole: 4, kw: 4, rpm: 1728, frame: "112M", foot: 20163, flange: 22630 },
  "7.5|4": { hp: 7.5, pole: 4, kw: 5.5, rpm: 1728, frame: "132S", foot: 26207, flange: 32003 },
  "10|4": { hp: 10, pole: 4, kw: 7.5, rpm: 1728, frame: "132M", foot: 29526, flange: 36689 },
  "15|4": { hp: 15, pole: 4, kw: 11, rpm: 1752, frame: "160M", foot: 47773, flange: 56105 },
  "20|4": { hp: 20, pole: 4, kw: 15, rpm: 1752, frame: "160L", foot: 55487, flange: 66013 },
  "25|4": { hp: 25, pole: 4, kw: 18.5, rpm: 1764, frame: "180M", foot: 75208, flange: 91588 },
  "30|4": { hp: 30, pole: 4, kw: 22, rpm: 1764, frame: "180L", foot: 79390, flange: 95069 },
  "40|4": { hp: 40, pole: 4, kw: 30, rpm: 1764, frame: "200L", foot: 91129, flange: 106719 },
  "50|4": { hp: 50, pole: 4, kw: 37, rpm: 1776, frame: "225S", foot: 115942, flange: 153316 },
  "60|4": { hp: 60, pole: 4, kw: 45, rpm: 1776, frame: "225M", foot: 141583, flange: null },
  "75|4": { hp: 75, pole: 4, kw: 55, rpm: 1776, frame: "250M", foot: 155321, flange: null },
  "100|4": { hp: 100, pole: 4, kw: 75, rpm: 1776, frame: "280S", foot: 221570, flange: null },
  "120|4": { hp: 120, pole: 4, kw: 90, rpm: 1776, frame: "280M", foot: 280894, flange: null },
  "150|4": { hp: 150, pole: 4, kw: 110, rpm: 1776, frame: "315S", foot: 484292, flange: null },
  "175|4": { hp: 175, pole: 4, kw: 132, rpm: 1788, frame: "315M", foot: 523312, flange: null },
  "200|4": { hp: 200, pole: 4, kw: 160, rpm: 1776, frame: "315L", foot: 560924, flange: null },
  "0.5|6": { hp: 0.5, pole: 6, kw: 0.37, rpm: 1080, frame: "80M", foot: 9106, flange: null },
  "1|6": { hp: 1, pole: 6, kw: 0.75, rpm: 1092, frame: "90S", foot: 12051, flange: 14194 },
  "1.5|6": { hp: 1.5, pole: 6, kw: 1.1, rpm: 1092, frame: "90L", foot: 14328, flange: 17943 },
  "2|6": { hp: 2, pole: 6, kw: 1.5, rpm: 1128, frame: "100L", foot: 16202, flange: 18345 },
  "3|6": { hp: 3, pole: 6, kw: 2.2, rpm: 1128, frame: "112M", foot: 19550, flange: 22496 },
  "5.5|6": { hp: 5.5, pole: 6, kw: 4, rpm: 1152, frame: "132M", foot: 31735, flange: 34145 },
  "7.5|6": { hp: 7.5, pole: 6, kw: 5.5, rpm: 1152, frame: "132M", foot: 38028, flange: 45928 },
  "10|6": { hp: 10, pole: 6, kw: 7.5, rpm: 1164, frame: "160M", foot: 50079, flange: 53159 },
  "15|6": { hp: 15, pole: 6, kw: 11, rpm: 1164, frame: "160L", foot: 66147, flange: 73779 },
  "20|6": { hp: 20, pole: 6, kw: 15, rpm: 1164, frame: "180L", foot: 75386, flange: 85998 },
  "25|6": { hp: 25, pole: 6, kw: 18.5, rpm: 1164, frame: "200L", foot: 87035, flange: 99622 },
  "30|6": { hp: 30, pole: 6, kw: 22, rpm: 1164, frame: "200L", foot: 92391, flange: 106049 },
  "40|6": { hp: 40, pole: 6, kw: 30, rpm: 1176, frame: "225M", foot: 137114, flange: 146889 },
  "50|6": { hp: 50, pole: 6, kw: 37, rpm: 1176, frame: "250M", foot: 147692, flange: 168982 },
  "60|6": { hp: 60, pole: 6, kw: 45, rpm: 1176, frame: "280S", foot: 198039, flange: null },
  "75|6": { hp: 75, pole: 6, kw: 55, rpm: 1176, frame: "280M", foot: 230175, flange: null },
  "100|6": { hp: 100, pole: 6, kw: 75, rpm: 1188, frame: "315S", foot: 376393, flange: null },
  "125|6": { hp: 125, pole: 6, kw: 90, rpm: 1188, frame: "315M", foot: 470391, flange: null },
  "150|6": { hp: 150, pole: 6, kw: 110, rpm: 1188, frame: "315L", foot: 510159, flange: null },};

/** The selling row for a HP / pole, or undefined. */
export function hyundaiSellingRow(hp: number, pole: number): HyundaiSellingRow | undefined {
  return HYUNDAI_SELLING[`${hp}|${pole}`];
}

/** Ascending distinct HP options offered for a pole. */
export function hyundaiHpOptions(pole: number): number[] {
  const suffix = `|${pole}`;
  return Object.entries(HYUNDAI_SELLING)
    .filter(([k]) => k.endsWith(suffix))
    .map(([, r]) => r.hp)
    .sort((a, b) => a - b);
}
