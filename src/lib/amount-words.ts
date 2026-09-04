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

const indexOf = (words: readonly string[]): Map<string, number> =>
  new Map(words.flatMap((w, i) => (w ? [[w, i] as [string, number]] : [])));

const ONES_INDEX = indexOf(ONES);
const TENS_INDEX = indexOf(TENS);
const SCALE_INDEX = indexOf(SCALES);

/**
 * The inverse: the PESOS line read back as a number.
 * "TWO THOUSAND EIGHTY-ONE AND 25/100" → 2081.25.
 *
 * Why this exists. A check carries its amount twice — once in the peso box and
 * once spelled out — and the two are not equally easy to read. A photo of
 * "2,081.25" comes back as "2,018.25" if two digits change places, and nothing
 * about the result looks wrong. The words cannot fail that way: "EIGHTY-ONE"
 * and "EIGHTEEN" are not a transposition of each other.
 *
 * The law agrees, which is the older reason. Under the Negotiable Instruments
 * Law (Act 2031, sec. 17(c)), where the sum is written in both words and
 * figures and they disagree, **the sum in words is the sum payable**.
 *
 * Returns null on ANY word it does not recognise, rather than a partial total —
 * a half-parsed amount is the one kind of answer worse than none. Tolerates the
 * things checks actually carry: hyphens, "PESOS", the house-style "ONLY", the
 * asterisk filler that closes a short line, and a "NO/100" or "00/100" tail.
 */
export function pesoAmountFromWords(words: string | null | undefined): number | null {
  if (!words) return null;
  let s = words.toUpperCase();

  // The centavo tail, in any of the forms a check prints it.
  let centavos = 0;
  const tail = s.match(/(\d{1,2}|NO)\s*\/\s*100/);
  if (tail) {
    centavos = tail[1] === "NO" ? 0 : Number(tail[1]);
    s = s.replace(tail[0], " ");
  }
  if (centavos > 99) return null;

  // Everything that is punctuation, filler or a word for "peso".
  s = s.replace(/\bPESOS?\b|\bONLY\b|\bAND\b/g, " ").replace(/[^A-Z]+/g, " ");

  const tokens = s.trim().split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let seen = false;
  let lastScale = Infinity; // scales must descend: "MILLION" then "THOUSAND", never back

  for (const t of tokens) {
    if (t === "ZERO") { seen = true; continue; }
    const one = ONES_INDEX.get(t);
    if (one !== undefined) { current += one; seen = true; continue; }
    const ten = TENS_INDEX.get(t);
    if (ten !== undefined) { current += ten * 10; seen = true; continue; }
    if (t === "HUNDRED") {
      if (current === 0) return null; // "HUNDRED" with nothing in front of it
      current *= 100;
      seen = true;
      continue;
    }
    const scale = SCALE_INDEX.get(t);
    if (scale !== undefined) {
      if (current === 0 || scale >= lastScale) return null; // "THOUSAND THOUSAND", or nothing to scale
      total += current * Math.pow(1000, scale);
      current = 0;
      lastScale = scale;
      seen = true;
      continue;
    }
    return null; // a word we do not know — say nothing rather than guess
  }

  if (!seen) return null;
  return Math.round((total + current) * 100 + centavos) / 100;
}
