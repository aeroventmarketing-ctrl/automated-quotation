/**
 * TECO induction-motor SELLING database — imported from the admin-provided
 * "Teco INDUCTION MOTOR - FOR SELLING DATABASE" workbook (clean "TECO" sheet).
 *
 * Used ONLY by the standalone Induction Motor (TECO / Hyundai) product line. It is
 * independent of lib/pricing/motors.ts (which prices blower + motor combos and must
 * not change). Prices here are net (VAT-exclusive) PHP selling prices; foot- and
 * flange-mounted are listed separately (flange = null when not offered for that HP).
 *
 * Keyed `${section}|${hp}|${pole}` where section is:
 *   single — 1-phase 4-pole (TEFC)
 *   ex     — 3-phase 4-pole Explosion-Proof
 *   three  — 3-phase TEFC, 2- / 4- / 6-pole
 */
export interface TecoSellingRow {
  hp: number;
  pole: number;
  kw: number | null;
  rpm: number | null;
  frame: string;
  foot: number;
  flange: number | null;
}

export type TecoSection = "single" | "ex" | "three";

export const TECO_SELLING: Record<string, TecoSellingRow> = {
  "single|0.25|4": { hp: 0.25, pole: 4, kw: 0.18, rpm: 1715, frame: "A71", foot: 14287, flange: null },
  "single|0.5|4": { hp: 0.5, pole: 4, kw: 0.37, rpm: 1740, frame: "80", foot: 16669, flange: null },
  "single|0.75|4": { hp: 0.75, pole: 4, kw: 0.55, rpm: 1750, frame: "90S", foot: 20303, flange: null },
  "single|1|4": { hp: 1, pole: 4, kw: 0.75, rpm: 1750, frame: "90S", foot: 25314, flange: null },
  "single|1.5|4": { hp: 1.5, pole: 4, kw: 1.1, rpm: 1750, frame: "90L", foot: 27320, flange: null },
  "single|2|4": { hp: 2, pole: 4, kw: 1.5, rpm: 1760, frame: "100L", foot: 32082, flange: null },
  "single|3|4": { hp: 3, pole: 4, kw: 2.2, rpm: 1760, frame: "112S", foot: 39853, flange: null },
  "single|5|4": { hp: 5, pole: 4, kw: 3.7, rpm: 1750, frame: "112M", foot: 48663, flange: null },
  "ex|1|4": { hp: 1, pole: 4, kw: 0.75, rpm: 1745, frame: "90S", foot: 39590, flange: null },
  "ex|2|4": { hp: 2, pole: 4, kw: 1.5, rpm: 1715, frame: "90L", foot: 47567, flange: null },
  "ex|3|4": { hp: 3, pole: 4, kw: 2.2, rpm: 1755, frame: "112S", foot: 57200, flange: null },
  "ex|5|4": { hp: 5, pole: 4, kw: 3.75, rpm: 1715, frame: "112M", foot: 59157, flange: null },
  "ex|7.5|4": { hp: 7.5, pole: 4, kw: 5.5, rpm: 1745, frame: "132S", foot: 81134, flange: null },
  "ex|10|4": { hp: 10, pole: 4, kw: 7.5, rpm: 1740, frame: "132M", foot: 91823, flange: null },
  "ex|15|4": { hp: 15, pole: 4, kw: 11, rpm: 1760, frame: "160M", foot: 128098, flange: null },
  "ex|20|4": { hp: 20, pole: 4, kw: 15, rpm: 1755, frame: "160L", foot: 153386, flange: null },
  "ex|25|4": { hp: 25, pole: 4, kw: 18.5, rpm: 1760, frame: "180M", foot: 193276, flange: null },
  "ex|30|4": { hp: 30, pole: 4, kw: 22, rpm: 1750, frame: "180L", foot: 220973, flange: null },
  "ex|40|4": { hp: 40, pole: 4, kw: 30, rpm: 1760, frame: "200M", foot: 304515, flange: null },
  "ex|50|4": { hp: 50, pole: 4, kw: 37, rpm: 1760, frame: "200L", foot: 359909, flange: null },
  "three|0.5|2": { hp: 0.5, pole: 2, kw: 0.37, rpm: 3400, frame: "71", foot: 8587, flange: 9936 },
  "three|1|2": { hp: 1, pole: 2, kw: 0.75, rpm: 3395, frame: "80", foot: 10551, flange: 12208 },
  "three|2|2": { hp: 2, pole: 2, kw: 1.5, rpm: 3425, frame: "90L", foot: 14051, flange: 16258 },
  "three|3|2": { hp: 3, pole: 2, kw: 2.2, rpm: 3450, frame: "90L", foot: 14685, flange: 16991 },
  "three|5|2": { hp: 5, pole: 2, kw: 3.7, rpm: 3485, frame: "112M", foot: 21216, flange: 24547 },
  "three|7.5|2": { hp: 7.5, pole: 2, kw: 5.5, rpm: 3505, frame: "132S", foot: 30275, flange: 35029 },
  "three|10|2": { hp: 10, pole: 2, kw: 7.5, rpm: 3510, frame: "132S", foot: 34363, flange: 39758 },
  "three|15|2": { hp: 15, pole: 2, kw: 11, rpm: 3540, frame: "160M", foot: 51809, flange: 59944 },
  "three|20|2": { hp: 20, pole: 2, kw: 15, rpm: 3520, frame: "160M", foot: 62806, flange: 72667 },
  "three|25|2": { hp: 25, pole: 2, kw: 18.5, rpm: 3530, frame: "160L", foot: 71070, flange: 82228 },
  "three|30|2": { hp: 30, pole: 2, kw: 22, rpm: 3530, frame: "180MA", foot: 95004, flange: 109920 },
  "three|40|2": { hp: 40, pole: 2, kw: 30, rpm: 3520, frame: "180LA", foot: 104630, flange: 121057 },
  "three|50|2": { hp: 50, pole: 2, kw: 37, rpm: 3545, frame: "200LA", foot: 132216, flange: 152974 },
  "three|60|2": { hp: 60, pole: 2, kw: 45, rpm: 3545, frame: "200LA", foot: 174336, flange: 201707 },
  "three|75|2": { hp: 75, pole: 2, kw: 55, rpm: 3550, frame: "225SA", foot: 185484, flange: 214605 },
  "three|100|2": { hp: 100, pole: 2, kw: 75, rpm: 3550, frame: "A250SA", foot: 257837, flange: 298318 },
  "three|125|2": { hp: 125, pole: 2, kw: 90, rpm: 3555, frame: "A250MA", foot: 356356, flange: 412304 },
  "three|150|2": { hp: 150, pole: 2, kw: 110, rpm: 3565, frame: "280S", foot: 590928, flange: null },
  "three|175|2": { hp: 175, pole: 2, kw: 132, rpm: 3565, frame: "280M", foot: 619534, flange: null },
  "three|200|2": { hp: 200, pole: 2, kw: 160, rpm: 3570, frame: "315S", foot: 679703, flange: null },
  "three|0.5|4": { hp: 0.5, pole: 4, kw: 0.37, rpm: 1680, frame: "71", foot: 8304, flange: 9608 },
  "three|1|4": { hp: 1, pole: 4, kw: 0.75, rpm: 1710, frame: "80", foot: 10038, flange: 11614 },
  "three|1.5|4": { hp: 1.5, pole: 4, kw: 1.1, rpm: 1720, frame: "90L", foot: 13676, flange: 15824 },
  "three|2|4": { hp: 2, pole: 4, kw: 1.5, rpm: 1715, frame: "90L", foot: 14102, flange: 16317 },
  "three|3|4": { hp: 3, pole: 4, kw: 2.2, rpm: 1735, frame: "100L", foot: 17316, flange: 20035 },
  "three|5|4": { hp: 5, pole: 4, kw: 3.7, rpm: 1745, frame: "112M", foot: 22412, flange: 25931 },
  "three|7.5|4": { hp: 7.5, pole: 4, kw: 5.5, rpm: 1750, frame: "132S", foot: 28980, flange: 33530 },
  "three|10|4": { hp: 10, pole: 4, kw: 7.5, rpm: 1750, frame: "132M", foot: 33604, flange: 38880 },
  "three|15|4": { hp: 15, pole: 4, kw: 11, rpm: 1760, frame: "160M", foot: 55297, flange: 63979 },
  "three|20|4": { hp: 20, pole: 4, kw: 15, rpm: 1760, frame: "160L", foot: 65114, flange: 75337 },
  "three|25|4": { hp: 25, pole: 4, kw: 18.5, rpm: 1760, frame: "180MC", foot: 89059, flange: 103042 },
  "three|30|4": { hp: 30, pole: 4, kw: 22, rpm: 1765, frame: "180MC", foot: 92723, flange: 107281 },
  "three|40|4": { hp: 40, pole: 4, kw: 30, rpm: 1760, frame: "180LC", foot: 103501, flange: 119751 },
  "three|50|4": { hp: 50, pole: 4, kw: 37, rpm: 1770, frame: "200LC", foot: 132132, flange: 152877 },
  "three|60|4": { hp: 60, pole: 4, kw: 45, rpm: 1765, frame: "200LC", foot: 156645, flange: 181239 },
  "three|75|4": { hp: 75, pole: 4, kw: 55, rpm: 1775, frame: "225SC", foot: 182606, flange: 211276 },
  "three|100|4": { hp: 100, pole: 4, kw: 75, rpm: 1775, frame: "A250SC", foot: 271294, flange: 313888 },
  "three|125|4": { hp: 125, pole: 4, kw: 90, rpm: 1770, frame: "A250MC", foot: 351083, flange: 406204 },
  "three|150|4": { hp: 150, pole: 4, kw: 110, rpm: 1770, frame: "280S", foot: 551286, flange: null },
  "three|175|4": { hp: 175, pole: 4, kw: 132, rpm: 1770, frame: "280M", foot: 583264, flange: null },
  "three|200|4": { hp: 200, pole: 4, kw: 160, rpm: 1775, frame: "315S", foot: 644690, flange: null },
  "three|0.5|6": { hp: 0.5, pole: 6, kw: 0.37, rpm: 1135, frame: "80", foot: 10192, flange: 11793 },
  "three|1|6": { hp: 1, pole: 6, kw: 0.75, rpm: 1140, frame: "90L", foot: 13104, flange: 15162 },
  "three|2|6": { hp: 2, pole: 6, kw: 1.5, rpm: 1140, frame: "100L", foot: 17254, flange: 19963 },
  "three|3|6": { hp: 3, pole: 6, kw: 2.2, rpm: 1160, frame: "112M", foot: 21362, flange: 24716 },
  "three|5|6": { hp: 5, pole: 6, kw: 3.7, rpm: 1160, frame: "132S", foot: 36738, flange: 42506 },
  "three|7.5|6": { hp: 7.5, pole: 6, kw: 5.5, rpm: 1160, frame: "132M", foot: 44013, flange: 50924 },
  "three|10|6": { hp: 10, pole: 6, kw: 7.5, rpm: 1175, frame: "160M", foot: 54850, flange: 63462 },
  "three|15|6": { hp: 15, pole: 6, kw: 11, rpm: 1170, frame: "160L", foot: 71272, flange: 82462 },
  "three|20|6": { hp: 20, pole: 6, kw: 15, rpm: 1170, frame: "180MC", foot: 84885, flange: 98212 },
  "three|25|6": { hp: 25, pole: 6, kw: 18.5, rpm: 1170, frame: "180LC", foot: 94402, flange: 109224 },
  "three|30|6": { hp: 30, pole: 6, kw: 22, rpm: 1175, frame: "180LC", foot: 103493, flange: 119742 },
  "three|40|6": { hp: 40, pole: 6, kw: 30, rpm: 1170, frame: "200LC", foot: 145573, flange: 168428 },
  "three|50|6": { hp: 50, pole: 6, kw: 37, rpm: 1175, frame: "200LC", foot: 164887, flange: 190775 },
  "three|60|6": { hp: 60, pole: 6, kw: 45, rpm: 1180, frame: "225SC", foot: 214760, flange: 248478 },
  "three|75|6": { hp: 75, pole: 6, kw: 55, rpm: 1175, frame: "A250SC", foot: 267640, flange: 309660 },
  "three|100|6": { hp: 100, pole: 6, kw: 75, rpm: 1175, frame: "A250MC", foot: 375836, flange: 434843 },
  "three|125|6": { hp: 125, pole: 6, kw: 90, rpm: 1180, frame: "280S", foot: 526716, flange: null },
  "three|150|6": { hp: 150, pole: 6, kw: 110, rpm: 1180, frame: "280M", foot: 618459, flange: null },
  "three|175|6": { hp: 175, pole: 6, kw: 132, rpm: 1185, frame: "315S", foot: 661128, flange: null },
  "three|200|6": { hp: 200, pole: 6, kw: 160, rpm: 1185, frame: "315M", foot: 748873, flange: null },
};

/** The selling row for a section / HP / pole, or undefined. */
export function tecoSellingRow(section: TecoSection, hp: number, pole: number): TecoSellingRow | undefined {
  return TECO_SELLING[`${section}|${hp}|${pole}`];
}

/** Ascending distinct HP options offered for a section / pole. */
export function tecoHpOptions(section: TecoSection, pole: number): number[] {
  const prefix = `${section}|`;
  const suffix = `|${pole}`;
  return Object.entries(TECO_SELLING)
    .filter(([k]) => k.startsWith(prefix) && k.endsWith(suffix))
    .map(([, r]) => r.hp)
    .sort((a, b) => a - b);
}

/**
 * Net (VAT-exclusive) selling price for a row given the mounting. Flange-mounted
 * uses the flange price when the file lists one; otherwise it falls back to the
 * foot price (Ex-Proof, single-phase and the largest 3-phase frames are foot-only).
 */
export function tecoNetPrice(row: TecoSellingRow, mounting: string | undefined): number {
  const wantFlange = mounting === "Flanged Mounted";
  return wantFlange && row.flange != null ? row.flange : row.foot;
}
