/**
 * Spell a peso amount for a voucher / receipt, e.g. 1250.5 →
 * "ONE THOUSAND TWO HUNDRED FIFTY AND 50/100". Uppercase, no "PESOS" suffix
 * (the form supplies that). Centavos become an "AND nn/100" tail.
 */
const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
const SCALES = ["", "THOUSAND", "MILLION", "BILLION", "TRILLION"];

function threeDigits(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]} HUNDRED`);
  if (r < 20) {
    if (r) parts.push(ONES[r]);
  } else {
    const t = Math.floor(r / 10);
    const o = r % 10;
    parts.push(o ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
  }
  return parts.join(" ");
}

/** Whole-number part in words (uppercase). 0 → "ZERO". */
export function numberToWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "ZERO";
  const groups: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(`${threeDigits(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ""}`);
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(" ").trim();
}

/** Peso amount in words for a voucher: whole part + "AND nn/100" for centavos. */
export function pesoAmountInWords(value: number): string {
  const v = Math.max(0, value);
  const whole = Math.floor(v);
  const centavos = Math.round((v - whole) * 100);
  const words = numberToWords(whole);
  return centavos > 0 ? `${words} AND ${String(centavos).padStart(2, "0")}/100` : words;
}
