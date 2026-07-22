/**
 * Fan/blower motor selection table — the exact "HP, PH, Brand" strings the Fans
 * & Blowers job-order form stores (its Excel template VLOOKUPs on the full key).
 * Used by the job-order auto-generator to pre-select the Motor HP that matches a
 * quotation line's HP / phase for the standard TECO motor. Kept in sync with the
 * list in fans-job-order-panel.tsx.
 */
export const FAN_MOTOR_HP: string[] = [
  "1/4 HP, 1PH, TECO", "1/2 HP, 1PH, TECO", "3 /4 HP, 1PH, TECO", "1 HP, 1PH, TECO", "1.5 HP, 1PH, TECO", "2 HP, 1PH, TECO", "3 HP, 1PH, TECO", "5 HP, 1PH, TECO",
  "1/2 HP, 3PH, TECO", "1 HP, 3PH, TECO", "1 1/2 HP, 3PH, TECO", "2 HP, 3PH, TECO", "3 HP, 3PH, TECO", "5 HP, 3PH, TECO", "7 1/2 HP, 3PH, TECO", "10 HP, 3PH, TECO", "15 HP, 3PH, TECO", "20 HP, 3PH, TECO", "25 HP, 3PH, TECO", "30 HP, 3PH, TECO", "40 HP, 3PH, TECO", "50 HP, 3PH, TECO", "60 HP, 3PH, TECO", "75 HP, 3PH, TECO", "100 HP, 3PH, TECO", "125 HP, 3PH, TECO", "150 HP, 3PH, TECO", "175 HP, 3PH, TECO", "200 HP, 3PH, TECO", "250 HP, 3PH, TECO", "300 HP, 3PH, TECO",
  "1/2 HP, 3PH, Hyundai", "1 HP, 3PH, Hyundai", "1 1/2 HP, 3PH, Hyundai", "2 HP, 3PH, Hyundai", "3 HP, 3PH, Hyundai", "5.5 HP, 3PH, Hyundai", "7 1/2 HP, 3PH, Hyundai", "10 HP, 3PH, Hyundai", "15 HP, 3PH, Hyundai", "20 HP, 3PH, Hyundai", "25 HP, 3PH, Hyundai", "30 HP, 3PH, Hyundai", "40 HP, 3PH, Hyundai", "50 HP, 3PH, Hyundai", "60 HP, 3PH, Hyundai", "75 HP, 3PH, Hyundai", "100 HP, 3PH, Hyundai", "125 HP, 3PH, Hyundai", "150 HP, 3PH, Hyundai", "180 HP, 3PH, Hyundai", "200 HP, 3PH, Hyundai", "270 HP, 3PH, Hyundai", "340 HP, 3PH, Hyundai",
];

/** Parse an HP label ("15", "1 1/2", "3 /4", "5.5") to its numeric value. */
function hpLabelToNumber(label: string): number {
  const s = label.replace(/hp/i, "").replace(/\s*\/\s*/g, "/").trim();
  let total = 0;
  for (const p of s.split(/\s+/).filter(Boolean)) {
    if (p.includes("/")) { const [n, d] = p.split("/").map(Number); if (d) total += n / d; }
    else total += Number(p) || 0;
  }
  return total;
}

/**
 * The full "HP, PH, Brand" key matching a numeric HP + phase for a brand, or ""
 * if none. `hp` may be a number or a string; `phaseTok` is "1PH" or "3PH".
 */
export function findFanMotorHp(brand: string, phaseTok: string, hp: string | number): string {
  const target = typeof hp === "number" ? hp : hpLabelToNumber(String(hp));
  if (!target) return "";
  for (const full of FAN_MOTOR_HP) {
    const [hpPart, ph, br] = full.split(",").map((x) => x.trim());
    if (br === brand && ph === phaseTok && Math.abs(hpLabelToNumber(hpPart) - target) < 0.01) return full;
  }
  return "";
}
