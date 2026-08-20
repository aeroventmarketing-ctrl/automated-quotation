/**
 * Hard-wrap a "Note / Remarks" string into display lines that each fit within
 * `perLine` characters, so the printed job order can allocate exactly one row per
 * line. Excel does NOT auto-fit the height of a merged cell, so relying on its own
 * word-wrap clips long notes; by breaking the text ourselves the row count is
 * exact and nothing is hidden. Wraps on spaces where possible and hard-splits an
 * over-long unbroken run (e.g. "ffffff…"); preserves the author's own line breaks.
 */
/**
 * Auto-fit a table row's height to its tallest wrapping cell. ExcelJS/Excel do
 * NOT auto-fit the height of rows we build with wrapText, so multi-line values
 * (long dimensions, product types, remarks) get clipped at a fixed height. We
 * estimate how many lines each wrapping cell needs — its text hard-wrapped to
 * the column's character width — and size the row to the tallest one.
 *
 * `cells` is the wrapping cells to measure: each `text` at its column `width`
 * (the ExcelJS column width, ≈ characters of the default font).
 */
export function autoRowHeight(
  cells: Array<{ text: unknown; width: number }>,
  opts?: { min?: number; linePt?: number; pad?: number },
): number {
  const linePt = opts?.linePt ?? 14; // points per wrapped line (size-10 body font)
  const pad = opts?.pad ?? 4; // cell top/bottom breathing room
  const min = opts?.min ?? 18;
  let lines = 1;
  for (const { text, width } of cells) {
    // Leave ~2 chars for the cell's own left/right padding, so we wrap a touch
    // early rather than clip.
    const budget = Math.max(6, Math.floor(width) - 2);
    lines = Math.max(lines, wrapNote(String(text ?? ""), budget).length);
  }
  return Math.max(min, lines * linePt + pad);
}

export function wrapNote(text: string, perLine: number): string[] {
  const width = Math.max(8, Math.floor(perLine));
  const lines: string[] = [];
  for (const para of (text || "").split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let line = "";
    for (let w of words) {
      // A single word longer than the line width — emit full-width chunks.
      while (w.length > width) {
        if (line) { lines.push(line); line = ""; }
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += " " + w;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}
