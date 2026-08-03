/**
 * How many worksheet rows a wrapped "Note / Remarks" block needs so a long note
 * isn't clipped in the printed job order — it grows with newlines and with lines
 * that wrap past the merged block's width. `totalWidth` is the sum of the merged
 * columns' widths (ExcelJS width units ≈ characters per line). Never fewer than
 * `min` rows, so a short note keeps the familiar box height.
 */
export function noteRowCount(text: string, totalWidth: number, min = 3): number {
  const perLine = Math.max(20, Math.floor(totalWidth * 0.95));
  let lines = 0;
  for (const raw of (text || "").split("\n")) {
    const len = raw.trim().length;
    lines += Math.max(1, Math.ceil((len || 1) / perLine));
  }
  return Math.max(min, lines);
}
