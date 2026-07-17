/**
 * Direct-drive hub details, keyed by the motor selection (HP, phase, brand).
 * For a direct-drive unit the fan hub is bored to fit the motor shaft, so the
 * hub comes from the motor — not the blade/pulley tables used for belt drive.
 *
 * Source: AeroVent's motor-shaft hub table. Columns: hub diameter (in), hub
 * length (in), bore diameter (mm), keyway (mm).
 */

interface Hub {
  dia: string; // hub outer diameter, inches
  len: string; // hub length, inches
  bore: number; // bore diameter, mm
  keyway: number; // keyway, mm
}

// [motorHp, hubDiameter(in), hubLength(in), bore(mm), keyway(mm)]
const ROWS: [string, string, string, number, number][] = [
  // TECO — Single Phase, 4 pole, 60Hz
  ["1/4 HP, 1PH, TECO", "2", "1.125", 14, 5],
  ["1/2 HP, 1PH, TECO", "2", "1.5", 19, 6],
  ["3 /4 HP, 1PH, TECO", "2", "1.75", 19, 6],
  ["1 HP, 1PH, TECO", "2.5", "1.75", 24, 8],
  ["1.5 HP, 1PH, TECO", "2.5", "1.75", 24, 8],
  ["2 HP, 1PH, TECO", "2.5", "1.75", 28, 8],
  ["3 HP, 1PH, TECO", "2.5", "2.25", 28, 8],
  ["5 HP, 1PH, TECO", "2.5", "2.25", 28, 8],
  // TECO — Three Phase, 4 pole, 60Hz
  ["1/2 HP, 3PH, TECO", "2", "1.125", 14, 5],
  ["1 HP, 3PH, TECO", "2", "1.5", 19, 6],
  ["1 1/2 HP, 3PH, TECO", "2.5", "1.75", 24, 8],
  ["2 HP, 3PH, TECO", "2.5", "1.75", 24, 8],
  ["3 HP, 3PH, TECO", "2.5", "2.25", 28, 8],
  ["5 HP, 3PH, TECO", "2.5", "2.25", 28, 8],
  ["7 1/2 HP, 3PH, TECO", "3", "3", 38, 10],
  ["10 HP, 3PH, TECO", "3", "3", 38, 10],
  ["15 HP, 3PH, TECO", "3", "4.25", 42, 12],
  ["20 HP, 3PH, TECO", "3", "4.25", 42, 12],
  ["25 HP, 3PH, TECO", "3.5", "4.25", 48, 14],
  ["30 HP, 3PH, TECO", "3.5", "4.25", 48, 14],
  ["40 HP, 3PH, TECO", "3.5", "4.25", 55, 16],
  ["50 HP, 3PH, TECO", "4", "5.5", 60, 18],
  ["60 HP, 3PH, TECO", "4", "5.5", 60, 18],
  ["75 HP, 3PH, TECO", "4", "5.5", 65, 18],
  ["100 HP, 3PH, TECO", "4.5", "5.5", 75, 20],
  ["125 HP, 3PH, TECO", "4.5", "5.5", 75, 20],
  ["150 HP, 3PH, TECO", "5", "6.5", 85, 22],
  ["175 HP, 3PH, TECO", "5", "6.5", 85, 22],
  ["200 HP, 3PH, TECO", "5", "6.5", 95, 25],
  ["250 HP, 3PH, TECO", "5", "6.5", 95, 25],
  ["300 HP, 3PH, TECO", "5", "6.5", 95, 25],
  // Hyundai — Three Phase, 4 pole, 60Hz
  ["1/2 HP, 3PH, Hyundai", "2", "1.5", 14, 5],
  ["1 HP, 3PH, Hyundai", "2", "1.75", 19, 6],
  ["1 1/2 HP, 3PH, Hyundai", "2.5", "2", 24, 8],
  ["2 HP, 3PH, Hyundai", "2.5", "2", 24, 8],
  ["3 HP, 3PH, Hyundai", "2.5", "2.25", 28, 8],
  ["5.5 HP, 3PH, Hyundai", "2.5", "2.5", 28, 8],
  ["7 1/2 HP, 3PH, Hyundai", "3", "3.25", 38, 10],
  ["10 HP, 3PH, Hyundai", "3", "3.25", 38, 10],
  ["15 HP, 3PH, Hyundai", "3", "4", 42, 12],
  ["20 HP, 3PH, Hyundai", "3", "4", 42, 12],
  ["25 HP, 3PH, Hyundai", "3.5", "4.5", 48, 14],
  ["30 HP, 3PH, Hyundai", "3.5", "4.5", 48, 14],
  ["40 HP, 3PH, Hyundai", "3.5", "5", 55, 16],
  ["50 HP, 3PH, Hyundai", "3.5", "5.75", 55, 18],
  ["60 HP, 3PH, Hyundai", "3.5", "5.75", 55, 18],
  ["75 HP, 3PH, Hyundai", "4", "6.5", 60, 18],
  ["100 HP, 3PH, Hyundai", "4.5", "7.25", 75, 20],
  ["125 HP, 3PH, Hyundai", "4.5", "7.25", 75, 20],
  ["150 HP, 3PH, Hyundai", "4.5", "8.5", 80, 22],
  ["180 HP, 3PH, Hyundai", "4.5", "8.5", 80, 22],
  ["200 HP, 3PH, Hyundai", "4.5", "8.5", 80, 22],
  ["270 HP, 3PH, Hyundai", "4.5", "8.5", 80, 22],
  ["340 HP, 3PH, Hyundai", "5", "8.5", 95, 25],
];

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const TABLE: Record<string, Hub> = Object.fromEntries(
  ROWS.map(([hp, dia, len, bore, keyway]) => [norm(hp), { dia, len, bore, keyway }]),
);

/**
 * The direct-drive hub spec for a motor selection, or null if unknown.
 * Format mirrors the belt-drive pulley specs, e.g.
 * `3" Ø x 4.25" L x 42 mm Ø bore x 12 mm keyway`.
 */
export function directDriveHubText(motorHp: string): string | null {
  const h = TABLE[norm(motorHp || "")];
  if (!h) return null;
  return `${h.dia}" Ø x ${h.len}" L x ${h.bore} mm Ø bore x ${h.keyway} mm keyway`;
}
