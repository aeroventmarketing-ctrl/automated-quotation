/**
 * Pure-JS Code 128 (subset B) barcode → inline SVG. No dependencies, no network.
 * Code 128 is read by essentially every 1D barcode scanner, so labels printed
 * with this work with any scanner (which behaves as a keyboard: it "types" the
 * encoded value followed by Enter).
 */

// Element-width patterns for symbol values 0–106 (each: bar,space,bar,space,bar,space).
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232",
];
const START_B = 104;
const STOP = "2331112"; // symbol 106 (233111) + termination bar

export interface Code128Opts {
  moduleWidth?: number; // px per narrow module
  height?: number; // bar height in px
  quietZone?: number; // px of white margin each side
  showText?: boolean; // print the value under the bars
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Whether a string can be encoded in Code 128 subset B (printable ASCII 32–126). */
export function isCode128B(value: string): boolean {
  return [...value].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
}

/** Render `value` as a Code 128-B barcode SVG string. */
export function code128Svg(value: string, opts: Code128Opts = {}): string {
  const moduleWidth = opts.moduleWidth ?? 2;
  const height = opts.height ?? 60;
  const quietZone = opts.quietZone ?? 10;
  const showText = opts.showText ?? true;
  if (!isCode128B(value)) throw new Error("Value has characters Code 128-B can't encode.");

  const codes = [START_B];
  let sum = START_B;
  [...value].forEach((c, i) => {
    const v = c.charCodeAt(0) - 32;
    codes.push(v);
    sum += v * (i + 1);
  });
  codes.push(sum % 103); // checksum
  const pattern = codes.map((c) => PATTERNS[c]).join("") + STOP;

  let x = quietZone;
  const bars: string[] = [];
  let isBar = true;
  for (const ch of pattern) {
    const w = Number(ch) * moduleWidth;
    if (isBar) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
    x += w;
    isBar = !isBar;
  }
  const totalW = x + quietZone;
  const textH = showText ? 16 : 0;
  const svgH = height + textH;
  const text = showText
    ? `<text x="${totalW / 2}" y="${height + 13}" font-family="monospace" font-size="11" text-anchor="middle" fill="#000">${esc(value)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${svgH}" viewBox="0 0 ${totalW} ${svgH}"><rect width="${totalW}" height="${svgH}" fill="#fff"/><g fill="#000">${bars.join("")}</g>${text}</svg>`;
}
